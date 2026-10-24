import type { OutputDiagnostic, RenderPlan } from "@agile-team/mach-report";
import type { OutputTaskOptions } from "../../output/progress";
import { assertOutputActive, observeOutput } from "../../output/progress";
import type { PreparedReport, ReportRuntimePreparedExportInput, ReportRuntimeExportResult } from "../../server/types";
import type { ReportExportExecutionOptions } from "../../worker/auto-types";
import type { XlsxRenderOptions } from "../../xlsx/render-xlsx";
import type { PdfExporter } from "../pdf-exporter";
import type { ReportPreviewDiagnostic } from "../guards";
import { useReportExportExecution } from "./useReportExportExecution";

export type PreviewEncodingTask = OutputTaskOptions & { onDiagnostic?: (entry: OutputDiagnostic) => void };
export interface PreviewEncoding {
  pdf(plan: RenderPlan, exporter: PdfExporter, warning: (message: string) => void, task?: PreviewEncodingTask): Promise<Uint8Array>;
  xlsx(plan: RenderPlan, options: XlsxRenderOptions, task: PreviewEncodingTask): Promise<{ buffer: Uint8Array; warnings: string[] }>;
}

function prepared(plan: RenderPlan): PreparedReport {
  return { plan, diagnostics: [], revisions: {}, stats: { rows: 0, pages: plan.pages.length, cells: 0, durationMs: 0 }, layout: { textMetrics: "provided" } };
}
function request(plan: RenderPlan, format: "pdf" | "xlsx", task: PreviewEncodingTask, fidelity?: "warn" | "strict"): ReportRuntimePreparedExportInput {
  return { prepared: prepared(plan), format, layoutPolicy: "preserve", fidelity, signal: task.signal,
    onEvent: event => { if (event.stage === "encode" && event.completed !== undefined && event.total !== undefined) task.onProgress?.(event.completed, event.total); } };
}

/** Resource preparation stays on the host; only an already rendered plan and font bytes enter isolation. */
export function usePreviewEncoding(host: {
  execution(): ReportExportExecutionOptions | undefined;
  fidelity(): "warn" | "strict" | undefined;
  diagnostic(entry: ReportPreviewDiagnostic): void;
}): PreviewEncoding {
  const execution = useReportExportExecution(host.execution);
  function diagnostics(result: ReportRuntimeExportResult, task: PreviewEncodingTask): void {
    assertOutputActive(task.signal);
    for (const entry of result.diagnostics) { assertOutputActive(task.signal); observeOutput(() => host.diagnostic(entry)); }
    assertOutputActive(task.signal);
  }
  async function pdf(plan: RenderPlan, exporter: PdfExporter, warning: (message: string) => void, task: PreviewEncodingTask = {}): Promise<Uint8Array> {
    // Injected exporters own their encoding pipeline; an optional prepare contract opts into ours.
    if (!exporter.prepare) return exporter(plan, warning, task);
    const fidelity = host.fidelity();
    const fonts = await exporter.prepare(task.signal);
    assertOutputActive(task.signal);
    const result = await execution.exportPrepared({ ...request(plan, "pdf", task, fidelity), pdf: fonts });
    diagnostics(result, task);
    // Preserve the preview's historical guarantee: broken pages or missing text never download.
    const failed = result.diagnostics.find(entry => entry.code === "pdf-font" || entry.code === "pdf-page");
    if (failed) throw new Error(failed.message);
    const warnings = result.diagnostics.filter(entry => entry.severity === "warning");
    if (warnings.length) warning(`PDF 有 ${warnings.length} 处版式降级：${warnings.slice(0, 2).map(entry => entry.message).join("；")}`);
    return result.bytes;
  }
  async function localXlsx(input: ReportRuntimePreparedExportInput, configured: XlsxRenderOptions, task: PreviewEncodingTask): Promise<ReportRuntimeExportResult> {
    const { renderPlanToXlsx } = await import("@agile-team/mach-report/xlsx");
    assertOutputActive(input.signal);
    const result = await renderPlanToXlsx(input.prepared.plan, { ...configured, ...input.xlsx, fidelity: input.fidelity, signal: input.signal,
      onProgress: (done, total) => { observeOutput(() => configured.onProgress?.(done, total)); task.onProgress?.(done, total); },
      onDiagnostic: entry => { observeOutput(() => configured.onDiagnostic?.(entry)); task.onDiagnostic?.(entry); } });
    assertOutputActive(input.signal);
    return { ...input.prepared, bytes: new Uint8Array(result.buffer), format: "xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      diagnostics: [...(result.diagnostics ?? []), ...result.warnings.map(message => ({ code: "xlsx-fidelity", severity: "warning" as const, message }))] };
  }
  async function xlsx(plan: RenderPlan, options: XlsxRenderOptions, task: PreviewEncodingTask): Promise<{ buffer: Uint8Array; warnings: string[] }> {
    const { signal: _signal, fidelity, ...configured } = options;
    const strict = host.fidelity() === "strict" || fidelity === "strict";
    // Functions remain local and are never dropped or sent through structured clone.
    const custom = Object.values(configured).some(value => typeof value === "function");
    const result = await execution.exportPrepared({ ...request(plan, "xlsx", task, strict ? "strict" : "warn"), xlsx: configured },
      custom ? input => localXlsx(input, configured, task) : undefined);
    diagnostics(result, task);
    return { buffer: result.bytes, warnings: result.diagnostics.filter(entry => entry.severity === "warning").map(entry => entry.message) };
  }
  return { pdf, xlsx };
}
