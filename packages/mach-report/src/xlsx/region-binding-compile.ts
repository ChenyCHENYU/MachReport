import type { ListComponent, ReportTemplate, TemplateComponent, TemplatePage } from "../layout/paginate";
import type { ReportFlowBand } from "../layout/flow";
import type { PlanComponent } from "../schema/render-plan";
import { bindingColumn } from "./binding-column";
import type { ExcelBindingDataset } from "./binding-workflow";
import { parseImportRange, type CellRange } from "./import-range";
import type { ExcelImportResult } from "./import-types";
import { cellsInRegion, cloneRegionValue, containsRegion, readExcelRegionSource, regionHeight, regionWidth, sliceExcelRegion, type ExcelRegionSource } from "./region-binding-source";
import type { ExcelRegionBinding, ExcelRegionBindingRecipe } from "./region-binding-types";

interface RegionBand { range: CellRange; bindings: ExcelRegionBinding[] }
function bindingRange(binding: ExcelRegionBinding): CellRange {
  const range = parseImportRange(binding.range);
  return binding.headerRange ? { ...range, top: parseImportRange(binding.headerRange).top } : range;
}
function sourceTop(source: ExcelRegionSource, row: number): number {
  return (source.page.marginTopMm ?? 0) + (source.topOffsets.get(row) ?? 0);
}
function layoutMeta(source: ExcelRegionSource, range: CellRange): Record<string, unknown> {
  return { xlsxFlow: { version: "1.0", columnStart: range.left - source.range.left } };
}
function staticComponent(source: ExcelRegionSource, recipe: ExcelRegionBindingRecipe, range: CellRange, id: string, masks: CellRange[] = []): PlanComponent {
  // Mask in absolute coordinates before compacting merged rows, preserving vertical merged neighbours.
  const grid = sliceExcelRegion(source, range, masks);
  for (const cells of grid.cells) for (const cell of cells) if (cell) { cell.editable = false; delete cell.source; }
  return { kind: "rect", nid: id, leftMm: source.page.marginLeftMm ?? 0, topMm: sourceTop(source, range.top), widthMm: regionWidth(source, range), heightMm: regionHeight(source, range), grid, meta: layoutMeta(source, range) };
}
function dynamicComponent(source: ExcelRegionSource, recipe: ExcelRegionBindingRecipe, binding: ExcelRegionBinding, dataset: ExcelBindingDataset): ListComponent {
  const range = parseImportRange(binding.range), whole = bindingRange(binding), sample = sliceExcelRegion(source, range);
  const fieldMap = new Map(dataset.fields.map(field => [field.field, field]));
  const widths = sample.colWidthsMm!;
  const columns = binding.fields.map((field, index) => {
    const column = bindingColumn(fieldMap.get(field)!);
    return { ...column, header: fieldMap.get(field)!.label ?? field, widthMm: widths[index]!, style: cloneRegionValue(sample.cells[0]?.[index]?.style ?? {}), align: "auto" as const };
  });
  return {
    kind: "list", id: `xlsx-region:${binding.id}`, dataset: binding.dataset, rowKey: binding.rowKey,
    ...(binding.revisionField ? { revisionField: binding.revisionField } : {}), ...(binding.sourceTokenField ? { sourceTokenField: binding.sourceTokenField } : {}),
    title: `${recipe.sheet} · ${binding.id}`, layout: source.page.layout ?? "wide",
    leftMm: (source.page.marginLeftMm ?? 0) + source.widths.slice(0, range.left - source.range.left).reduce((sum, width) => sum + width, 0),
    topMm: sourceTop(source, whole.top), widthMm: regionWidth(source, range), rowHeightMm: sample.rowHeightsMm![0],
    header: !!binding.headerRange, headerEveryPage: binding.mode === "repeat", ...(binding.mode === "record" ? { cardinality: "record" as const } : {}),
    ...(binding.headerRange ? { headerGrid: sliceExcelRegion(source, parseImportRange(binding.headerRange)) } : {}),
    columns, paddingMm: sample.paddingMm, meta: layoutMeta(source, range),
  };
}
function staticBands(source: ExcelRegionSource, top: number, bottom: number, reserved = 0): RegionBand[] {
  const result: RegionBand[] = [];
  const maximum = source.page.heightMm - (source.page.marginTopMm ?? 0) - (source.page.marginBottomMm ?? 0) - reserved;
  const rowBudget = Math.max(1, Math.min(100, Math.floor(10_000 / source.widths.length)));
  for (let row = top; row <= bottom;) {
    const start = row;
    let end = row, height = 0;
    while (row <= bottom) {
      let groupEnd = row;
      for (let cursor = row; cursor <= groupEnd; cursor++) for (const cell of source.cellsByRow.get(cursor) ?? []) groupEnd = Math.max(groupEnd, cell.bottom);
      if (groupEnd > bottom) throw new Error("静态合并区域跨越动态绑定边界，请调整区域");
      const groupHeight = regionHeight(source, { ...source.range, top: row, bottom: groupEnd });
      if (row > start && (groupEnd - start + 1 > rowBudget || height + groupHeight > maximum)) break;
      if (groupHeight > maximum) throw new Error("静态合并区域高度超过单页可用高度，请调整原始模板");
      height += groupHeight; end = groupEnd; row = groupEnd + 1;
    }
    result.push({ range: { ...source.range, top: start, bottom: end }, bindings: [] });
  }
  return result;
}
function sourceBands(source: ExcelRegionSource, recipe: ExcelRegionBindingRecipe): RegionBand[] {
  const sorted = [...recipe.regions].sort((a, b) => bindingRange(a).top - bindingRange(b).top);
  const result: RegionBand[] = [];
  let cursor = source.range.top;
  const reserved = recipe.footerRange ? regionHeight(source, parseImportRange(recipe.footerRange)) : 0;
  for (const binding of sorted) {
    const range = bindingRange(binding), previous = result[result.length - 1];
    if (previous?.bindings.length && previous.range.top === range.top && previous.range.bottom === range.bottom) { previous.bindings.push(binding); continue; }
    if (cursor < range.top) result.push(...staticBands(source, cursor, range.top - 1, reserved));
    result.push({ range: { ...source.range, top: range.top, bottom: range.bottom }, bindings: [binding] });
    cursor = range.bottom + 1;
  }
  const bottom = recipe.footerRange ? parseImportRange(recipe.footerRange).top - 1 : source.range.bottom;
  if (cursor <= bottom) result.push(...staticBands(source, cursor, bottom, reserved));
  return result;
}
function addBand(source: ExcelRegionSource, recipe: ExcelRegionBindingRecipe, band: RegionBand, index: number, datasets: readonly ExcelBindingDataset[]): { components: TemplateComponent[]; flow: ReportFlowBand } {
  const components: TemplateComponent[] = [];
  const masks = band.bindings.map(bindingRange);
  const repeat = band.bindings.some(binding => binding.mode === "repeat");
  const hasNeighbour = cellsInRegion(source, band.range).some(cell => !masks.some(mask => containsRegion(mask, cell)));
  if (!repeat && (!band.bindings.length || hasNeighbour)) components.push(staticComponent(source, recipe, band.range, `xlsx-static:${index}`, masks));
  for (const binding of band.bindings) components.push(dynamicComponent(source, recipe, binding, datasets.find(item => item.id === binding.dataset)!));
  return { components, flow: { componentIds: components.map(component => component.kind === "list" ? component.id! : component.nid!), topMm: sourceTop(source, band.range.top), heightMm: regionHeight(source, band.range) } };
}
/** Compiles explicit vertical bands; arbitrary horizontal expansion and nested repeats are deliberately rejected. */
export function compileExcelRegionBindings(imported: ExcelImportResult, recipe: ExcelRegionBindingRecipe, datasets: readonly ExcelBindingDataset[], templateId: string): ReportTemplate {
  const source = readExcelRegionSource(imported, recipe.sheet), page: TemplatePage = { ...cloneRegionValue(source.page), components: [] };
  const bands = sourceBands(source, recipe).map((band, index) => addBand(source, recipe, band, index, datasets));
  page.components = bands.flatMap(band => band.components);
  page.flow = { bands: bands.map(band => band.flow) };
  page.meta = { xlsxFlow: { version: "1.0", templateId, sheet: recipe.sheet, fullWidthsMm: source.widths } };
  if (recipe.footerRange) {
    const range = parseImportRange(recipe.footerRange), footer = staticComponent(source, recipe, range, "xlsx-footer");
    footer.pageAnchor = "footer"; footer.topMm = page.heightMm - (page.marginBottomMm ?? 0) - footer.heightMm;
    page.components.push(footer);
  }
  return { ...cloneRegionValue(imported.template), pages: [page] };
}
