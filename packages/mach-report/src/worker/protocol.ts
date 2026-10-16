import type { PreparedReport, ReportRuntime, ReportRuntimeExportInput, ReportRuntimeExportResult, ReportRuntimeInput } from "../server/types";
import type { ReportTaskEvent, ReportTaskObserver } from "../source/task-events";
import { validateRenderPlan } from "../schema/validate";

export const REPORT_WORKER_PROTOCOL = "mach-report-worker/1" as const;
export type ReportWorkerInput = Omit<ReportRuntimeInput, "signal" | "onEvent"> | Omit<ReportRuntimeExportInput, "signal" | "onEvent">;
export interface ReportWorkerRequest { protocol: typeof REPORT_WORKER_PROTOCOL; id: string; operation: "prepare" | "export"; input: ReportWorkerInput }
export interface ReportWorkerEvent { protocol: typeof REPORT_WORKER_PROTOCOL; id: string; type: "event"; event: ReportTaskEvent }
export interface SerializedReportError { name: string; message: string; code?: string; path?: string; issues?: unknown; diagnostics?: unknown }
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
  constructor(error: SerializedReportError) {
    super(error.message); this.name = error.name; this.code = error.code; this.path = error.path; this.issues = error.issues; this.diagnostics = error.diagnostics;
  }
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function stats(value: unknown): boolean {
  if (!object(value)) return false;
  return ["rows", "pages", "cells"].every((key) => typeof value[key] === "number" && Number.isSafeInteger(value[key]) && value[key] >= 0)
    && typeof value.durationMs === "number" && Number.isFinite(value.durationMs) && value.durationMs >= 0;
}
function diagnostics(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry: unknown) => object(entry) && typeof entry.code === "string" && typeof entry.message === "string" && ["info", "warning", "error"].includes(entry.severity as string));
}
function revisions(value: unknown): boolean {
  return object(value) && Object.values(value).every((entry) => object(entry) && (entry.revision === undefined || typeof entry.revision === "string") && (entry.sourceToken === undefined || typeof entry.sourceToken === "string"));
}
/** Worker 响应使用与运行时一致的值契约，不只相信 TypeScript 类型或返回的任务 ID。 */
export function validReportWorkerResult(value: unknown, operation: ReportWorkerRequest["operation"]): value is PreparedReport | ReportRuntimeExportResult {
  if (!object(value) || !stats(value.stats) || !diagnostics(value.diagnostics) || !revisions(value.revisions)) return false;
  if (operation === "prepare") return validateRenderPlan(value.plan).ok;
  const contentType = value.format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return value.bytes instanceof Uint8Array && (value.format === "pdf" || value.format === "xlsx") && value.contentType === contentType;
}
function serializeIssue(issue: unknown): Record<string, string> {
  if (!issue || typeof issue !== "object") return { message: String(issue) };
  const result: Record<string, string> = {};
  for (const key of ["code", "path", "field", "message"]) {
    const value = (issue as Record<string, unknown>)[key];
    if (typeof value === "string") result[key] = value;
  }
  return result;
}
function serializeDiagnostic(value: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = serializeIssue(value);
  if (!object(value)) return result;
  for (const key of ["format", "severity", "kind", "nid"]) if (typeof value[key] === "string") result[key] = value[key];
  for (const key of ["pageIndex", "componentIndex"]) if (Number.isSafeInteger(value[key]) && (value[key] as number) >= 0) result[key] = value[key];
  if (Array.isArray(value.componentPath) && value.componentPath.every((index) => Number.isSafeInteger(index) && index >= 0)) result.componentPath = value.componentPath;
  return result;
}
function serializeError(error: unknown): SerializedReportError {
  if (!(error instanceof Error)) return { name: "Error", message: String(error) };
  const detail = error as Error & { code?: unknown; path?: unknown; issues?: unknown; diagnostics?: unknown };
  return { name: error.name, message: error.message,
    ...(typeof detail.code === "string" ? { code: detail.code } : {}),
    ...(typeof detail.path === "string" ? { path: detail.path } : {}),
    ...(Array.isArray(detail.issues) ? { issues: detail.issues.map(serializeIssue) } : {}),
    ...(Array.isArray(detail.diagnostics) ? { diagnostics: detail.diagnostics.map(serializeDiagnostic) } : {}) };
}
export function isReportWorkerRequest(value: unknown): value is ReportWorkerRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<ReportWorkerRequest>;
  return request.protocol === REPORT_WORKER_PROTOCOL && typeof request.id === "string" && (request.operation === "prepare" || request.operation === "export") && !!request.input && typeof request.input === "object";
}
export async function runReportWorkerRequest(runtime: ReportRuntime, request: ReportWorkerRequest, onEvent?: ReportTaskObserver): Promise<ReportWorkerResponse> {
  try {
    const result = request.operation === "prepare"
      ? await runtime.prepare({ ...request.input, onEvent } as ReportRuntimeInput)
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
  if (value.correlationId !== input.correlationId || value.reportId !== undefined && (typeof value.reportId !== "string" || !input.reportIds.includes(value.reportId))) return false;
  if (!["query", "validate", "layout", "encode"].includes(value.stage as string) || !["started", "completed", "failed"].includes(value.status as string)) return false;
  for (const key of ["completed", "total"] as const) if (value[key] !== undefined && (typeof value[key] !== "number" || !Number.isFinite(value[key]) || value[key] < 0)) return false;
  return value.completed === undefined || value.total === undefined || (value.completed as number) <= (value.total as number);
}
