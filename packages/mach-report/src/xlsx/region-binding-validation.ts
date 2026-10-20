import { validateDatasetRows } from "../schema/dataset";
import type { ExcelBindingDataset, ExcelBindingIssue } from "./binding-workflow";
import { parseImportRange, type CellRange } from "./import-range";
import type { ExcelImportResult } from "./import-types";
import { assertExcelRegionMerges, cellsInRegion, containsRegion, intersectsRegion, readExcelRegionSource, regionHeight, type ExcelRegionSource } from "./region-binding-source";
import type { ExcelRegionBinding, ExcelRegionBindingRecipe, ExcelRegionBindingValidation } from "./region-binding-types";

function errorMessage(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
function add(issues: ExcelBindingIssue[], path: string, code: ExcelBindingIssue["code"], message: string): void { issues.push({ path, code, message }); }
function checkedRange(text: string, source: ExcelRegionSource, oneRow = false): CellRange {
  const range = parseImportRange(text);
  if (!containsRegion(source.range, range)) throw new Error("绑定范围应完整位于来源工作表内");
  if (oneRow && range.top !== range.bottom) throw new Error("每个动态区域应选择一行原型；多个数据行由 repeat 自动扩展");
  assertExcelRegionMerges(source, range);
  return range;
}
function meaningful(value: ExcelRegionSource["cells"][number]): boolean {
  const cell = value.cell;
  return !!cell.formula || !!cell.children?.length || (cell.value !== null && cell.value !== undefined && cell.value !== "") || !!cell.text || !!cell.rawText;
}
function checkedHeader(region: ExcelRegionBinding, source: ExcelRegionSource, range: CellRange): CellRange | undefined {
  if (!region.headerRange) return;
  const header = checkedRange(region.headerRange, source);
  if (header.left !== range.left || header.right !== range.right || header.bottom + 1 !== range.top) throw new Error("区域表头应与原型等列宽，并紧接原型上方");
  return header;
}
function regionGeometry(region: ExcelRegionBinding, source: ExcelRegionSource): CellRange {
  const range = checkedRange(region.range, source, true), header = checkedHeader(region, source, range);
  assertExcelRegionMerges(source, { ...source.range, top: header?.top ?? range.top, bottom: range.bottom });
  const prototype = cellsInRegion(source, range);
  if (prototype.some(cell => cell.bottom !== cell.top || cell.left !== cell.right)) throw new Error("动态原型行不能包含合并格；请保留合并表头并选择其下方数据行");
  if (region.mode === "repeat") {
    const row = { ...source.range, top: header?.top ?? range.top, bottom: range.bottom };
    if (cellsInRegion(source, row).some(cell => !containsRegion({ ...range, top: row.top }, cell) && meaningful(cell))) throw new Error("纵向重复区域的旁列存在静态内容，无法安全拉伸；请扩大区域或将静态内容移至独立行");
  }
  return { ...range, top: header?.top ?? range.top };
}
function recipeStructure(recipe: ExcelRegionBindingRecipe): void {
  if (!recipe || recipe.version !== "2.0" || typeof recipe.sheet !== "string" || !Array.isArray(recipe.regions) || !recipe.regions.length || recipe.regions.length > 128) throw new Error("多区域绑定应为 version 2.0，并包含 1–128 个区域");
}
/** Geometry-only scan is separate so field-selection UI need not repeatedly traverse the source grid. */
export function validateExcelRegionGeometry(imported: ExcelImportResult, recipe: ExcelRegionBindingRecipe): ExcelBindingIssue[] {
  const issues: ExcelBindingIssue[] = [];
  try { recipeStructure(recipe); } catch (cause) { return [{ path: "$.recipe", code: "schema", message: errorMessage(cause) }]; }
  let source: ExcelRegionSource;
  try { source = readExcelRegionSource(imported, recipe.sheet); } catch (cause) { return [{ path: "$.recipe.sheet", code: "source", message: errorMessage(cause) }]; }
  const ids = new Set<string>(), ranges: { range: CellRange; mode: string; path: string }[] = [];
  recipe.regions.forEach((region, index) => {
    const path = `$.recipe.regions[${index}]`;
    try {
      if (!region || typeof region.id !== "string" || !region.id.trim() || ids.has(region.id)) throw new Error("区域标识应非空且唯一");
      ids.add(region.id);
      if (!["record", "repeat"].includes(region.mode)) throw new Error("区域模式应为 record 或 repeat");
      const range = regionGeometry(region, source);
      for (const prior of ranges) {
        if (intersectsRegion(range, prior.range)) throw new Error(`区域与 ${prior.path} 重叠（含表头）`);
        if (range.top <= prior.range.bottom && prior.range.top <= range.bottom && (region.mode === "repeat" || prior.mode === "repeat")) throw new Error("同一行不能并排放置重复区域；请按纵向顺序排列");
        if (range.top <= prior.range.bottom && prior.range.top <= range.bottom && (range.top !== prior.range.top || range.bottom !== prior.range.bottom)) throw new Error("并排单记录区域应使用相同的起止行（包括表头），避免不明确的位移");
      }
      ranges.push({ range, mode: region.mode, path });
    } catch (cause) { add(issues, path, "region", errorMessage(cause)); }
  });
  if (recipe.footerRange) try {
    const footer = checkedRange(recipe.footerRange, source);
    if (footer.left !== source.range.left || footer.right !== source.range.right || footer.bottom !== source.range.bottom) throw new Error("重复页尾应覆盖完整列宽并位于来源最后几行");
    if (ranges.some(item => item.range.bottom >= footer.top)) throw new Error("页尾与动态区域或区域表头相交");
    if (regionHeight(source, footer) >= source.page.heightMm - (source.page.marginTopMm ?? 0) - (source.page.marginBottomMm ?? 0)) throw new Error("页尾高度占满单页，不能为报表明细预留空间");
  } catch (cause) { add(issues, "$.recipe.footerRange", "region", errorMessage(cause)); }
  return issues;
}
function catalogMap(datasets: readonly ExcelBindingDataset[], issues: ExcelBindingIssue[]): Map<string, ExcelBindingDataset> {
  const catalog = new Map<string, ExcelBindingDataset>();
  for (const [index, dataset] of datasets.entries()) try {
    if (!dataset || typeof dataset.id !== "string" || !dataset.id.trim() || catalog.has(dataset.id)) throw new Error("数据集标识应非空且唯一");
    validateDatasetRows([], { fields: dataset.fields, ...(dataset.rowKey ? { rowKey: dataset.rowKey } : {}) });
    for (const field of dataset.fields) if (field.digits !== undefined && (!Number.isInteger(field.digits) || field.digits < 0 || field.digits > 100)) throw new Error("显示精度应为 0–100 的整数");
    catalog.set(dataset.id, dataset);
  } catch (cause) { add(issues, `$.datasets[${index}]`, "schema", errorMessage(cause)); }
  return catalog;
}
function regionFields(region: ExcelRegionBinding, dataset: ExcelBindingDataset, path: string, issues: ExcelBindingIssue[]): number {
  const range = parseImportRange(region.range), total = range.right - range.left + 1;
  if (!Array.isArray(region.fields) || region.fields.length !== total) { add(issues, `${path}.fields`, "mapping", "区域每个物理列应显式绑定一个字段"); return 0; }
  const fields = new Set(dataset.fields.map(field => field.field)), seen = new Set<string>();
  let mapped = 0;
  region.fields.forEach((field, index) => {
    if (!fields.has(field) || seen.has(field)) add(issues, `${path}.fields[${index}]`, "mapping", "请选择契约内已声明且不重复的字段");
    else { seen.add(field); mapped++; }
  });
  if (!region.rowKey) add(issues, `${path}.rowKey`, "row-key", "每个区域应声明稳定业务主键");
  else {
    const result = validateDatasetRows(dataset.samples ?? [], { fields: dataset.fields, rowKey: region.rowKey }, { path: `$.datasets.${dataset.id}.samples`, maxRows: 100, maxIssues: 30 });
    for (const item of result.issues) add(issues, item.path, item.code === "row-key" ? "row-key" : "schema", item.message);
  }
  for (const key of ["revisionField", "sourceTokenField"] as const) if (region[key] !== undefined && !fields.has(region[key]!)) add(issues, `${path}.${key}`, "source", "并发字段应引用同一区域数据集契约内的字段");
  if (region.mode === "record" && (dataset.samples?.length ?? 0) > 1) add(issues, path, "schema", "record 区域数据集最多一行；多行请使用 repeat");
  return mapped;
}
export function validateExcelRegionFields(recipe: ExcelRegionBindingRecipe, datasets: readonly ExcelBindingDataset[]): ExcelRegionBindingValidation {
  const issues: ExcelBindingIssue[] = [];
  try { recipeStructure(recipe); } catch (cause) { return { ok: false, issues: [{ path: "$.recipe", code: "schema", message: errorMessage(cause) }], mapped: 0, total: 0 }; }
  const catalog = catalogMap(datasets, issues);
  let mapped = 0, total = 0;
  for (const [index, region] of recipe.regions.entries()) {
    const path = `$.recipe.regions[${index}]`;
    try {
      const range = parseImportRange(region.range); total += range.right - range.left + 1;
      const dataset = catalog.get(region.dataset);
      if (!dataset) add(issues, `${path}.dataset`, "source", "请选择宿主提供的数据集契约");
      else mapped += regionFields(region, dataset, path, issues);
    } catch (cause) { add(issues, path, "schema", errorMessage(cause)); }
  }
  return { ok: issues.length === 0, issues, mapped, total };
}
export function validateExcelRegionBindings(imported: ExcelImportResult, recipe: ExcelRegionBindingRecipe, datasets: readonly ExcelBindingDataset[]): ExcelRegionBindingValidation {
  const fields = validateExcelRegionFields(recipe, datasets), issues = [...validateExcelRegionGeometry(imported, recipe), ...fields.issues];
  return { ...fields, ok: !issues.length, issues };
}
