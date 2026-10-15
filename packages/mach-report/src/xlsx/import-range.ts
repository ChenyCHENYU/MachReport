import type * as ExcelJS from "exceljs";
import type { ResolvedImportOptions } from "./import-types";

export interface CellRange { top: number; left: number; bottom: number; right: number }
export interface RowSegment { top: number; bottom: number }

export function columnName(column: number): string {
  let result = "";
  for (let value = column; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + (value - 1) % 26) + result;
  return result;
}

export function rangeName(range: CellRange): string {
  return `${columnName(range.left)}${range.top}:${columnName(range.right)}${range.bottom}`;
}

function columnIndex(value: string): number {
  let result = 0;
  for (const character of value.toUpperCase()) result = result * 26 + character.charCodeAt(0) - 64;
  return result;
}

export function parseImportRange(value: string): CellRange {
  if (typeof value !== "string") throw new Error("Excel 范围应为 A1:B20 格式的字符串");
  const match = /^\$?([A-Z]{1,3})\$?([1-9]\d{0,6})(?::\$?([A-Z]{1,3})\$?([1-9]\d{0,6}))?$/i.exec(value.trim());
  if (!match) throw new Error(`Excel 范围无效：${value}`);
  const range = { left: columnIndex(match[1]!), top: Number(match[2]), right: columnIndex(match[3] ?? match[1]!), bottom: Number(match[4] ?? match[2]) };
  if (range.right < range.left || range.bottom < range.top || range.right > 16_384 || range.bottom > 1_048_576) {
    throw new Error(`Excel 范围超出边界或顺序无效：${value}`);
  }
  return range;
}

export function selectedRange(sheet: ExcelJS.Worksheet, value: string | undefined): CellRange {
  if (value !== undefined) return parseImportRange(value);
  // Worksheet.dimensions skips style-only blank cells, which are essential in an imported business template.
  const rows = (sheet.model as ExcelJS.WorksheetModel & { rows?: ExcelJS.RowModel[] }).rows ?? [];
  if (!rows.length) return { top: 1, left: 1, bottom: 1, right: 1 };
  const range: CellRange = { top: Infinity, left: Infinity, bottom: 1, right: 1 };
  for (const row of rows) {
    range.top = Math.min(range.top, row.number);
    range.bottom = Math.max(range.bottom, row.number);
    range.left = Math.min(range.left, row.min || 1);
    range.right = Math.max(range.right, row.max || 1);
  }
  return range;
}

export function checkedRange(range: CellRange, options: ResolvedImportOptions, remainingCells: number): number {
  const rows = range.bottom - range.top + 1;
  const columns = range.right - range.left + 1;
  if (rows > options.limits.maxRows || columns > options.limits.maxColumns || rows * columns > remainingCells) {
    throw new Error(`Excel 范围 ${rangeName(range)} 超过导入行、列或单元格上限；请用 sheets/range 缩小范围`);
  }
  return rows * columns;
}

function overlaps(left: CellRange, right: CellRange): boolean {
  return left.top <= right.bottom && left.bottom >= right.top && left.left <= right.right && left.right >= right.left;
}

/** Reject half a merge rather than silently lose its master value or change the template. */
export function selectedMerges(sheet: ExcelJS.Worksheet, range: CellRange): CellRange[] {
  const result: CellRange[] = [];
  for (const reference of sheet.model.merges) {
    const merge = parseImportRange(reference);
    if (!overlaps(range, merge)) continue;
    if (merge.left < range.left || merge.right > range.right || merge.top < range.top || merge.bottom > range.bottom) {
      throw new Error(`${sheet.name}: 范围 ${rangeName(range)} 截断合并单元格 ${reference}，请包含完整合并区域`);
    }
    result.push(merge);
  }
  return result;
}

/** A row group is the transitive closure of overlapping vertical merges. */
export function mergeRowGroups(range: CellRange, merges: CellRange[]): RowSegment[] {
  const rowEnds = new Map<number, number>();
  for (const merge of merges) rowEnds.set(merge.top, Math.max(rowEnds.get(merge.top) ?? merge.top, merge.bottom));
  const groups: RowSegment[] = [];
  for (let top = range.top; top <= range.bottom;) {
    let bottom = rowEnds.get(top) ?? top;
    for (let cursor = top; cursor <= bottom; cursor++) bottom = Math.max(bottom, rowEnds.get(cursor) ?? cursor);
    groups.push({ top, bottom });
    top = bottom + 1;
  }
  return groups;
}

/** Keep merges intact and bound every grid; exceptionally large groups require a smaller import range/template change. */
export function rowSegments(groups: RowSegment[], maxRows: number, maxHeight: number, rowHeight: (row: number) => number): RowSegment[] {
  const segments: RowSegment[] = [];
  let current: RowSegment | undefined;
  let height = 0;
  for (const group of groups) {
    const count = group.bottom - group.top + 1;
    if (count > 200) throw new Error("合并单元格跨越超过 200 行，无法安全分段；请先缩小或拆分该合并区域");
    let groupHeight = 0;
    for (let row = group.top; row <= group.bottom; row++) groupHeight += rowHeight(row);
    if (groupHeight > maxHeight && Number.isFinite(maxHeight)) throw new Error("合并区域或单行高度超过标准纸张可用高度；请使用 wide 或调整原模板行高");
    const nextCount = current ? group.bottom - current.top + 1 : count;
    if (current && (nextCount > maxRows || height + groupHeight > maxHeight)) {
      segments.push(current); current = undefined; height = 0;
    }
    if (!current) current = { ...group };
    else current.bottom = group.bottom;
    height += groupHeight;
  }
  if (current) segments.push(current);
  return segments;
}

/** Master and covered maps are bounded by the checked selected-cell count. */
export function mergeLookup(merges: CellRange[]): { masters: Map<string, CellRange>; covered: Set<string> } {
  const masters = new Map<string, CellRange>();
  const covered = new Set<string>();
  for (const merge of merges) {
    masters.set(`${merge.top}:${merge.left}`, merge);
    for (let row = merge.top; row <= merge.bottom; row++) {
      for (let column = merge.left; column <= merge.right; column++) {
        if (row !== merge.top || column !== merge.left) covered.add(`${row}:${column}`);
      }
    }
  }
  return { masters, covered };
}
