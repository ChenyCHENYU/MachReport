import { createReportCellResolver, getReportEditSession, reportCellEditKey, ReportCellEditError, type RenderPlan, type ReportCellAddress, type ReportCellContext, type ReportCellEdit, type ReportCellInput, type ReportEditBatch, type ReportPreparedEdit } from "@agile-team/mach-report";
import { resolveGridLayout } from "../../render/grid-geometry";

export interface HistoryEditTarget { edits: readonly ReportCellEdit[]; value: "previousValue" | "value" }
export interface EditTransaction { batch: ReportEditBatch; contexts?: readonly ReportCellContext[]; prepared?: ReportPreparedEdit }
/** Serialized Worker/raw plans retain the marker but cannot retain a source-backed session. */
export function assertRecalculationReady(plan: RenderPlan, sourceAvailable: boolean): void {
  if (plan.requiresRecalculation && (!sourceAvailable || !getReportEditSession(plan))) throw new ReportCellEditError("recalculation");
}
export async function prepareHistoryTransaction(plan: RenderPlan, target: HistoryEditTarget, requestId: string, signal: AbortSignal): Promise<EditTransaction | ReportCellInput[]> {
  const stable = target.edits.every((edit) => !!edit.source);
  assertRecalculationReady(plan, stable);
  const session = getReportEditSession(plan);
  if (session && stable) return session.prepareHistory(plan, target.edits, target.value, requestId, { signal });
  const resolve = createEditAddressResolver(plan);
  return target.edits.map((edit) => { const address = resolve(edit); if (!address) throw new ReportCellEditError("missing"); return { address, value: edit[target.value] }; });
}
export function prepareCurrentTransaction(plan: RenderPlan, batch: ReportEditBatch, signal: AbortSignal): Promise<ReportPreparedEdit> | undefined {
  const stable = batch.edits.every((edit) => !!edit.source);
  assertRecalculationReady(plan, stable);
  return stable ? getReportEditSession(plan)?.prepare(plan, batch, { signal }) : undefined;
}
export interface EditAddressResolver {
  (edit: ReportCellEdit): ReportCellAddress | null;
  all(edit: ReportCellEdit): ReportCellAddress[];
}
function visibleSourceContexts(plan: RenderPlan, resolve: ReturnType<typeof createReportCellResolver>): Map<string, ReportCellContext[]> {
  const index = new Map<string, ReportCellContext[]>();
  plan.pages.forEach((page, pageIndex) => page.components.forEach((component, componentIndex) => {
    if (!component.grid) return;
    for (const box of resolveGridLayout(component.grid, component.widthMm, component.heightMm).cells) {
      const context = resolve({ pageIndex, componentIndex, rowIndex: box.ri, columnIndex: box.ci });
      if (!context?.source) continue;
      const key = reportCellEditKey(context), locations = index.get(key) ?? [];
      locations.push(context); index.set(key, locations);
    }
  }));
  return index;
}
/** One source index per publication/paint; every mirror is marked, while navigation prefers its original table. */
export function createEditAddressResolver(plan: RenderPlan): EditAddressResolver {
  const resolve = createReportCellResolver(plan), index = visibleSourceContexts(plan, resolve);
  function contexts(edit: ReportCellEdit): readonly ReportCellContext[] {
    if (edit.source) return index.get(reportCellEditKey(edit)) ?? [];
    const context = resolve(edit.address);
    if (!context) return [];
    return !edit.table || reportCellEditKey(context) === reportCellEditKey(edit) ? [context] : [];
  }
  const locate: EditAddressResolver = (edit) => {
    const locations = contexts(edit), context = locations.find((item) => item.table?.id === edit.table?.id) ?? locations[0];
    return context ? { ...context.address } : null;
  };
  locate.all = (edit) => contexts(edit).map((context) => ({ ...context.address }));
  return locate;
}
