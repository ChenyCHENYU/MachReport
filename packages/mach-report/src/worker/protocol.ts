import type { PreparedReport, ReportRuntime, ReportRuntimeExportInput, ReportRuntimeExportResult, ReportRuntimeInput, ReportRuntimePreparedExportInput, ReportRuntimeBudget } from "../server/types";
import type { ReportTaskEvent, ReportTaskObserver } from "../source/task-events";
import { hasValidDataExplanation } from "../source/data-explanation";
import { createDiagnosticCollector, DEFAULT_DIAGNOSTIC_LIMIT, validDiagnosticSummary, type DiagnosticSummary } from "../output/diagnostic-collector";
import { validReportExecutionResult } from "../server/execution-result";

export const REPORT_WORKER_PROTOCOL = "mach-report-worker/1" as const;
export type ReportWorkerInput = Omit<ReportRuntimeInput, "signal" | "onEvent"> | Omit<ReportRuntimeExportInput, "signal" | "onEvent"> | Omit<ReportRuntimePreparedExportInput, "signal" | "onEvent">;
export interface ReportWorkerRequest { protocol: typeof REPORT_WORKER_PROTOCOL; id: string; operation: "prepare" | "export" | "exportPrepared"; input: ReportWorkerInput; budget?: ReportRuntimeBudget }
export interface ReportWorkerEvent { protocol: typeof REPORT_WORKER_PROTOCOL; id: string; type: "event"; event: ReportTaskEvent }
export interface SerializedReportError { name: string; message: string; code?: string; path?: string; issues?: unknown; diagnostics?: unknown; diagnosticSummary?: DiagnosticSummary<Record<string, unknown>>; issueSummary?: DiagnosticSummary<Record<string, string>> }
export interface ReportWorkerResponse {
  protocol: typeof REPORT_WORKER_PROTOCOL;
  id: string;
  result?: PreparedReport | ReportRuntimeExportResult;
  error?: SerializedReportError;
}
export class ReportWorkerError extends Error {
  readonly code?: string;
  readonly path?: string;
  readonly issues?: unknown;
  readonly diagnostics?: unknown;
  readonly diagnosticSummary?: DiagnosticSummary<Record<string, unknown>>;
  readonly issueSummary?: DiagnosticSummary<Record<string, string>>;
  constructor(error: SerializedReportError) {
    super(error.message); this.name = error.name; this.code = error.code; this.path = error.path; this.issues = error.issues; this.diagnostics = error.diagnostics; this.diagnosticSummary = error.diagnosticSummary; this.issueSummary = error.issueSummary;
  }
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
/** Worker responses use the same checked value contract as direct runtime executors. */
export function validReportWorkerResult(value: unknown, operation: ReportWorkerRequest["operation"]): value is PreparedReport | ReportRuntimeExportResult {
  return validReportExecutionResult(value, operation);
}
function serializeIssue(issue: unknown): Record<string, string> {
  if (!issue || typeof issue !== "object") return { message: String(issue).slice(0, 4096) };
  const result: Record<string, string> = {};
  for (const key of ["code", "path", "field", "message"]) {
    const value = (issue as Record<string, unknown>)[key];
    if (typeof value === "string") result[key] = value.slice(0, key === "code" ? 128 : 4096);
  }
  return result;
}
function serializeDiagnostic(value: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = serializeIssue(value);
  if (!object(value)) return result;
  for (const key of ["format", "severity", "kind", "nid"]) if (typeof value[key] === "string") result[key] = (value[key] as string).slice(0, 4096);
  for (const key of ["pageIndex", "componentIndex"]) if (Number.isSafeInteger(value[key]) && (value[key] as number) >= 0) result[key] = value[key];
  if (hasValidDataExplanation(value) && value.valueState !== undefined && object(value.target)) {
    result.valueState = value.valueState;
    const target: Record<string, unknown> = {};
    for (const key of ["datasetId", "field", "rowKey", "tableId", "reportScope"]) if (value.target[key] !== undefined) target[key] = value.target[key];
    result.target = target;
  }
  if (object(value.extension) && typeof value.extension.id === "string" && typeof value.extension.version === "string") result.extension = { id: value.extension.id.slice(0, 128), version: value.extension.version.slice(0, 64) };
  if (Array.isArray(value.componentPath) && value.componentPath.length <= 192 && value.componentPath.every((index) => Number.isSafeInteger(index) && index >= 0)) result.componentPath = value.componentPath;
  return result;
}
function diagnosticEnvelope(value: unknown): { code: string; value: unknown; valueState?: unknown } {
  return { code: object(value) && typeof value.code === "string" ? value.code : "unknown", value,
    ...(object(value) && value.valueState !== undefined && hasValidDataExplanation(value) ? { valueState: value.valueState } : {}) };
}
function errorDetails(values: readonly unknown[], serialize: (value: unknown) => Record<string, unknown>, previous?: unknown): DiagnosticSummary<Record<string, unknown>> {
  const collector = createDiagnosticCollector<ReturnType<typeof diagnosticEnvelope>>(DEFAULT_DIAGNOSTIC_LIMIT);
  if (validDiagnosticSummary(previous)) {
    collector.merge({ ...previous, entries: previous.entries.slice(0, DEFAULT_DIAGNOSTIC_LIMIT).map(diagnosticEnvelope) });
  } else for (const value of values) collector.push(diagnosticEnvelope(value));
  const result = collector.snapshot();
  return { ...result, entries: result.entries.map(entry => serialize(entry.value)) };
}
export function serializeError(error: unknown): SerializedReportError {
  if (!(error instanceof Error)) return { name: "Error", message: String(error).slice(0, 8192) };
  const detail = error as Error & { code?: unknown; path?: unknown; issues?: unknown; diagnostics?: unknown; diagnosticSummary?: unknown };
  const diagnosticSummary = Array.isArray(detail.diagnostics) ? errorDetails(detail.diagnostics, serializeDiagnostic, detail.diagnosticSummary) : undefined;
  const issueSummary = Array.isArray(detail.issues) ? errorDetails(detail.issues, serializeIssue) as DiagnosticSummary<Record<string, string>> : undefined;
  return { name: error.name.slice(0, 128), message: error.message.slice(0, 8192),
    ...(typeof detail.code === "string" ? { code: detail.code.slice(0, 128) } : {}),
    ...(typeof detail.path === "string" ? { path: detail.path.slice(0, 4096) } : {}),
    ...(issueSummary ? { issues: issueSummary.entries, ...(issueSummary.omitted ? { issueSummary } : {}) } : {}),
    ...(diagnosticSummary ? { diagnostics: diagnosticSummary.entries, ...(diagnosticSummary.omitted || detail.diagnosticSummary !== undefined ? { diagnosticSummary } : {}) } : {}) };
}
export function isReportWorkerRequest(value: unknown): value is ReportWorkerRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<ReportWorkerRequest>;
  return request.protocol === REPORT_WORKER_PROTOCOL && typeof request.id === "string" && (request.operation === "prepare" || request.operation === "export" || request.operation === "exportPrepared") && !!request.input && typeof request.input === "object";
}
export async function runReportWorkerRequest(runtime: ReportRuntime, request: ReportWorkerRequest, onEvent?: ReportTaskObserver): Promise<ReportWorkerResponse> {
  try {
    const result = request.operation === "prepare"
      ? await runtime.prepare({ ...request.input, onEvent } as ReportRuntimeInput)
      : request.operation === "exportPrepared"
        ? await runtime.exportPrepared({ ...request.input, onEvent } as ReportRuntimePreparedExportInput)
        : await runtime.export({ ...request.input, onEvent } as ReportRuntimeExportInput);
    return { protocol: REPORT_WORKER_PROTOCOL, id: request.id, result };
  } catch (error) { return { protocol: REPORT_WORKER_PROTOCOL, id: request.id, error: serializeError(error) }; }
}

/** 导出文件所有权转给调用端，避免大文件在线程边界再复制一份。宿主输入字体不转移。 */
export function reportWorkerTransferList(response: ReportWorkerResponse): ArrayBuffer[] {
  const result = response.result;
  if (!result || !("bytes" in result) || !(result.bytes.buffer instanceof ArrayBuffer)) return [];
  return [result.bytes.buffer];
}

/** 不信任线程/RPC 的通知帧；非法阶段、计数和任务身份不能污染宿主状态。 */
export function validReportWorkerEvent(value: unknown, input: ReportWorkerInput): value is ReportTaskEvent {
  if (!object(value) || typeof value.taskId !== "string" || !value.taskId) return false;
  if (input.taskId !== undefined && value.taskId !== input.taskId) return false;
  if (value.correlationId !== input.correlationId || value.reportId !== undefined && (typeof value.reportId !== "string" || !("reportIds" in input && input.reportIds.includes(value.reportId)))) return false;
  if (!["query", "validate", "layout", "assets", "encode"].includes(value.stage as string) || !["started", "completed", "failed"].includes(value.status as string)) return false;
  for (const key of ["completed", "total"] as const) if (value[key] !== undefined && (typeof value[key] !== "number" || !Number.isFinite(value[key]) || value[key] < 0)) return false;
  return value.completed === undefined || value.total === undefined || (value.completed as number) <= (value.total as number);
}
