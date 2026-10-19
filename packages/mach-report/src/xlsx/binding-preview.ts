import type { GridCell } from "../schema/render-plan";
import { resolveGridLayout } from "../render/grid-geometry";
import { columnName, parseImportRange } from "./import-range";
import type { ExcelImportResult } from "./import-types";

export interface ExcelSheetWindowOptions {
  row?: number;
  column?: number;
  rows?: number;
  columns?: number;
}
export interface ExcelSheetWindowCell {
  address: string;
  text: string;
  row: number;
  column: number;
  rowSpan: number;
  colSpan: number;
  /** A merged master may be outside the current window; its visible fragment retains the label. */
  continued: boolean;
  style?: GridCell["style"];
}
export interface ExcelSheetWindow {
  top: number;
  bottom: number;
  left: number;
  right: number;
  source: { top: number; bottom: number; left: number; right: number };
  columns: { column: number; name: string }[];
  rows: { row: number; cells: ExcelSheetWindowCell[] }[];
}
function count(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < 1 || result > maximum)
    throw new Error(`预览窗口大小应为 1–${maximum} 的整数`);
  return result;
}
function start(
  value: number | undefined,
  minimum: number,
  maximum: number,
): number {
  const result = value ?? minimum;
  if (!Number.isInteger(result)) throw new Error("预览起点应为整数");
  return Math.max(minimum, Math.min(maximum, result));
}
/** Bounded two-dimensional source preview. Only intersecting import segments are inspected, never a workbook-sized DOM. */
export function getExcelSheetWindow(
  imported: ExcelImportResult,
  sheetName: string,
  options: ExcelSheetWindowOptions = {},
): ExcelSheetWindow {
  const sheet = imported.sheets.find((item) => item.name === sheetName);
  if (!sheet) throw new Error("指定的工作表不存在");
  const source = parseImportRange(sheet.range);
  const top = start(options.row, source.top, source.bottom),
    left = start(options.column, source.left, source.right);
  const bottom = Math.min(
    source.bottom,
    top + count(options.rows, 24, 100) - 1,
  );
  const right = Math.min(
    source.right,
    left + count(options.columns, 12, 32) - 1,
  );
  const rows = Array.from({ length: bottom - top + 1 }, (_, index) => ({
    row: top + index,
    cells: [] as ExcelSheetWindowCell[],
  }));
  const occupied = new Set<string>();
  for (const page of imported.template.pages.slice(
    sheet.pageStart,
    sheet.pageStart + sheet.pageCount,
  )) {
    for (const component of page.components) {
      if (
        component.kind === "list" ||
        !component.grid ||
        component.meta?.xlsxSheet !== sheetName
      )
        continue;
      const range = parseImportRange(String(component.meta.xlsxRange));
      if (range.bottom < top || range.top > bottom) continue;
      const layout = resolveGridLayout(
        component.grid,
        component.widthMm,
        component.heightMm,
      );
      for (const box of layout.cells)
        insertCell(box.cell, range.top + box.ri, range.left + box.ci);
    }
  }
  for (const row of rows) {
    for (let column = left; column <= right; column++)
      if (!occupied.has(`${row.row}:${column}`))
        row.cells.push({
          address: `${columnName(column)}${row.row}`,
          row: row.row,
          column,
          text: "",
          rowSpan: 1,
          colSpan: 1,
          continued: false,
        });
    row.cells.sort((a, b) => a.column - b.column);
  }
  return {
    top,
    bottom,
    left,
    right,
    source,
    rows,
    columns: Array.from({ length: right - left + 1 }, (_, index) => ({
      column: left + index,
      name: columnName(left + index),
    })),
  };

  function insertCell(cell: GridCell, row: number, column: number): void {
    const endRow = row + (cell.rowSpan ?? 1) - 1,
      endColumn = column + (cell.colSpan ?? 1) - 1;
    if (endRow < top || row > bottom || endColumn < left || column > right)
      return;
    const visibleRow = Math.max(top, row),
      visibleColumn = Math.max(left, column);
    const rowSpan = Math.min(bottom, endRow) - visibleRow + 1,
      colSpan = Math.min(right, endColumn) - visibleColumn + 1;
    rows[visibleRow - top]!.cells.push({
      address: `${columnName(column)}${row}`,
      row: visibleRow,
      column: visibleColumn,
      text: cell.text ?? cell.rawText ?? String(cell.value ?? ""),
      rowSpan,
      colSpan,
      continued: visibleRow !== row || visibleColumn !== column,
      style: cell.style,
    });
    for (let ri = visibleRow; ri < visibleRow + rowSpan; ri++)
      for (let ci = visibleColumn; ci < visibleColumn + colSpan; ci++)
        occupied.add(`${ri}:${ci}`);
  }
}
