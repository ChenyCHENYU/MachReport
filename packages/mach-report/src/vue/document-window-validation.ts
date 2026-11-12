import { snapshotReportJson } from "../schema/json-snapshot";
import { validateRenderPlan } from "../schema/validate";
import { assertOutputActive } from "../output/progress";
import type { ReportDocumentManifest } from "../server/document-store";
import type { ReportDocumentWindow, ReportDocumentWindowRequest } from "../server/document-source";
import { MachReportError } from "./errors";

export const DOCUMENT_WINDOW_LIMIT = 3;
export const DOCUMENT_WINDOW_BYTES = 8_000_000;
export const DOCUMENT_CACHE_BYTES = 16_000_000;
export const DOCUMENT_CACHE_PAGES = 7;
export function documentInputError(message: string): MachReportError { return new MachReportError("validate", message); }
function validManifest(value: ReportDocumentManifest): boolean {
  if (!value || ![value.scope, value.id, value.version].every(item => typeof item === "string" && !!item.trim() && item.length <= 256)) return false;
  if (!["building", "complete", "failed"].includes(value.state) || !Number.isSafeInteger(value.pageCount) || value.pageCount < 0 || value.pageCount > 100_000) return false;
  if (value.revision !== value.pageCount + (value.state === "building" ? 0 : 1) || !Number.isSafeInteger(value.bytes) || value.bytes < 0) return false;
  if (!value.plan || "pages" in value.plan || !validateRenderPlan({ ...value.plan, pages: [] }).ok) return false;
  return value.state !== "failed" || !!value.failure && ["cancelled", "generation"].includes(value.failure.code) && typeof value.failure.message === "string" && value.failure.message.length <= 1024;
}
/** JSON is already owned and bounded; compare terminal receipts without making
 * object key order part of the transport contract. */
function sameJson(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object" || Array.isArray(left) !== Array.isArray(right)) return false;
  const first = left as Record<string, unknown>, second = right as Record<string, unknown>, keys = Object.keys(first);
  return keys.length === Object.keys(second).length && keys.every(key => Object.prototype.hasOwnProperty.call(second, key) && sameJson(first[key], second[key]));
}
export function assertDocumentIdentity(next: ReportDocumentManifest, previous?: ReportDocumentManifest): void {
  if (!previous) return;
  if (next.scope !== previous.scope || next.id !== previous.id || next.version !== previous.version) throw documentInputError("文档版本已变化，请刷新后重新打开");
  if (next.revision < previous.revision || previous.state !== "building" && (next.revision !== previous.revision || next.state !== previous.state)) throw documentInputError("文档修订发生回退或终态被修改");
  if (next.pageCount < previous.pageCount || next.bytes < previous.bytes || !sameJson(next.plan, previous.plan)) throw documentInputError("文档已提交边界回退或计划头被修改");
  if (previous.state !== "building" && !sameJson(next, previous)) throw documentInputError("终态文档清单被修改");
}
/** Snapshot before trusting an adapter; bound bytes/nodes before schema traversal. */
export function snapshotDocumentWindow(value: ReportDocumentWindow, request: ReportDocumentWindowRequest, previous?: ReportDocumentManifest): ReportDocumentWindow {
  const result = snapshotReportJson(value, { maxBytes: DOCUMENT_WINDOW_BYTES, check: () => assertOutputActive(request.signal), error: (_code, message) => documentInputError(message) });
  if (!validManifest(result.manifest) || !Array.isArray(result.pages)) throw documentInputError("文档页窗口清单无效");
  const { manifest, pages, nextPage } = result;
  snapshotReportJson(manifest, { maxBytes: 1_000_000, error: (_code, message) => documentInputError(message) });
  assertDocumentIdentity(manifest, previous);
  if (request.version !== undefined && request.version !== manifest.version) throw documentInputError("文档返回了不同版本");
  const from = Math.min(request.fromPage, manifest.pageCount);
  if (pages.length > request.limit || nextPage !== from + pages.length || nextPage > manifest.pageCount || from < manifest.pageCount && pages.length === 0) throw documentInputError("文档页窗口边界无效");
  if (!validateRenderPlan({ ...manifest.plan, pages }).ok) throw documentInputError("文档页内容无效");
  return result;
}
