import type { ExcelBindingDataset, ExcelBindingIssue, ExcelBindingRecipe } from "../xlsx/binding-workflow";
import { parseImportRange } from "../xlsx/import-range";
import type { ExcelRegionBinding, ExcelRegionBindingRecipe } from "../xlsx/region-binding-types";

export interface ExcelBindingTarget {
  regionId?: string;
  control: string;
  fieldIndex?: number;
  range?: string;
}

function datasetForIssue(issue: ExcelBindingIssue, datasets: readonly ExcelBindingDataset[]): string | undefined {
  const index = /^\$\.datasets\[(\d+)\]/.exec(issue.path)?.[1];
  if (index !== undefined) return datasets[Number(index)]?.id;
  return datasets.find(dataset => issue.path.startsWith(`$.datasets.${dataset.id}.samples`))?.id;
}

function fieldTarget(path: string, fallback: string): Pick<ExcelBindingTarget, "control" | "fieldIndex"> {
  const index = /\.fields\[(\d+)\]/.exec(path)?.[1];
  if (index !== undefined) return { control: "field", fieldIndex: Number(index) };
  return { control: path.split(".").at(-1) || fallback };
}

/** Resolve diagnostic paths inside the package; consumers never need to interpret recipe indexes. */
export function excelRegionIssueTarget(issue: ExcelBindingIssue, recipe: ExcelRegionBindingRecipe, datasets: readonly ExcelBindingDataset[]): ExcelBindingTarget {
  const index = /^\$\.recipe\.regions\[(\d+)\]/.exec(issue.path)?.[1];
  const datasetId = datasetForIssue(issue, datasets);
  const region = index === undefined ? recipe.regions.find(item => item.dataset === datasetId) : recipe.regions[Number(index)];
  if (!region) return { control: issue.path.endsWith("footerRange") ? "footer" : "regions", ...(recipe.footerRange ? { range: recipe.footerRange } : {}) };
  if (issue.path.startsWith("$.datasets")) return { regionId: region.id, range: region.range, control: issue.code === "row-key" ? "rowKey" : "contract" };
  const field = fieldTarget(issue.path, "range");
  const control = issue.code === "row-key" ? "rowKey" : field.control.startsWith("regions[") ? "range" : field.control;
  return { ...field, control, regionId: region.id, range: region.range };
}

export function excelRegionIssueRegionIds(issue: ExcelBindingIssue, recipe: ExcelRegionBindingRecipe, datasets: readonly ExcelBindingDataset[]): string[] {
  if (issue.path.startsWith("$.datasets")) {
    const datasetId = datasetForIssue(issue, datasets);
    return datasetId === undefined ? [] : recipe.regions.filter(region => region.dataset === datasetId).map(region => region.id);
  }
  const id = excelRegionIssueTarget(issue, recipe, datasets).regionId;
  return id ? [id] : [];
}

export function excelTableIssueTarget(issue: ExcelBindingIssue, recipe: ExcelBindingRecipe): ExcelBindingTarget {
  const role = /^\$\.recipe\.regions\.(title|header|detail|footer)$/.exec(issue.path)?.[1] as keyof ExcelBindingRecipe["regions"] | undefined;
  if (role) return { control: role, range: recipe.regions[role] };
  if (issue.path.startsWith("$.datasets")) return { control: issue.code === "row-key" ? "rowKey" : "contract", range: recipe.regions.detail };
  return { ...fieldTarget(issue.path, "detail"), range: recipe.regions.detail };
}

export function bindingTargetRange(target: ExcelBindingTarget): ReturnType<typeof parseImportRange> | undefined {
  if (!target.range) return;
  try {
    const range = parseImportRange(target.range);
    if (target.fieldIndex !== undefined) range.left = range.right = range.left + target.fieldIndex;
    return range;
  } catch { return; }
}

export function isIncompleteRegionIssue(issue: ExcelBindingIssue, target: ExcelBindingTarget, region: ExcelRegionBinding): boolean {
  if (target.control === "dataset") return !region.dataset;
  if (target.control === "rowKey") return !region.rowKey;
  if (target.control === "field" && target.fieldIndex !== undefined) return !region.fields[target.fieldIndex];
  return false;
}
