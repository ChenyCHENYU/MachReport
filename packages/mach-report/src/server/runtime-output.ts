import type { PreparedReport, ReportRuntimeBudget, ReportRuntimeExportResult, ReportRuntimePreparedExportInput } from "./types";
import { assertBudget, throwIfAborted } from "./control";
import { createReportTaskReporter } from "../source/task-events";
import type { OutputDiagnostic } from "../output/capabilities";

export function outputDiagnostics(entries: readonly OutputDiagnostic[] = []): PreparedReport["diagnostics"] {
  return entries.map(({ code, message, severity, pageIndex, componentIndex }) => ({ code, message, severity, path: `$.pages.${pageIndex}.components.${componentIndex}` }));
}
/** Shared codec path; caller owns a validated snapshot and has resolved local assets. */
export async function encodePreparedReport(input: ReportRuntimePreparedExportInput, budget: ReportRuntimeBudget, started = Date.now()): Promise<ReportRuntimeExportResult> {
  const prepared = input.prepared;
  const pdf = input.format === "pdf" ? await import("@agile-team/mach-report/pdf") : undefined;
  throwIfAborted(input.signal);
  const faces = input.pdf?.customFontFaces ?? (input.pdf?.customFontBytes ? { regular: input.pdf.customFontBytes } : undefined);
  const measurer = pdf && faces ? pdf.createFontBytesMeasurer(faces) : undefined;
  const reporter = createReportTaskReporter(input);
  const bytes = await reporter.run("encode", async () => {
    let bytes: Uint8Array;
    if (input.format === "pdf") {
      throwIfAborted(input.signal);
      const result = await pdf!.renderPlanToPdf(prepared.plan, { ...input.pdf, ...(measurer ? { measurer } : {}), fidelity: input.fidelity, signal: input.signal, onProgress: (completed, total) => reporter.progress("encode", completed, total) });
      bytes = result.bytes;
      prepared.diagnostics.push(...outputDiagnostics(result.diagnostics));
      prepared.diagnostics.push(...result.fidelityWarnings.map((message) => ({ code: "pdf-fidelity", message, severity: "warning" as const })), ...result.pageErrors.map((message) => ({ code: "pdf-page", message, severity: "error" as const })));
      if (result.unsupportedTextCount) prepared.diagnostics.push({ code: "pdf-font", message: `${result.unsupportedTextCount} 段文本包含当前字体不支持的字符`, severity: "warning" });
    } else {
      const { renderPlanToXlsx } = await import("@agile-team/mach-report/xlsx");
      throwIfAborted(input.signal);
      const result = await renderPlanToXlsx(prepared.plan, { ...input.xlsx, fidelity: input.fidelity, signal: input.signal, onProgress: (completed, total) => reporter.progress("encode", completed, total) });
      bytes = new Uint8Array(result.buffer);
      prepared.diagnostics.push(...outputDiagnostics(result.diagnostics));
      prepared.diagnostics.push(...result.warnings.map((message) => ({ code: "xlsx-fidelity", message, severity: "warning" as const })));
    }
    throwIfAborted(input.signal);
    return bytes;
  });
  assertBudget(budget, "maxOutputBytes", bytes.byteLength);
  const { plan: _plan, ...result } = prepared;
  return { ...result, bytes, format: input.format, contentType: input.format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", stats: { ...result.stats, durationMs: Date.now() - started, outputBytes: bytes.byteLength } };
}
