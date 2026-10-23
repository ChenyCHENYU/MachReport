import type { PlanPage, RenderPlan } from "../schema/render-plan";

interface RecordIdentity { dataset: string; rowIndex: number; rowKey?: string | number; copyIndex: number; templatePageIndex: number }
export interface RecordNavigationEntry { page: number; rowKey?: string | number }
export interface RecordNavigationIndex { entries: RecordNavigationEntry[]; pageRecords: number[] }

function identity(page: PlanPage): RecordIdentity | undefined {
  const value = page.meta?.record as Partial<RecordIdentity> | undefined;
  if (!value || typeof value !== "object" || typeof value.dataset !== "string") return;
  if (![value.rowIndex, value.copyIndex, value.templatePageIndex].every(v => Number.isSafeInteger(v) && Number(v) >= 0)) return;
  if (value.rowKey !== undefined && typeof value.rowKey !== "string" && typeof value.rowKey !== "number") return;
  return value as RecordIdentity;
}

/** One index per plan, never one select option or DOM node per record. */
export function indexRecordNavigation(plan: RenderPlan | null): RecordNavigationIndex {
  const entries: RecordNavigationEntry[] = [], pageRecords: number[] = [];
  let previous: RecordIdentity | undefined;
  for (const [pageIndex, page] of (plan?.pages ?? []).entries()) {
    const record = identity(page);
    if (!record) { pageRecords.push(-1); previous = undefined; continue; }
    const begins = !previous || record.dataset !== previous.dataset || record.rowIndex !== previous.rowIndex || record.rowKey !== previous.rowKey || (record.copyIndex === 0 && record.templatePageIndex === 0);
    if (begins) entries.push({ page: pageIndex + 1, ...(record.rowKey === undefined ? {} : { rowKey: record.rowKey }) });
    pageRecords.push(entries.length - 1);
    previous = record;
  }
  return { entries, pageRecords };
}
