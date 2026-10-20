import { flattenTreeInput, type TreeTableOptions } from "../processing/tree";
import type { DatasetRows, ReportTemplate } from "../layout/paginate";
import { datasetJsonSchema, type DatasetContract } from "../schema/dataset";

/** Scalar contracts and shared budgets inspect every nested node, never only root records. */
export function templateValidationDatasets(template: ReportTemplate, datasets: DatasetRows, options: { maxRows?: number; signal?: AbortSignal } = {}): DatasetRows {
  const nested = new Map<string, TreeTableOptions>();
  for (const page of template.pages) for (const component of page.components) {
    if (component.kind !== "list" || component.tree?.input !== "nested") continue;
    const existing = nested.get(component.dataset);
    if (existing && (existing.childrenField ?? "children") !== (component.tree.childrenField ?? "children")) throw new Error("同一数据集的嵌套树应使用相同 childrenField");
    nested.set(component.dataset, component.tree);
  }
  if (!nested.size) return datasets;
  const result = { ...datasets };
  for (const [dataset, tree] of nested) {
    const maxRows = Math.min(tree.maxRows ?? 100000, options.maxRows ?? Infinity);
    result[dataset] = flattenTreeInput(datasets[dataset] ?? [], { ...tree, maxRows }, options.signal);
  }
  return result;
}
export function templateDatasetRowCount(template: ReportTemplate, datasets: DatasetRows, options: { maxRows?: number; signal?: AbortSignal } = {}): number {
  return Object.values(templateValidationDatasets(template, datasets, options)).reduce((sum, rows) => sum + rows.length, 0);
}
/** A static template can describe its recursive children to server/OpenAPI consumers. */
export function templateDatasetJsonSchema(template: ReportTemplate | undefined, dataset: string, contract: DatasetContract): Record<string, unknown> {
  const schema = datasetJsonSchema(contract);
  const list = template?.pages.flatMap(page => page.components).find(component => component.kind === "list" && component.dataset === dataset && component.tree?.input === "nested");
  if (!list || list.kind !== "list" || !list.tree) return schema;
  const item = schema.items as Record<string, unknown>, field = list.tree.childrenField ?? "children";
  return { ...schema, items: { $ref: "#/$defs/treeNode" }, $defs: { treeNode: { ...item, properties: { ...item.properties as Record<string, unknown>, [field]: { anyOf: [{ type: "null" }, { type: "array", items: { $ref: "#/$defs/treeNode" } }] } } } } };
}
