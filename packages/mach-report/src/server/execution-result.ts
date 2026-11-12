import type { PreparedReport, ReportRuntimeExportResult } from "./types";
import { matchingDiagnosticSummary, validReportDiagnosticLocation } from "./diagnostics";
import { validPreparedSources } from "./prepared";
import { hasValidDataExplanation } from "../source/data-explanation";
import { ReportSourceError } from "../source/report-source";
import { validateRenderPlan } from "../schema/validate";

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function stats(value: unknown): boolean {
  if (!object(value)) return false;
  return ["rows", "pages", "cells"].every((key) => typeof value[key] === "number" && Number.isSafeInteger(value[key]) && value[key] >= 0)
    && typeof value.durationMs === "number" && Number.isFinite(value.durationMs) && value.durationMs >= 0;
}
function diagnostics(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry: unknown) => object(entry) && typeof entry.code === "string" && typeof entry.message === "string" && ["info", "warning", "error"].includes(entry.severity as string) && hasValidDataExplanation(entry) && validReportDiagnosticLocation(entry as unknown as PreparedReport["diagnostics"][number]));
}
function revisions(value: unknown): boolean {
  return object(value) && Object.values(value).every((entry) => object(entry) && (entry.revision === undefined || typeof entry.revision === "string") && (entry.sourceToken === undefined || typeof entry.sourceToken === "string"));
}
function layoutMetrics(value: unknown): boolean {
  if (value === undefined) return true;
  return object(value) && ["heuristic", "provided", "font-bytes"].includes(value.textMetrics as string)
    && (value.fontFingerprint === undefined || typeof value.fontFingerprint === "string" && /^[a-f0-9]{64}$/.test(value.fontFingerprint));
}
function validExecutionMetadata(value: unknown): value is Record<string, unknown> {
  if (!object(value) || !stats(value.stats) || !diagnostics(value.diagnostics) || !revisions(value.revisions) || !layoutMetrics(value.layout) || !validPreparedSources(value.sources)) return false;
  return value.diagnosticSummary === undefined || matchingDiagnosticSummary(value.diagnosticSummary, value.diagnostics as PreparedReport["diagnostics"]);
}
/** Metadata is checked before the runtime's existing geometry/budget pass. */
export function assertReportPreparedMetadata(value: unknown): void {
  if (!validExecutionMetadata(value)) throw new ReportSourceError("validate", "报表执行器返回的准备结果元数据无效");
}
/** One result contract for direct executors and Worker/RPC transport. */
export function validReportExecutionResult(value: unknown, operation: "prepare" | "export" | "exportPrepared"): value is PreparedReport | ReportRuntimeExportResult {
  if (!validExecutionMetadata(value)) return false;
  if (operation === "prepare") return validateRenderPlan(value.plan).ok;
  const contentType = value.format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return value.bytes instanceof Uint8Array && (value.format === "pdf" || value.format === "xlsx") && value.contentType === contentType;
}

/** A mislabeled response must fail before its bytes become a download. */
export function assertReportExportResult(value: unknown, format: ReportRuntimeExportResult["format"]): asserts value is ReportRuntimeExportResult {
  if (!validReportExecutionResult(value, "export") || !("format" in value) || value.format !== format) {
    throw new ReportSourceError("validate", "报表执行器返回的导出结果与请求格式不一致或元数据无效");
  }
}
