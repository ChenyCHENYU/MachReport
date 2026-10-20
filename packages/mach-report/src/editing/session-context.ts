import type { RenderPlan } from "../schema/render-plan";
import { createReportCellResolver, type ReportCellContext } from "./context";
import { reportCellEditKey, type ReportCellInput } from "./batch";
import type { ReportCellEdit } from "./apply";
import { ReportCellEditError } from "./value";

/** Operation-local map, never a cache of mutable plans or DOM coordinates. */
export function indexSessionContexts(plan: RenderPlan): Map<string, ReportCellContext> {
  const index = new Map<string, ReportCellContext>(), resolve = createReportCellResolver(plan);
  plan.pages.forEach((page, pageIndex) => page.components.forEach((component, componentIndex) => {
    if (!component.grid || component.table?.role !== "body") return;
    for (let rowIndex = 0; rowIndex < component.grid.cells.length; rowIndex++) for (let columnIndex = 0; columnIndex < component.table.columnKeys.length; columnIndex++) {
      const context = resolve({ pageIndex, componentIndex, rowIndex, columnIndex });
      if (context?.source && context.editable) index.set(reportCellEditKey(context), context);
    }
  }));
  return index;
}
/** Reflow changes coordinates; history targets are resolved by business source every time. */
export function relocateReportCellEdits(plan: RenderPlan, edits: readonly ReportCellEdit[], value: "previousValue" | "value"): ReportCellInput[] {
  const index = indexSessionContexts(plan), resolve = createReportCellResolver(plan);
  return edits.map((edit) => {
    const context = edit.source ? index.get(reportCellEditKey(edit)) : resolve(edit.address);
    if (!context || reportCellEditKey(context) !== reportCellEditKey(edit)) throw new ReportCellEditError("missing");
    return { address: { ...context.address }, value: edit[value] };
  });
}
