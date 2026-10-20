import { paginateTemplatePages, type DatasetRows, type PaginateOptions, type ReportTemplate } from "../layout/paginate";
import { templateRequiresRecalculation } from "../layout/template-calculations";
import { RENDER_PLAN_SCHEMA_VERSION, type RenderPlan } from "../schema/render-plan";

/** One bounded page slice per iteration; yielding keeps preview controls and cancellation responsive. */
export async function reflowReportTemplate(template: ReportTemplate, datasets: DatasetRows, options: PaginateOptions = {}): Promise<RenderPlan> {
  const pages: RenderPlan["pages"] = [];
  // Row filtering/wrapping can change the page count after editing; an old known count is stale.
  const pagination = { ...options, knownTotalPages: undefined };
  for (const page of paginateTemplatePages(template, datasets, pagination)) {
    pages.push(page);
    if (pages.length % 8 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (options.signal?.aborted) { const error = new Error("报表重算已取消"); error.name = "AbortError"; throw error; }
  return { schemaVersion: RENDER_PLAN_SCHEMA_VERSION, ...(templateRequiresRecalculation(template) ? { requiresRecalculation: true } : {}), pages };
}
