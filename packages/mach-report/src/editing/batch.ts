import type { RenderPlan, ReportCellSource } from "../schema/render-plan";
import { editFromContext, sourceChanged, type ReportCellEdit } from "./apply";
import { createReportCellResolver, type ReportCellAddress, type ReportCellValue } from "./context";
import { ReportCellEditError } from "./value";
import { applyIndexedEdits } from "./batch-apply";

export interface ReportCellInput { address: ReportCellAddress; value: ReportCellValue }
export interface ReportEditBatch {
  /** Idempotency identity; the server should bind it to the exact payload. */
  requestId: string;
  edits: ReportCellEdit[];
}
export interface ReportEditConflict {
  source?: Readonly<ReportCellSource>;
  address?: ReportCellAddress;
  message: string;
  currentValue?: ReportCellValue;
  revision?: string | number;
}
export interface ReportEditResult {
  /** A successful result may advance concurrency tokens for the affected dataset. */
  revision?: string | number;
  sourceToken?: string;
  /** Any conflict rejects the entire client batch. A server must also transact atomically. */
  conflicts?: readonly ReportEditConflict[];
}

export function reportCellEditKey(edit: Pick<ReportCellEdit, "address" | "source" | "table">): string {
  const source = edit.source;
  if (source) return JSON.stringify([source.datasetId, source.rowKey, source.field]);
  const table = edit.table;
  if (table?.columnKey !== undefined) return JSON.stringify([table.id, table.role, table.rowIndex, table.columnKey]);
  const a = edit.address;
  return JSON.stringify([a.pageIndex, a.componentIndex, a.rowIndex, a.columnIndex]);
}

/** Parse and validate every value before persistence. No plan or source objects are mutated. */
export function createReportCellEditBatch(plan: RenderPlan, inputs: readonly ReportCellInput[], requestId: string): ReportEditBatch {
  if (typeof requestId !== "string" || !requestId.trim() || !Array.isArray(inputs)) throw new ReportCellEditError("missing");
  if (inputs.length > 10_000) throw new ReportCellEditError("limit");
  const seen = new Set<string>();
  const resolve = createReportCellResolver(plan);
  const edits = inputs.map(({ address, value }) => {
    const context = resolve(address);
    if (!context) throw new ReportCellEditError("missing");
    const edit = editFromContext(context, value);
    const key = reportCellEditKey(edit);
    if (seen.has(key)) throw new ReportCellEditError("duplicate");
    seen.add(key);
    return edit;
  });
  return { requestId, edits };
}

/** Transactional from the caller's perspective: a later conflict never exposes earlier writes. */
export function applyReportCellEditBatch(plan: RenderPlan, batch: Pick<ReportEditBatch, "edits">): RenderPlan {
  if (batch.edits.length > 10_000) throw new ReportCellEditError("limit");
  const resolve = createReportCellResolver(plan);
  const seen = new Set<string>();
  const normalized = batch.edits.map((edit) => {
    const context = resolve(edit.address);
    if (!context) throw new ReportCellEditError("missing");
    const key = reportCellEditKey(edit);
    if (seen.has(key)) throw new ReportCellEditError("duplicate");
    seen.add(key);
    if (sourceChanged(context, edit) || !Object.is(context.value, edit.previousValue) || (context.cell.text ?? "") !== edit.previousText) throw new ReportCellEditError("conflict");
    return editFromContext(context, edit.value);
  });
  return applyIndexedEdits(plan, normalized);
}

/** Ordered, net changes for review; a change restored to its original value disappears. */
export function summarizeReportCellEdits(edits: readonly ReportCellEdit[]): ReportCellEdit[] {
  const result = new Map<string, ReportCellEdit>();
  for (const edit of edits) {
    const key = reportCellEditKey(edit);
    const first = result.get(key);
    const next = first ? { ...edit, previousValue: first.previousValue, previousText: first.previousText } : { ...edit };
    if (Object.is(next.previousValue, next.value)) result.delete(key);
    else result.set(key, next);
  }
  return [...result.values()];
}
