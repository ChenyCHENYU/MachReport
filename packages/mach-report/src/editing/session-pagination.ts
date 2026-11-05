import { paginateTemplateAsync, type DatasetRows, type PaginateOptions, type ReportTemplate, type PaginateResult } from "../layout/paginate";
import type { RenderPlan } from "../schema/render-plan";

/** One bounded page slice per iteration; yielding keeps preview controls and cancellation responsive. */
export async function reflowReportTemplate(template: ReportTemplate, datasets: DatasetRows, options: PaginateOptions = {}): Promise<RenderPlan> {
  return (await reflowReportTemplateResult(template, datasets, options)).plan;
}
export async function reflowReportTemplateResult(template: ReportTemplate, datasets: DatasetRows, options: PaginateOptions = {}): Promise<Pick<PaginateResult, "plan" | "chartComponents">> {
  // Row filtering/wrapping can change the page count after editing; an old known count is stale.
  return paginateTemplateAsync(template, datasets, { ...options, knownTotalPages: undefined });
}
