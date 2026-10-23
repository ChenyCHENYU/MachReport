import { validateStoredToolDraft } from "./tool-draft-validation";
import { parseReportTemplate, type ReportTemplateDocument } from "@agile-team/mach-report";

export interface TemplateToolDraft { baseline: string; value: string }
export interface TemplateDraftRecord {
  version: 1;
  templateId: string;
  savedAt: string;
  baseline: ReportTemplateDocument;
  document: ReportTemplateDocument;
  json: string;
  appliedJson: string;
  tools: Record<string, TemplateToolDraft>;
}
export interface TemplateDraftStorageAdapter {
  read(key: string, context: { signal: AbortSignal }): string | null | Promise<string | null>;
  write(key: string, value: string, context: { signal: AbortSignal }): void | Promise<void>;
  remove(key: string, context: { signal: AbortSignal }): void | Promise<void>;
}
export interface TemplateDraftStorage {
  /** Account / project scope. Changing scope cancels previous reads and isolates recovery. */
  scope: string;
  adapter: TemplateDraftStorageAdapter;
  debounceMs?: number;
  /** UTF-16 storage budget, default 2 MiB, maximum 16 MiB. */
  maxBytes?: number;
}
/** No global storage access: hosts explicitly choose localStorage, sessionStorage or their own adapter. */
export function createTemplateDraftStorage(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">): TemplateDraftStorageAdapter {
  return {
    read: key => storage.getItem(key),
    write: (key, value) => storage.setItem(key, value),
    remove: key => storage.removeItem(key),
  };
}
export function templateDraftKey(scope: string, id: string): string {
  if (!scope.trim() || scope.length > 1024 || id.length > 1024) throw new Error("Draft scope and template identity must be bounded and non-empty");
  return `mach-report:draft:1:${JSON.stringify([scope, id])}`;
}
export function draftStorageLimits(options: TemplateDraftStorage): { maxBytes: number; debounceMs: number } {
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024, debounceMs = options.debounceMs ?? 400;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 16 * 1024 * 1024) throw new RangeError("Draft maxBytes must be between 1024 and 16777216");
  if (!Number.isSafeInteger(debounceMs) || debounceMs < 0 || debounceMs > 10000) throw new RangeError("Draft debounceMs must be between 0 and 10000");
  return { maxBytes, debounceMs };
}
export function parseTemplateDraft(value: string, templateId: string, maxBytes: number): TemplateDraftRecord {
  if (value.length * 2 > maxBytes) throw new Error("Draft exceeds storage budget");
  const record = JSON.parse(value) as TemplateDraftRecord;
  if (record.version !== 1 || record.templateId !== templateId || typeof record.savedAt !== "string" || !Number.isFinite(Date.parse(record.savedAt))) throw new Error("Invalid draft identity or version");
  for (const field of ["json", "appliedJson"] as const) if (typeof record[field] !== "string") throw new Error("Invalid draft JSON input");
  record.baseline = parseReportTemplate(record.baseline); record.document = parseReportTemplate(record.document);
  if (record.baseline.id !== templateId || record.document.id !== templateId || record.baseline.revision !== record.document.revision) throw new Error("Invalid draft baseline");
  if (!record.tools || typeof record.tools !== "object" || Array.isArray(record.tools) || Object.keys(record.tools).length > 100) throw new Error("Invalid tool drafts");
  for (const [key, tool] of Object.entries(record.tools)) {
    if (!/^(params|excel|rules:[0-9]+:[0-9]+(?::(?:detail|matrix|tree))?)$/.test(key) || !tool || typeof tool.baseline !== "string" || typeof tool.value !== "string") throw new Error("Invalid tool draft");
    validateStoredToolDraft(key, tool.value, tool.baseline);
  }
  return record;
}
