import { paginateTemplate, type DatasetRows, type ReportTemplate } from "../layout/paginate";
import { inspectOutputCapabilities, type OutputDiagnostic, type OutputFormat } from "../output/capabilities";
import { validateDatasetRows, type DatasetContract } from "../schema/dataset";
import { parseReportTemplate, type ReportTemplateDocument } from "./template-registry";
import { diffReportTemplates, type ReportTemplateDiff } from "./template-diff";
import type { RenderPlan } from "../schema/render-plan";
import { collectTemplateDatasetBindings } from "./template-bindings";
import { validateReportParams } from "./param-validation";
import { templateValidationDatasets, templateDatasetRowCount } from "./template-tree-data";

export interface ReportTemplateReviewIssue {
  code: "template" | "compatibility" | "dataset" | "field" | "sample" | "layout" | "output" | "params";
  severity: "error" | "warning";
  path: string;
  message: string;
  fixture?: string;
  pageIndex?: number;
  componentIndex?: number;
  field?: string;
}
export interface ReportTemplateFixture { name: string; datasets: DatasetRows; params?: Record<string, string> }
export interface ReportTemplateReviewOptions {
  previous?: ReportTemplateDocument;
  dataSchemas?: Readonly<Record<string, DatasetContract>>;
  fixtures?: readonly ReportTemplateFixture[];
  formats?: readonly OutputFormat[];
  maxPages?: number;
  maxCells?: number;
  maxSampleRows?: number;
  allowBreakingChanges?: boolean;
  strictOutputs?: boolean;
}
export interface ReportTemplateReview {
  ok: boolean;
  changes?: ReportTemplateDiff;
  issues: ReportTemplateReviewIssue[];
  samples: Array<{ name: string; pages: number; rows: number; diagnostics: OutputDiagnostic[] }>;
}
function checkBindings(template: ReportTemplate, schemas: Readonly<Record<string, DatasetContract>>, issues: ReportTemplateReviewIssue[]): void {
  for (const binding of collectTemplateDatasetBindings(template)) {
    const contract = Object.prototype.hasOwnProperty.call(schemas, binding.dataset) ? schemas[binding.dataset] : undefined;
    if (!contract) { issues.push({ code: "dataset", severity: "error", path: `${binding.path}.dataset`, message: `未声明数据集 ${binding.dataset}` }); continue; }
    const declared = new Set(contract.fields.map((field) => field.field));
    binding.fields.forEach(({ field, path, summary }) => {
      if (!declared.has(field) && !binding.generated.has(field) && !(summary && binding.summaries.has(field))) issues.push({ code: "field", severity: "error", path, field, message: `数据集 ${binding.dataset} 缺少字段 ${field}` });
    });
  }
}
function checkSample(fixture: ReportTemplateFixture, template: ReportTemplate, options: ReportTemplateReviewOptions, issues: ReportTemplateReviewIssue[]): boolean {
  const limit = options.maxSampleRows ?? 1000;
  let validationData: DatasetRows;
  try { validationData = templateValidationDatasets(template, fixture.datasets, { maxRows: limit }); }
  catch (error) { issues.push({ code: "sample", severity: "error", path: "$.fixtures", fixture: fixture.name, message: error instanceof Error ? error.message : String(error) }); return false; }
  const rows = Object.values(validationData).reduce((sum, values) => sum + values.length, 0);
  if (rows > limit) { issues.push({ code: "sample", severity: "error", path: "$.fixtures", fixture: fixture.name, message: `样例 ${rows} 行超过预算 ${limit}，请显式选择验收样例` }); return false; }
  const used = new Set(collectTemplateDatasetBindings(template).map((binding) => binding.dataset));
  for (const [name, schema] of Object.entries(options.dataSchemas ?? {}).filter(([name]) => used.has(name))) {
    try {
      const checked = validateDatasetRows(validationData[name], schema, { path: `$.datasets.${name}`, maxRows: limit });
      issues.push(...checked.issues.map((issue) => ({ ...issue, code: "sample" as const, severity: "error" as const, fixture: fixture.name })));
      if (!checked.ok) return false;
    } catch (error) { issues.push({ code: "dataset", severity: "error", path: `$.dataSchemas.${name}`, message: String(error) }); return false; }
  }
  return true;
}
function outputLocation(template: ReportTemplate, plan: RenderPlan, issue: OutputDiagnostic): Pick<ReportTemplateReviewIssue, "path" | "pageIndex" | "componentIndex"> {
  const component = plan.pages[issue.pageIndex]?.components[issue.componentIndex];
  const table = /^table:(\d+):(\d+)(?::|$)/.exec(component?.table?.id ?? "");
  if (table) return { path: `$.template.pages[${table[1]}].components[${table[2]}]`, pageIndex: Number(table[1]), componentIndex: Number(table[2]) };
  for (const [pageIndex, page] of template.pages.entries()) {
    const componentIndex = page.components.findIndex((item) => item === component || component?.nid !== undefined && "nid" in item && item.nid === component.nid);
    if (componentIndex >= 0) return { path: `$.template.pages[${pageIndex}].components[${componentIndex}]`, pageIndex, componentIndex };
  }
  return { path: "$.template" };
}
function sample(document: ReportTemplateDocument, fixture: ReportTemplateFixture, index: number, options: ReportTemplateReviewOptions, review: ReportTemplateReview): void {
  const params = validateReportParams(document.template.params ?? [], fixture.params ?? {});
  review.issues.push(...params.issues.map((issue) => ({ ...issue, code: "params" as const, severity: "error" as const, fixture: fixture.name, path: issue.path.replace(/^\$\.params/, `$.fixtures[${index}].params`) })));
  if (!params.ok) return;
  if (!checkSample(fixture, document.template, options, review.issues)) return;
  try {
    const { plan, warnings } = paginateTemplate(document.template, fixture.datasets, { maxPages: options.maxPages ?? 100, maxCells: options.maxCells ?? 250_000 });
    const diagnostics = (options.formats ?? ["pdf", "xlsx"]).flatMap((format) => inspectOutputCapabilities(plan, format));
    review.issues.push(...warnings.map((message) => ({ code: "layout" as const, severity: "warning" as const, path: "$.template", fixture: fixture.name, message })));
    review.issues.push(...diagnostics.map((issue) => ({ code: "output" as const, severity: options.strictOutputs ? "error" as const : "warning" as const, ...outputLocation(document.template, plan, issue), fixture: fixture.name, message: `${issue.format}: ${issue.message}` })));
    review.samples.push({ name: fixture.name, pages: plan.pages.length, rows: templateDatasetRowCount(document.template, fixture.datasets), diagnostics });
  } catch (error) { review.issues.push({ code: "layout", severity: "error", path: "$.template", fixture: fixture.name, message: error instanceof Error ? error.message : String(error) }); }
}

/** Pure preflight uses explicit samples only; it never fetches business data or publishes a draft. */
export function reviewReportTemplate(input: unknown, options: ReportTemplateReviewOptions = {}): ReportTemplateReview {
  const review: ReportTemplateReview = { ok: false, issues: [], samples: [] };
  try {
    for (const [name, number] of [["maxPages", options.maxPages], ["maxCells", options.maxCells], ["maxSampleRows", options.maxSampleRows]] as const) if (number !== undefined && (!Number.isSafeInteger(number) || number < 1)) throw new RangeError(`${name} must be a positive safe integer`);
    if ((options.fixtures?.length ?? 0) > 20) throw new RangeError("At most 20 review fixtures are allowed");
    const document = parseReportTemplate(input);
    if (options.previous) {
      review.changes = diffReportTemplates(options.previous, document);
      if (review.changes.breakingChanges && !options.allowBreakingChanges) review.issues.push({ code: "compatibility", severity: "error", path: "$.template", message: `${review.changes.breakingChanges} 项字段或结构变更需要明确确认兼容性` });
    }
    if (options.dataSchemas) checkBindings(document.template, options.dataSchemas, review.issues);
    for (const [index, fixture] of (options.fixtures ?? []).entries()) sample(document, fixture, index, options, review);
    if (!options.fixtures?.length) review.issues.push({ code: "sample", severity: "warning", path: "$.fixtures", message: "未提供验收样例，仅完成结构和字段检查，尚未验证排版与输出" });
  } catch (error) { review.issues.push({ code: "template", severity: "error", path: "$", message: error instanceof Error ? error.message : String(error) }); }
  review.ok = review.issues.every((issue) => issue.severity !== "error");
  return review;
}
