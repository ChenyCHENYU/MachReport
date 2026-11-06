import { mergeDiagnosticMessages } from "./diagnostics";
import type { PreparedReport, ReportRuntimeBudget, ReportRuntimeExportResult, ReportRuntimePreparedExportInput } from "./types";
import { assertBudget, throwIfAborted } from "./control";
import { createReportTaskReporter } from "../source/task-events";
import type { OutputDiagnostic } from "../output/capabilities";
import { createDiagnosticCollector, DEFAULT_DIAGNOSTIC_LIMIT, type DiagnosticSummary } from "../output/diagnostic-collector";
import { ReportSourceError } from "../source/report-source";
import type { ReportDiagnostic } from "../source/provider";
import { assertPreparedOutputBudget } from "./prepared";

function outputPath(entry: OutputDiagnostic): string {
  let path = `$.pages.${entry.pageIndex}`;
  if (entry.componentIndex < 0) return path;
  path += `.components.${entry.componentIndex}`;
  const indexes = entry.componentPath ?? [];
  for (let index = 0; index + 1 < indexes.length; index += 3) {
    path += `.grid.cells.${indexes[index]}.${indexes[index + 1]}`;
    if (indexes[index + 2] !== undefined) path += `.children.${indexes[index + 2]}`;
  }
  return path;
}
export function outputDiagnostics(entries: readonly OutputDiagnostic[] = []): PreparedReport["diagnostics"] {
  return entries.map(entry => ({ ...entry, path: outputPath(entry) }));
}

function initialDiagnostics(prepared: PreparedReport, limit?: number) {
  const collector = createDiagnosticCollector<ReportDiagnostic>(limit ?? (prepared.diagnosticSummary ? DEFAULT_DIAGNOSTIC_LIMIT : undefined));
  if (prepared.diagnosticSummary) collector.merge(prepared.diagnosticSummary);
  else prepared.diagnostics.forEach(entry => collector.push(entry));
  return collector;
}
function mergeOutput(collector: ReturnType<typeof initialDiagnostics>, result: { diagnostics?: readonly OutputDiagnostic[]; diagnosticSummary?: DiagnosticSummary<OutputDiagnostic> }): void {
  if (result.diagnosticSummary) collector.merge({ ...result.diagnosticSummary, entries: outputDiagnostics(result.diagnosticSummary.entries) });
  else outputDiagnostics(result.diagnostics).forEach(entry => collector.push(entry));
}
function rejectAssetDegradation(input: ReportRuntimePreparedExportInput): void {
  const counts = input.prepared.diagnosticSummary?.counts;
  const degraded = counts ? !!(counts["asset-render-failed"] || counts["asset-budget-exceeded"]) : input.prepared.diagnostics.some(diagnostic => diagnostic.code === "asset-render-failed" || diagnostic.code === "asset-budget-exceeded");
  if (input.fidelity === "strict" && degraded) throw new ReportSourceError("validate", "严格输出拒绝已有资产渲染降级，请修复组件后重新准备报表。");
}
/** Shared codec path; caller owns a validated snapshot and has resolved local assets. */
export async function encodePreparedReport(input: ReportRuntimePreparedExportInput, budget: ReportRuntimeBudget, started = Date.now()): Promise<ReportRuntimeExportResult> {
  const prepared = input.prepared;
  assertPreparedOutputBudget(input, budget);
  rejectAssetDegradation(input);
  const collector = initialDiagnostics(prepared, input.diagnosticLimit);
  const pdf = input.format === "pdf" ? await import("@agile-team/mach-report/pdf") : undefined;
  throwIfAborted(input.signal);
  const faces = input.pdf?.customFontFaces ?? (input.pdf?.customFontBytes ? { regular: input.pdf.customFontBytes } : undefined);
  const measurer = pdf && faces ? pdf.createFontBytesMeasurer(faces) : undefined;
  const reporter = createReportTaskReporter(input);
  const bytes = await reporter.run("encode", async () => {
    let bytes: Uint8Array;
    const options = { fidelity: input.fidelity, diagnosticLimit: input.diagnosticLimit ?? (prepared.diagnosticSummary ? DEFAULT_DIAGNOSTIC_LIMIT : undefined), signal: input.signal, onProgress: (completed: number, total: number) => reporter.progress("encode", completed, total) };
    if (input.format === "pdf") {
      throwIfAborted(input.signal);
      const result = await pdf!.renderPlanToPdf(prepared.plan, { ...input.pdf, ...(measurer ? { measurer } : {}), ...options });
      bytes = result.bytes;
      mergeOutput(collector, result);
      mergeDiagnosticMessages(collector, "pdf-fidelity", result.fidelityWarnings, "warning", result.fidelityWarningCount);
      mergeDiagnosticMessages(collector, "pdf-page", result.pageErrors, "error", result.pageErrorCount);
      if (result.unsupportedTextCount) collector.push({ code: "pdf-font", message: `${result.unsupportedTextCount} 段文本包含当前字体不支持的字符`, severity: "warning" });
    } else {
      const { renderPlanToXlsx } = await import("@agile-team/mach-report/xlsx");
      throwIfAborted(input.signal);
      const result = await renderPlanToXlsx(prepared.plan, { ...input.xlsx, ...options });
      bytes = new Uint8Array(result.buffer);
      mergeOutput(collector, result);
      mergeDiagnosticMessages(collector, "xlsx-fidelity", result.warnings, "warning", result.warningCount);
      result.notes?.forEach(message => collector.push({ code: "xlsx-snapshot", message, severity: "info" }));
    }
    throwIfAborted(input.signal);
    return bytes;
  });
  assertBudget(budget, "maxOutputBytes", bytes.byteLength);
  const { plan: _plan, ...result } = prepared;
  return { ...result, diagnostics: collector.entries,
    ...(input.diagnosticLimit === undefined && !prepared.diagnosticSummary ? {} : { diagnosticSummary: collector.snapshot() }),
    bytes, format: input.format, contentType: input.format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", stats: { ...result.stats, durationMs: Date.now() - started, outputBytes: bytes.byteLength } };
}
