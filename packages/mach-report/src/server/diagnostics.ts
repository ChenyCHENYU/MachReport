import { hasValidDataExplanation } from "../source/data-explanation";
import { createDiagnosticCollector, DEFAULT_DIAGNOSTIC_LIMIT, validDiagnosticSummary, type DiagnosticSummary } from "../output/diagnostic-collector";
import type { ReportDiagnostic } from "../source/provider";
import type { PreparedReport } from "./types";

/** Keep prepared diagnostic arrays and their optional bounded summary synchronized at every append. */
export function appendPreparedDiagnostics(prepared: PreparedReport, entries: readonly ReportDiagnostic[], summary?: DiagnosticSummary<ReportDiagnostic>, limit?: number): void {
  if (limit === undefined && !prepared.diagnosticSummary && !summary) { entries.forEach(entry => prepared.diagnostics.push(entry)); return; }
  const collector = createDiagnosticCollector<ReportDiagnostic>(limit ?? DEFAULT_DIAGNOSTIC_LIMIT);
  if (prepared.diagnosticSummary) collector.merge(prepared.diagnosticSummary);
  else prepared.diagnostics.forEach(entry => collector.push(entry));
  if (summary) collector.merge(summary);
  else entries.forEach(entry => collector.push(entry));
  prepared.diagnostics = collector.entries;
  prepared.diagnosticSummary = collector.snapshot();
}

function sameDiagnosticEntry(left: ReportDiagnostic, right: ReportDiagnostic): boolean {
  if (!hasValidDataExplanation(left) || !validReportDiagnosticLocation(left)) return false;
  const fields = ["code", "message", "severity", "path", "format", "pageIndex", "componentIndex", "kind", "nid", "valueState"] as const;
  if (fields.some(field => left[field] !== right[field])) return false;
  if (left.componentPath?.length !== right.componentPath?.length || left.componentPath?.some((index, position) => index !== right.componentPath?.[position])) return false;
  if ((["datasetId", "field", "rowKey", "tableId", "reportScope"] as const).some(field => left.target?.[field] !== right.target?.[field])) return false;
  return left.extension?.id === right.extension?.id && left.extension?.version === right.extension?.version;
}
/** No stringify copies: verify both public detail representations refer to the same bounded window. */
export function matchingDiagnosticSummary(value: unknown, entries: readonly ReportDiagnostic[]): boolean {
  if (!validDiagnosticSummary(value) || value.entries.length !== entries.length) return false;
  return value.entries.every((entry, index) => !!entry && typeof entry === "object" && sameDiagnosticEntry(entry as ReportDiagnostic, entries[index]!));
}

/** Legacy codec string warnings are bounded separately but retain their exact aggregate counts. */
export function mergeDiagnosticMessages(collector: ReturnType<typeof createDiagnosticCollector<ReportDiagnostic>>, code: string, entries: readonly string[], severity: ReportDiagnostic["severity"], total = entries.length): void {
  if (!total) return;
  collector.merge({ total, counts: { [code]: total }, entries: entries.map(message => ({ code, message, severity })), omitted: total - entries.length });
}

function optionalIndex(value: unknown, minimum: number): boolean { return value === undefined || typeof value === "number" && Number.isSafeInteger(value) && value >= minimum; }
export function validReportDiagnosticLocation(entry: ReportDiagnostic): boolean {
  if (entry.format !== undefined && !["dom", "canvas", "pdf", "xlsx"].includes(entry.format)) return false;
  if (!optionalIndex(entry.pageIndex, 0) || !optionalIndex(entry.componentIndex, -1)) return false;
  if (entry.componentPath !== undefined && !validComponentPath(entry.componentPath)) return false;
  if (entry.extension !== undefined && (!entry.extension || typeof entry.extension.id !== "string" || typeof entry.extension.version !== "string")) return false;
  return true;
}

function validComponentPath(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > 192) return false;
  for (const index of value) if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0) return false;
  return true;
}
