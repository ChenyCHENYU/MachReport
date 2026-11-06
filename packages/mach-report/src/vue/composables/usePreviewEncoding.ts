import { hasValidDataExplanation } from "../../source/data-explanation";
import { mergeDiagnosticMessages, validReportDiagnosticLocation } from "../../server/diagnostics";
import type { DiagnosticSummary, OutputDiagnostic, OutputFormat, RenderPlan } from "@agile-team/mach-report";
import type { OutputTaskOptions } from "../../output/progress";
import { createDiagnosticCollector, DEFAULT_DIAGNOSTIC_LIMIT, validDiagnosticSummary } from "../../output/diagnostic-collector";
import { assertOutputActive, observeOutput } from "../../output/progress";
import type { PreparedReport, ReportRuntimePreparedExportInput, ReportRuntimeExportResult } from "../../server/types";
import type { ReportExportExecutionOptions, ReportLocalExport } from "../../worker/auto-types";
import type { XlsxRenderOptions } from "../../xlsx/render-xlsx";
import type { PdfExporter } from "../pdf-exporter";
import type { ReportPreviewDiagnostic } from "../guards";
import { useReportExportExecution } from "./useReportExportExecution";
import { MachReportError } from "../errors";

function previewDiagnostic(value: unknown): value is ReportPreviewDiagnostic {
  if (!value || typeof value !== "object") return false;
  const entry = value as ReportPreviewDiagnostic;
  return typeof entry.code === "string" && typeof entry.message === "string" && ["info", "warning", "error"].includes(entry.severity) && hasValidDataExplanation(entry) && validReportDiagnosticLocation(entry);
}

export type PreviewEncodingTask = OutputTaskOptions & { onDiagnostic?: (entry: OutputDiagnostic) => void };
export interface PreviewEncoding {
  pdf(plan: RenderPlan, exporter: PdfExporter, warning: (message: string) => void, task?: PreviewEncodingTask): Promise<Uint8Array>;
  xlsx(plan: RenderPlan, options: XlsxRenderOptions, task: PreviewEncodingTask): Promise<{ buffer: Uint8Array; warnings: string[] }>;
}

function prepared(plan: RenderPlan): PreparedReport {
  return { plan, diagnostics: [], revisions: {}, stats: { rows: 0, pages: plan.pages.length, cells: 0, durationMs: 0 }, layout: { textMetrics: "provided" } };
}
function request(plan: RenderPlan, format: "pdf" | "xlsx", task: PreviewEncodingTask, fidelity?: "warn" | "strict"): ReportRuntimePreparedExportInput {
  return { prepared: prepared(plan), format, layoutPolicy: "preserve", fidelity, diagnosticLimit: DEFAULT_DIAGNOSTIC_LIMIT, signal: task.signal,
    onEvent: event => { if (event.stage === "encode" && event.completed !== undefined && event.total !== undefined) task.onProgress?.(event.completed, event.total); } };
}

/** Resource preparation stays on the host; only an already rendered plan and font bytes enter isolation. */
export function usePreviewEncoding(host: {
  execution(): ReportExportExecutionOptions | undefined;
  fidelity(): "warn" | "strict" | undefined;
  diagnostic(entry: ReportPreviewDiagnostic): void;
  diagnosticSummary?(value: DiagnosticSummary<ReportPreviewDiagnostic>, format: OutputFormat): void;
  fidelityMessage?(): string;
}): PreviewEncoding {
  const execution = useReportExportExecution(host.execution);
  function diagnostics(result: ReportRuntimeExportResult, task: PreviewEncodingTask): void {
    assertOutputActive(task.signal);
    if (result.diagnosticSummary && host.diagnosticSummary) observeOutput(() => host.diagnosticSummary!(result.diagnosticSummary!, result.format));
    else for (const entry of result.diagnostics) { assertOutputActive(task.signal); observeOutput(() => host.diagnostic(entry)); }
    assertOutputActive(task.signal);
  }
  function captureFailure(error: unknown, format: OutputFormat): void {
    const value = error as { diagnostics?: unknown; diagnosticSummary?: unknown } | null;
    if (!Array.isArray(value?.diagnostics)) return;
    const collector = createDiagnosticCollector<ReportPreviewDiagnostic>(DEFAULT_DIAGNOSTIC_LIMIT);
    if (validDiagnosticSummary(value.diagnosticSummary) && value.diagnosticSummary.entries.every(previewDiagnostic)) collector.merge(value.diagnosticSummary as DiagnosticSummary<ReportPreviewDiagnostic>);
    else for (const entry of value.diagnostics) {
      if (previewDiagnostic(entry)) collector.push(entry);
    }
    if (host.diagnosticSummary) observeOutput(() => host.diagnosticSummary!(collector.snapshot(), format));
    else collector.entries.forEach(entry => observeOutput(() => host.diagnostic(entry)));
  }
  async function encode(input: ReportRuntimePreparedExportInput, task: PreviewEncodingTask, local?: ReportLocalExport): Promise<ReportRuntimeExportResult> {
    try {
      const result = await execution.exportPrepared(input, local);
      diagnostics(result, task);
      return result;
    } catch (error) {
      assertOutputActive(task.signal);
      captureFailure(error, input.format);
      const failure = error as { name?: unknown; code?: unknown } | null;
      if (host.fidelityMessage && (failure?.code === "output-fidelity" || failure?.name === "OutputFidelityError")) throw new MachReportError("export", host.fidelityMessage(), error);
      throw error;
    }
  }
  async function pdf(plan: RenderPlan, exporter: PdfExporter, warning: (message: string) => void, task: PreviewEncodingTask = {}): Promise<Uint8Array> {
    // Injected exporters own their encoding pipeline; an optional prepare contract opts into ours.
    if (!exporter.prepare) return exporter(plan, warning, task);
    const fidelity = host.fidelity();
    const fonts = await exporter.prepare(task.signal);
    assertOutputActive(task.signal);
    const result = await encode({ ...request(plan, "pdf", task, fidelity), pdf: fonts }, task);
    // Preserve the preview's historical guarantee: broken pages or missing text never download.
    const failed = result.diagnostics.find(entry => entry.code === "pdf-font" || entry.code === "pdf-page");
    if (failed || result.diagnosticSummary?.counts["pdf-font"] || result.diagnosticSummary?.counts["pdf-page"]) throw new Error(failed?.message ?? "PDF 存在缺失文本或页面错误，请查看输出诊断。");
    const warnings = result.diagnostics.filter(entry => entry.severity === "warning");
    if (warnings.length) warning(`PDF 有 ${result.diagnosticSummary?.total ?? warnings.length} 条输出说明：${warnings.slice(0, 2).map(entry => entry.message).join("；")}`);
    return result.bytes;
  }
  async function localXlsx(input: ReportRuntimePreparedExportInput, configured: XlsxRenderOptions, task: PreviewEncodingTask): Promise<ReportRuntimeExportResult> {
    const { renderPlanToXlsx } = await import("@agile-team/mach-report/xlsx");
    assertOutputActive(input.signal);
    const result = await renderPlanToXlsx(input.prepared.plan, { ...configured, ...input.xlsx, fidelity: input.fidelity, diagnosticLimit: input.diagnosticLimit, signal: input.signal,
      onProgress: (done, total) => { observeOutput(() => configured.onProgress?.(done, total)); task.onProgress?.(done, total); },
      onDiagnostic: entry => { observeOutput(() => configured.onDiagnostic?.(entry)); task.onDiagnostic?.(entry); } });
    assertOutputActive(input.signal);
    const collector = createDiagnosticCollector<ReportPreviewDiagnostic>(input.diagnosticLimit);
    if (result.diagnosticSummary) collector.merge(result.diagnosticSummary);
    else result.diagnostics?.forEach(entry => collector.push(entry));
    mergeDiagnosticMessages(collector, "xlsx-fidelity", result.warnings, "warning", result.warningCount);
    result.notes?.forEach(message => collector.push({ code: "xlsx-snapshot", severity: "info", message }));
    return { ...input.prepared, bytes: new Uint8Array(result.buffer), format: "xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      diagnostics: collector.entries, diagnosticSummary: collector.snapshot() };
  }
  async function xlsx(plan: RenderPlan, options: XlsxRenderOptions, task: PreviewEncodingTask): Promise<{ buffer: Uint8Array; warnings: string[] }> {
    const { signal: _signal, fidelity, ...configured } = options;
    const strict = host.fidelity() === "strict" || fidelity === "strict";
    // Functions remain local and are never dropped or sent through structured clone.
    const custom = Object.values(configured).some(value => typeof value === "function");
    const result = await encode({ ...request(plan, "xlsx", task, strict ? "strict" : "warn"), xlsx: configured }, task,
      custom ? input => localXlsx(input, configured, task) : undefined);
    return { buffer: result.bytes, warnings: result.diagnostics.filter(entry => entry.severity === "warning").map(entry => entry.message) };
  }
  return { pdf, xlsx };
}
