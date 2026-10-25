import type { RenderPlan, ReportCellSource } from "../schema/render-plan";
import { assertDataFields, assertDataSource, dataLimit, dataValue, indexDataRecords, ReportDataError, type ReportDataLimits, type ReportDataRecord } from "../processing/data-records";
import { editFromContext, sourceChanged, type ReportCellEdit } from "./apply";
import { reportCellEditKey, type ReportCellInput } from "./batch";
import { indexReportDataCells, type IndexedReportDataCell } from "./data-source";
import type { ReportCellContext, ReportCellValue } from "./context";

export interface ReportPrefillField { field: string; sourceField?: string; label?: string }
export interface ReportPrefillOptions extends ReportDataLimits {
  sourceScope?: string;
  datasetId: string;
  fields: readonly ReportPrefillField[];
  rows: readonly ReportDataRecord[];
  /** Default: fill only null/empty string. Existing zero, false and whitespace are data. */
  mode?: "empty" | "replace";
  maxChanges?: number;
  canEdit?(context: ReportCellContext): boolean;
}
export type ReportPrefillStatus = "matched" | "changed" | "skipped" | "conflict";
export type ReportPrefillReason = "unchanged" | "readonly" | "occupied" | "missing-source" | "missing-target" | "ambiguous" | "invalid";
export interface ReportPrefillItem {
  source: Readonly<ReportCellSource>;
  label: string;
  status: ReportPrefillStatus;
  reason?: ReportPrefillReason;
  before?: ReportCellValue;
  after?: ReportCellValue;
}
export interface ReportPrefillPreview {
  sourceScope?: string;
  datasetId: string;
  items: readonly ReportPrefillItem[];
  counts: Readonly<Record<ReportPrefillStatus, number>>;
  /** Optimistic source tokens and previous values are retained for an atomic edit. */
  edits: readonly ReportCellEdit[];
}
function empty(value: unknown): boolean { return value === null || value === undefined || value === ""; }
function evaluateItem(item: ReportPrefillItem, target: IndexedReportDataCell | undefined, options: ReportPrefillOptions): ReportCellEdit | undefined {
  if (!target) { item.reason = "missing-target"; return; }
  const { context, ambiguous } = target;
  item.before = context.value;
  if (ambiguous) { item.status = "conflict"; item.reason = "ambiguous"; return; }
  if (!context.editable || options.canEdit?.(context) === false) { item.reason = "readonly"; return; }
  if (empty(item.after)) { item.reason = "missing-source"; return; }
  if (Object.is(context.value, item.after)) { item.status = "matched"; item.reason = "unchanged"; return; }
  if (options.mode !== "replace" && !empty(context.value)) { item.reason = "occupied"; return; }
  try {
    const edit = editFromContext(context, item.after!);
    if (Object.is(edit.value, edit.previousValue)) { item.status = "matched"; item.reason = "unchanged"; return; }
    item.after = edit.value; item.status = "changed"; return edit;
  } catch { item.status = "conflict"; item.reason = "invalid"; return; }
}
/** Explicit field allowlist + stable business keys. Does not mutate, persist or replace a workbook. */
export function createReportPrefill(plan: RenderPlan, options: ReportPrefillOptions): ReportPrefillPreview {
  assertDataSource(options);
  if (options.mode !== undefined && options.mode !== "empty" && options.mode !== "replace") throw new ReportDataError("value", "Invalid prefill policy");
  const maxFields = dataLimit(options.maxFields, 256, 1024), fields = options.fields.map(field => field.field), sourceFields = [...new Set(options.fields.map(field => field.sourceField ?? field.field))];
  assertDataFields(fields, maxFields); assertDataFields(sourceFields, maxFields);
  const rows = indexDataRecords(options.rows, sourceFields, options), cells = indexReportDataCells(plan, { ...options, fields });
  const maxChanges = dataLimit(options.maxChanges, 10_000, 10_000), maxItems = dataLimit(options.maxCells, 1_000_000, 2_000_000);
  if (rows.size * fields.length > maxItems) throw new ReportDataError("limit", "Prefill review exceeds its budget");
  const items: ReportPrefillItem[] = [], edits: ReportCellEdit[] = [], counts = { matched: 0, changed: 0, skipped: 0, conflict: 0 };
  for (const row of rows.values()) for (const field of options.fields) {
    const source: ReportCellSource = { sourceScope: options.sourceScope, datasetId: options.datasetId, rowKey: row.rowKey, field: field.field };
    const item: ReportPrefillItem = { source, label: field.label ?? field.field, status: "skipped", after: dataValue(row, field.sourceField ?? field.field) };
    const key = reportCellEditKey({ address: { pageIndex: 0, componentIndex: 0, rowIndex: 0, columnIndex: 0 }, source });
    const edit = evaluateItem(item, cells.get(key), options);
    if (edit) { if (edits.length >= maxChanges) throw new ReportDataError("limit", "Prefill changes exceed the atomic edit budget"); edits.push(edit); }
    counts[item.status]++; items.push(item);
  }
  return { sourceScope: options.sourceScope, datasetId: options.datasetId, items, counts, edits };
}
/** Re-resolve coordinates after reflow; any changed value/token rejects the complete application. */
export function reportPrefillInputs(plan: RenderPlan, preview: ReportPrefillPreview, canEdit?: (context: ReportCellContext) => boolean): ReportCellInput[] {
  if (preview.counts.conflict > 0) throw new ReportDataError("conflict", "Resolve prefill conflicts before applying");
  if (preview.edits.length > 10_000) throw new ReportDataError("limit", "Prefill changes exceed the atomic edit budget");
  if (!preview.edits.length) return [];
  const fields = [...new Set(preview.edits.map(edit => edit.source!.field))];
  const cells = indexReportDataCells(plan, { sourceScope: preview.sourceScope, datasetId: preview.datasetId, fields });
  const seen = new Set<string>();
  return preview.edits.map(edit => {
    if (!edit.source || edit.source.datasetId !== preview.datasetId || edit.source.sourceScope !== preview.sourceScope) throw new ReportDataError("identity", "Prefill identity changed");
    const key = reportCellEditKey(edit), target = cells.get(key);
    if (seen.has(key)) throw new ReportDataError("duplicate", "Duplicate prefill target"); seen.add(key);
    if (!target || target.ambiguous || sourceChanged(target.context, edit) || !Object.is(target.context.value, edit.previousValue)) throw new ReportDataError("conflict", "Prefill target changed; reload the preview");
    if (!target.context.editable || canEdit?.(target.context) === false) throw new ReportDataError("conflict", "Prefill target is read-only");
    return { address: { ...target.context.address }, value: editFromContext(target.context, edit.value).value };
  });
}
