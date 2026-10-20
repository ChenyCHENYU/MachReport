import type { TemplatePage } from "../layout/paginate";
import { resolveGridLayout } from "../render/grid-geometry";
import type { GridCell, PlanGrid } from "../schema/render-plan";
import { parseImportRange, rangeName, type CellRange } from "./import-range";
import type { ExcelImportResult } from "./import-types";

export interface ExcelSourceCell extends CellRange { cell: GridCell }
export interface ExcelRegionSource {
  page: TemplatePage;
  range: CellRange;
  widths: number[];
  heights: Map<number, number>;
  cells: ExcelSourceCell[];
  cellsByRow: Map<number, ExcelSourceCell[]>;
  topOffsets: Map<number, number>;
}
export function cloneRegionValue<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

/** Reconstruct absolute source coordinates once, including compressed merged-cell arrays. */
export function readExcelRegionSource(imported: ExcelImportResult, sheetName: string): ExcelRegionSource {
  const sheet = imported.sheets.find(item => item.name === sheetName);
  if (!sheet) throw new Error("指定的工作表不存在");
  const pages = imported.template.pages.slice(sheet.pageStart, sheet.pageStart + sheet.pageCount);
  const page = pages[0];
  if (!page) throw new Error("工作表没有可绑定的页面");
  const source: ExcelRegionSource = { page, range: parseImportRange(sheet.range), widths: [], heights: new Map(), cells: [], cellsByRow: new Map(), topOffsets: new Map() };
  for (const item of pages) for (const component of item.components) {
    if (component.kind === "list" || !component.grid || component.meta?.xlsxSheet !== sheetName) continue;
    const range = parseImportRange(String(component.meta.xlsxRange));
    if (!source.widths.length) source.widths = [...component.grid.colWidthsMm ?? []];
    component.grid.cells.forEach((_, index) => source.heights.set(range.top + index, component.grid!.rowHeightsMm?.[index] ?? 6));
    for (const box of resolveGridLayout(component.grid, component.widthMm, component.heightMm).cells) {
      const top = range.top + box.ri, left = range.left + box.ci;
      source.cells.push({ top, left, bottom: top + (box.cell.rowSpan ?? 1) - 1, right: left + (box.cell.colSpan ?? 1) - 1, cell: box.cell });
    }
  }
  if (source.widths.length !== source.range.right - source.range.left + 1 || source.heights.size !== source.range.bottom - source.range.top + 1)
    throw new Error("来源工作表几何元数据不完整");
  let top = 0;
  for (let row = source.range.top; row <= source.range.bottom; row++) { source.topOffsets.set(row, top); top += source.heights.get(row)!; }
  source.topOffsets.set(source.range.bottom + 1, top);
  for (const cell of source.cells) for (let row = cell.top; row <= cell.bottom; row++) {
    const cells = source.cellsByRow.get(row) ?? []; cells.push(cell); source.cellsByRow.set(row, cells);
  }
  return source;
}
export function intersectsRegion(a: CellRange, b: CellRange): boolean {
  return a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom;
}
export function containsRegion(outer: CellRange, inner: CellRange): boolean {
  return outer.top <= inner.top && outer.bottom >= inner.bottom && outer.left <= inner.left && outer.right >= inner.right;
}
export function regionWidth(source: ExcelRegionSource, range: CellRange): number {
  return source.widths.slice(range.left - source.range.left, range.right - source.range.left + 1).reduce((sum, width) => sum + width, 0);
}
export function regionHeight(source: ExcelRegionSource, range: CellRange): number {
  return (source.topOffsets.get(range.bottom + 1) ?? 0) - (source.topOffsets.get(range.top) ?? 0);
}
export function cellsInRegion(source: ExcelRegionSource, range: CellRange): ExcelSourceCell[] {
  const selected = new Set<ExcelSourceCell>();
  for (let row = range.top; row <= range.bottom; row++) for (const cell of source.cellsByRow.get(row) ?? []) if (intersectsRegion(cell, range)) selected.add(cell);
  return [...selected];
}
export function assertExcelRegionMerges(source: ExcelRegionSource, range: CellRange): void {
  for (const cell of cellsInRegion(source, range)) if (!containsRegion(range, cell)) throw new Error(`合并区域 ${rangeName(cell)} 跨越选区 ${rangeName(range)}`);
}
/** Cutting a merged master is forbidden; a selection must preserve its complete geometry. */
export function sliceExcelRegion(source: ExcelRegionSource, range: CellRange, masks: CellRange[] = []): PlanGrid {
  const selected = cellsInRegion(source, range);
  for (const cell of selected) if (!containsRegion(range, cell)) throw new Error(`合并区域 ${rangeName(cell)} 跨越选区 ${rangeName(range)}`);
  const cells: (GridCell | null)[][] = [], anchors = new Map<string, ExcelSourceCell>(), covered = new Set<string>();
  for (const cell of selected) {
    if (masks.some(mask => containsRegion(mask, cell))) continue;
    anchors.set(`${cell.top}:${cell.left}`, cell);
    for (let row = cell.top; row <= cell.bottom; row++) for (let column = cell.left; column <= cell.right; column++) covered.add(`${row}:${column}`);
  }
  for (let row = range.top; row <= range.bottom; row++) {
    const values: (GridCell | null)[] = [];
    for (let column = range.left; column <= range.right; column++) {
      const anchor = anchors.get(`${row}:${column}`);
      if (anchor) { values.push(cloneRegionValue(anchor.cell)); column = anchor.right; }
      else if (!covered.has(`${row}:${column}`)) values.push(null);
    }
    cells.push(values);
  }
  return { cells, colWidthsMm: source.widths.slice(range.left - source.range.left, range.right - source.range.left + 1), rowHeightsMm: Array.from({ length: range.bottom - range.top + 1 }, (_, index) => source.heights.get(range.top + index)!), paddingMm: 0.25 };
}
