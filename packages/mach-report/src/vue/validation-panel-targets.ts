import type { RenderPlan } from "../schema/render-plan";
import type { ReportValidationIssue } from "../editing/validation";
import { createReportCellIndex, type ReportCellContext } from "../editing/context";
import { reportCellEditKey } from "../editing/batch";
import { createColumnDirectory } from "./column-directory";

export interface ValidationTarget { context: ReportCellContext; label: string; ambiguous: boolean }
export function validationIssueKey(issue: ReportValidationIssue): string | null {
  if (issue.rowKey === undefined || !issue.dataset || !issue.field) return null;
  if (typeof issue.rowKey !== "string" && !(typeof issue.rowKey === "number" && Number.isFinite(issue.rowKey))) return null;
  return reportCellEditKey({ source: { sourceScope: issue.sourceScope, datasetId: issue.dataset, rowKey: issue.rowKey, field: issue.field }, address: { pageIndex: 0, componentIndex: 0, rowIndex: 0, columnIndex: 0 } });
}
function disagrees(previous: ReportCellContext, current: ReportCellContext): boolean {
  return !Object.is(previous.value, current.value) || previous.source?.revision !== current.source?.revision || previous.source?.sourceToken !== current.source?.sourceToken || previous.editable !== current.editable;
}

/** One operation-local scan for the requested issue sources, never one scan per
 * visible row or search keystroke. Metadata-only/unknown rows gain no target. */
export function validationPanelTargets(plan: RenderPlan | null | undefined, issues: readonly ReportValidationIssue[]): Map<string, ValidationTarget> {
  const needed = new Set(issues.map(validationIssueKey).filter((key): key is string => key !== null));
  const targets = new Map<string, ValidationTarget>();
  if (!plan || !needed.size) return targets;
  const labels = new Map(createColumnDirectory(plan).map(entry => [JSON.stringify([entry.tableId, entry.field]), entry.label]));
  const index = createReportCellIndex(plan);
  for (const [pageIndex, page] of plan.pages.entries()) for (const [componentIndex, component] of page.components.entries()) {
    if (!component.grid) continue;
    for (const context of index.entries(pageIndex, componentIndex)) {
      if (!context.source) continue;
      const key = reportCellEditKey(context);
      if (!needed.has(key)) continue;
      const previous = targets.get(key);
      if (previous) { if (disagrees(previous.context, context)) previous.ambiguous = true; continue; }
      targets.set(key, { context, label: labels.get(JSON.stringify([context.table?.id, context.source.field])) ?? context.source.field, ambiguous: false });
    }
  }
  return targets;
}
