import { PaginateCellLimitError, PaginateChartComponentLimitError, PaginatePageLimitError } from "../layout/pagination-errors";
import { DEFAULT_CHART_COMPONENT_LIMIT, validateChartComponentLimit } from "../layout/chart-layout";
import type { DatasetRows, PaginateOptions, PaginateResult, ReportTemplate } from "../layout/paginate";
import type { PlanComponent, RenderPlan } from "../schema/render-plan";

export interface SourcePaginationLimits { maxPages?: number; maxCells?: number; maxChartComponents?: number }
export interface SourcePaginationBudget extends SourcePaginationLimits {
  maxChartComponents: number;
  usedPages: number;
  usedCells: number;
  usedChartComponents: number;
}
export function createSourcePaginationBudget(limits: SourcePaginationLimits): SourcePaginationBudget {
  validateChartComponentLimit(limits.maxChartComponents);
  return { maxPages: limits.maxPages, maxCells: limits.maxCells, maxChartComponents: limits.maxChartComponents ?? DEFAULT_CHART_COMPONENT_LIMIT, usedPages: 0, usedCells: 0, usedChartComponents: 0 };
}
function emptyRepeatedDataset(template: ReportTemplate, datasets: DatasetRows): boolean {
  if (!template.repeat) return false;
  const rows = Object.prototype.hasOwnProperty.call(datasets, template.repeat.dataset) ? datasets[template.repeat.dataset] : undefined;
  return Array.isArray(rows) && rows.length === 0;
}
function planCells(plan: RenderPlan): number {
  const count = (component: PlanComponent): number => component.grid?.cells.reduce((sum, row) => sum + row.reduce((size, cell) => size + (cell ? 1 + (cell.children?.reduce((total, child) => total + count(child), 0) ?? 0) : 0), 0), 0) ?? 0;
  return plan.pages.reduce((sum, page) => sum + page.components.reduce((size, component) => size + count(component), 0), 0);
}
function remainingLimit(limit: number | undefined, used: number): number | undefined { return limit === undefined ? undefined : limit - used; }
function boundedLimit(remaining: number | undefined, local?: number): number | undefined { return remaining === undefined ? local : Math.max(1, Math.min(remaining, local ?? remaining)); }

/** Combine report-local limits with the request ledger before allocating any chart primitives. */
export function sourcePagination(options: PaginateOptions | undefined, budget: SourcePaginationBudget, template: ReportTemplate, datasets: DatasetRows, signal?: AbortSignal): PaginateOptions {
  validateChartComponentLimit(options?.maxChartComponents);
  const pages = remainingLimit(budget.maxPages, budget.usedPages);
  const charts = budget.maxChartComponents - budget.usedChartComponents;
  if (pages !== undefined && pages < 1 && template.pages.length && !emptyRepeatedDataset(template, datasets)) throw new PaginatePageLimitError(0, 1);
  if (charts < 1 && template.pages.some(page => page.components.some(component => component.kind !== "list" && component.chartBinding))) throw new PaginateChartComponentLimitError(charts, 1);
  return { ...options, signal: signal ?? options?.signal,
    maxPages: boundedLimit(pages, options?.maxPages),
    maxCells: boundedLimit(remainingLimit(budget.maxCells, budget.usedCells), options?.maxCells),
    maxChartComponents: boundedLimit(charts, options?.maxChartComponents) };
}

export function accountSourcePagination(budget: SourcePaginationBudget, result: Pick<PaginateResult, "plan" | "chartComponents">): void {
  const cells = planCells(result.plan), remainingCells = remainingLimit(budget.maxCells, budget.usedCells);
  if (remainingCells !== undefined && cells > remainingCells) throw new PaginateCellLimitError(remainingCells, cells);
  budget.usedPages += result.plan.pages.length;
  budget.usedCells += cells;
  budget.usedChartComponents += result.chartComponents;
}
export function sourcePaginationError(error: unknown, budget: SourcePaginationBudget): unknown {
  if (error instanceof PaginatePageLimitError && budget.maxPages !== undefined && (error.limit === budget.maxPages - budget.usedPages || error.limit === 0)) return new PaginatePageLimitError(budget.maxPages, budget.usedPages + error.actual);
  if (error instanceof PaginateCellLimitError && budget.maxCells !== undefined) return new PaginateCellLimitError(budget.maxCells, budget.usedCells + error.actual);
  if (error instanceof PaginateChartComponentLimitError && error.limit === budget.maxChartComponents - budget.usedChartComponents) return new PaginateChartComponentLimitError(budget.maxChartComponents, budget.usedChartComponents + error.estimated);
  return error;
}
