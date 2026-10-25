import type { RenderPlan, ReportCellSource } from "../schema/render-plan";
import { reportSourceScope } from "../source/report-identity";
import { dataLimit, ReportDataError, type ReportDataLimits } from "../processing/data-records";

interface ReviewSource extends ReportDataLimits { sourceScope?: string; datasetId: string }
/** Translate only the Vue configuration facade; core matching continues to use exact source tokens. */
export function resolveReportReviewScope(plan: RenderPlan, options: ReviewSource): string | undefined {
  const scopes = new Set<string | undefined>(), stack = plan.pages.flatMap(page => page.components);
  const maximum = dataLimit(options.maxCells, 1_000_000, 2_000_000);
  let visited = 0;
  function source(value: Pick<ReportCellSource, "datasetId" | "sourceScope"> | undefined): void { if (value?.datasetId === options.datasetId) scopes.add(value.sourceScope); }
  while (stack.length) {
    const component = stack.pop()!;
    if (++visited > maximum) throw new ReportDataError("limit", "Report source scan exceeds its budget");
    source(component.table?.source);
    for (const row of component.grid?.cells ?? []) for (const cell of row) {
      if (++visited > maximum) throw new ReportDataError("limit", "Report source scan exceeds its budget");
      if (!cell) continue;
      source(cell.source); if (cell.children) stack.push(...cell.children);
    }
  }
  if (!scopes.size) throw new ReportDataError("identity", "Current report has no business source for this dataset; reload a matching query before reviewing data");
  if (options.sourceScope === undefined) {
    if (scopes.size === 1) return scopes.values().next().value;
    throw new ReportDataError("identity", "Data review requires an explicit sourceScope for multiple business sources");
  }
  const candidates = new Set([options.sourceScope, reportSourceScope(0, "", options.sourceScope)]);
  const matches = [...candidates].filter(scope => scopes.has(scope));
  if (matches.length === 1) return matches[0];
  throw new ReportDataError("identity", "Data review sourceScope does not identify one business source");
}
