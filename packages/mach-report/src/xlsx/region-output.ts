import type { GridCell, PlanComponent, PlanPage } from "../schema/render-plan";
import { resolveGridLayout, type GridLayout } from "../render/grid-geometry";
import { mergeComponentStyles } from "../render/style";

export interface ExcelFlowMetadata { version: "1.0"; columnStart: number }
export interface ExcelFlowPageInfo { key: string; sheet: string; widths: number[] }
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
/** Opt-in annotations must describe the actual plan geometry; arbitrary metadata cannot change export semantics. */
export function excelFlowMetadata(component: PlanComponent, fullWidthsMm: number[]): ExcelFlowMetadata | undefined {
  const value = component.meta?.xlsxFlow;
  if (value === undefined) return;
  if (!object(value) || value.version !== "1.0" || !Number.isSafeInteger(value.columnStart) || Number(value.columnStart) < 0) throw new Error("Excel 多区域几何标记无效，不能按列序猜测输出");
  if (!component.grid) throw new Error("Excel 多区域输出只接受显式网格组件");
  const metadata = value as unknown as ExcelFlowMetadata, widths = component.grid.colWidthsMm;
  if (!widths?.length || metadata.columnStart + widths.length > fullWidthsMm.length || widths.some((width, index) => Math.abs(width - fullWidthsMm[metadata.columnStart + index]!) > 0.001)) throw new Error("Excel 多区域列位置与网格列宽不一致");
  return metadata;
}
export function excelFlowPageInfo(page: PlanPage): ExcelFlowPageInfo | undefined {
  const value = page.meta?.xlsxFlow;
  if (value === undefined) {
    if (page.components.some(component => component.meta?.xlsxFlow !== undefined)) throw new Error("Excel 多区域页面缺少完整列几何标记");
    return;
  }
  const result = checkedPageMetadata(value, page.meta?.reportScope);
  for (const component of page.components) {
    const metadata = excelFlowMetadata(component, result.widths);
    if (!metadata) throw new Error("Excel 多区域页面混入没有区域几何的组件，请使用独立页面模板");
    const left = result.widths.slice(0, metadata.columnStart).reduce((sum, width) => sum + width, page.marginLeftMm ?? 0);
    const width = component.grid!.colWidthsMm!.reduce((sum, item) => sum + item, 0);
    if (Math.abs(left - component.leftMm) > 0.01 || Math.abs(width - component.widthMm) > 0.01) throw new Error("Excel 多区域标记与真实横向位置不一致");
  }
  return result;
}
function checkedPageMetadata(value: unknown, scope: unknown): ExcelFlowPageInfo {
  if (!object(value) || value.version !== "1.0" || typeof value.sheet !== "string" || !value.sheet.trim() || typeof value.templateId !== "string" || !value.templateId.trim()) throw new Error("Excel 多区域工作表标识无效");
  if (!Array.isArray(value.fullWidthsMm) || !value.fullWidthsMm.length || value.fullWidthsMm.length > 16384 || value.fullWidthsMm.some(width => typeof width !== "number" || !Number.isFinite(width) || width <= 0 || width > 2000)) throw new Error("Excel 多区域完整列宽无效");
  if (scope !== undefined && (typeof scope !== "string" || !scope.trim())) throw new Error("Excel 多区域报表命名空间无效");
  return { key: JSON.stringify([scope ?? value.templateId, value.sheet]), sheet: value.sheet, widths: value.fullWidthsMm as number[] };
}
interface PositionedGrid { component: PlanComponent; layout: GridLayout; top: number; column: number }
function coordinate(value: number): number { return Math.round(value * 1_000_000) / 1_000_000; }
function retainedComponents(page: PlanPage, position: number, total: number, continuous: boolean, headers: Set<string>): PlanComponent[] {
  return page.components.filter(component => {
    if (!continuous) return true;
    if (component.pageAnchor === "header") return position === 0;
    if (component.pageAnchor === "footer") return position === total - 1;
    if (component.table?.role !== "header") return true;
    if (headers.has(component.table.id)) return false;
    headers.add(component.table.id); return true;
  });
}
function positionedGrids(page: PlanPage, retained: PlanComponent[], continuous: boolean, widths: number[]): PositionedGrid[] {
  const removed = page.components.filter(component => !retained.includes(component) && component.table?.role === "header");
  const contentBottom = retained.filter(component => !component.pageAnchor).reduce((bottom, component) => Math.max(bottom, component.topMm + component.heightMm), page.marginTopMm ?? 0);
  return retained.map(component => {
    let top = component.topMm;
    if (continuous && component.pageAnchor === "footer") top = contentBottom;
    top -= removed.filter(header => header.topMm + header.heightMm <= top + 0.001).reduce((height, header) => height + header.heightMm, 0);
    return { component, layout: resolveGridLayout(component.grid!, component.widthMm, component.heightMm), top, column: excelFlowMetadata(component, widths)!.columnStart };
  });
}
function placeGridCells(grids: PositionedGrid[], boundaries: number[], widths: number[]): (GridCell | null)[][] {
  const rows = boundaries.length - 1;
  if (rows * widths.length > 1_000_000) throw new Error("Excel 多区域单页超过 100 万几何单元格，请减小预览分页高度或列数");
  const index = new Map(boundaries.map((position, offset) => [position, offset]));
  const anchors = new Map<string, GridCell>(), occupied = new Map<string, string>();
  for (const item of grids) for (const box of item.layout.cells) {
    if (!Object.keys(box.cell).length) continue;
    const top = index.get(coordinate(item.top + box.yMm))!, bottom = index.get(coordinate(item.top + box.yMm + box.heightMm))!;
    const left = item.column + box.ci, right = left + (box.cell.colSpan ?? 1), key = `${top}:${left}`;
    for (let row = top; row < bottom; row++) for (let column = left; column < right; column++) {
      const slot = `${row}:${column}`;
      if (occupied.has(slot)) throw new Error("Excel 多区域实际单元格互相覆盖，已终止输出，未覆盖已有内容");
      occupied.set(slot, key);
    }
    anchors.set(key, { ...box.cell, style: mergeComponentStyles(item.component.style, box.cell.style), rowSpan: bottom - top, colSpan: right - left });
  }
  return Array.from({ length: rows }, (_, row) => {
    const cells: (GridCell | null)[] = [];
    for (let column = 0; column < widths.length; column++) {
      const key = `${row}:${column}`, anchor = anchors.get(key);
      if (anchor) { cells.push(anchor); column += (anchor.colSpan ?? 1) - 1; }
      else if (!occupied.has(key)) cells.push(null);
    }
    return cells;
  });
}
/** Preserve each physical column and parallel static cells, then stitch bounded page grids vertically. */
export function composeExcelFlowPages(pages: { page: PlanPage; index: number }[], continuous: boolean): PlanComponent[] {
  const headers = new Set<string>(), result: PlanComponent[] = [];
  let expected: ExcelFlowPageInfo | undefined;
  for (const [position, { page }] of pages.entries()) {
    const info = excelFlowPageInfo(page)!;
    if (expected && (info.key !== expected.key || info.widths.length !== expected.widths.length || info.widths.some((width, index) => Math.abs(width - expected!.widths[index]!) > 0.001))) throw new Error("Excel 多区域分页的工作表或列结构不一致");
    expected ??= info;
    const retained = retainedComponents(page, position, pages.length, continuous, headers), grids = positionedGrids(page, retained, continuous, info.widths);
    if (!grids.length) continue;
    const boundaries = [...new Set(grids.flatMap(item => [...item.layout.rows.map(row => coordinate(item.top + row.pos)), coordinate(item.top + item.component.heightMm)]))].sort((a, b) => a - b);
    const cells = placeGridCells(grids, boundaries, info.widths), heights = boundaries.slice(1).map((bottom, index) => bottom - boundaries[index]!);
    result.push({ kind: "rect", leftMm: 0, topMm: 0, widthMm: info.widths.reduce((sum, width) => sum + width, 0), heightMm: heights.reduce((sum, height) => sum + height, 0), grid: { cells, colWidthsMm: info.widths, rowHeightsMm: heights } });
  }
  return result;
}
