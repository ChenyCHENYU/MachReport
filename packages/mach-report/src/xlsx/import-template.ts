import { assertOutputActive, outputCheckpoint, waitForOutput, type OutputTaskOptions } from "../output/progress";
import ExcelJSRuntime from "exceljs";
import type * as ExcelJS from "exceljs";
import type { TemplatePage } from "../layout/paginate";
import type { GridCell, PlanComponent } from "../schema/render-plan";
import { RENDER_PLAN_SCHEMA_VERSION } from "../schema/render-plan";
import { checkedExcelBytes } from "./import-zip";
import { importCellValue } from "./import-value";
import { importTheme, styleImporter } from "./import-style";
import { excelColumnWidthToMm } from "./column-width";
import { checkedRange, columnName, mergeLookup, mergeRowGroups, rangeName, rowSegments, selectedMerges, selectedRange, type CellRange, type RowSegment } from "./import-range";
import { ImportWarnings, resolveImportOptions, type ExcelImportOptions, type ExcelImportedSheet, type ExcelImportResult, type ResolvedImportOptions } from "./import-types";

export type { ExcelImportOptions, ExcelImportLimits, ExcelImportedSheet, ExcelImportResult } from "./import-types";

const PT_TO_MM = 25.4 / 72;

function selectSheets(workbook: ExcelJS.Workbook, options: ExcelImportOptions): ExcelJS.Worksheet[] {
  if (options.sheets === undefined) return workbook.worksheets.filter((sheet) => sheet.state === "visible");
  if (!Array.isArray(options.sheets) || options.sheets.length === 0) throw new Error("sheets 应为非空的工作表名称或一基位置数组");
  const result: ExcelJS.Worksheet[] = [];
  for (const selection of options.sheets) {
    const sheet = typeof selection === "string" ? workbook.getWorksheet(selection) : Number.isInteger(selection) && selection > 0 ? workbook.worksheets[selection - 1] : undefined;
    if (!sheet) throw new Error(`Excel 工作表不存在：${String(selection)}`);
    if (result.includes(sheet)) throw new Error(`Excel 工作表选择重复：${sheet.name}`);
    result.push(sheet);
  }
  return result;
}

function sheetRangeOption(options: ExcelImportOptions, name: string): string | undefined {
  if (typeof options.range === "string") return options.range;
  if (options.range === undefined) return undefined;
  if (options.range === null || typeof options.range !== "object" || Array.isArray(options.range)) throw new Error("range 应为 A1 范围或以工作表名为键的范围对象");
  return Object.prototype.hasOwnProperty.call(options.range, name) ? options.range[name] : undefined;
}

function safeSize(value: number, label: string, maximum: number): number {
  if (!Number.isFinite(value) || value < 0 || value > maximum) throw new Error(`${label} 无效或超过尺寸上限`);
  return Math.max(0.01, value);
}

interface SheetGeometry {
  width: number;
  pageWidth: number;
  pageHeight: number;
  margin: number;
  scale: number;
  columns: number[];
  rowHeight: (row: number) => number;
}

function sheetGeometry(sheet: ExcelJS.Worksheet, range: CellRange, options: ResolvedImportOptions, warnings: ImportWarnings): SheetGeometry {
  const columns: number[] = [];
  for (let column = range.left; column <= range.right; column++) {
    const source = sheet.getColumn(column);
    if (source.hidden) warnings.add(`${sheet.name}: 隐藏行列按隐藏尺寸保留；需要编辑时请先在 Excel 中取消隐藏`);
    const width = source.width ?? sheet.properties.defaultColWidth ?? 8.43;
    columns.push(safeSize(source.hidden || width === 0 ? 0.01 : excelColumnWidthToMm(width), "Excel 列宽", 2_000));
  }
  const naturalWidth = columns.reduce((sum, width) => sum + width, 0);
  const wide = options.layout === "wide";
  const paper = options.layout === "a3" ? [297, 420] : [210, 297];
  const pageWidth = wide ? naturalWidth : paper[options.landscape ? 1 : 0]!;
  const pageHeight = wide ? 297 : paper[options.landscape ? 0 : 1]!;
  const margin = wide ? 0 : 10;
  const width = pageWidth - 2 * margin;
  const scale = wide ? 1 : width / naturalWidth;
  if (!wide && scale < 0.5) warnings.add(`${sheet.name}: 标准纸张列宽压缩较大；完整宽表建议使用 layout: 'wide'`);
  const rowHeight = (number: number): number => {
    const source = sheet.getRow(number);
    if (source.hidden) warnings.add(`${sheet.name}: 隐藏行列按隐藏尺寸保留；需要编辑时请先在 Excel 中取消隐藏`);
    return safeSize(source.hidden ? 0.01 : (source.height ?? sheet.properties.defaultRowHeight ?? 15) * PT_TO_MM * scale, "Excel 行高", 1_000);
  };
  return { width, pageWidth, pageHeight, margin, scale, columns: columns.map((value) => value * scale), rowHeight };
}

interface SheetImportContext {
  sheet: ExcelJS.Worksheet;
  range: CellRange;
  geometry: SheetGeometry;
  merges: ReturnType<typeof mergeLookup>;
  style: ReturnType<typeof styleImporter>;
  date1904: boolean;
  warnings: ImportWarnings;
  tableId: string;
  headerBottom: number;
  options: ResolvedImportOptions;
}

function gridCells(context: SheetImportContext, segment: RowSegment): Array<Array<GridCell | null>> {
  const { sheet, range, merges, style, date1904, warnings } = context;
  const rows: Array<Array<GridCell | null>> = [];
  for (let row = segment.top; row <= segment.bottom; row++) {
    const cells: GridCell[] = [];
    for (let column = range.left; column <= range.right; column++) {
      const key = `${row}:${column}`;
      if (merges.covered.has(key)) continue;
      const source = sheet.getCell(row, column);
      const cell = importCellValue(source, date1904, sheet.name, warnings);
      const protectedSheet = (sheet as unknown as { sheetProtection?: { sheet?: boolean } }).sheetProtection?.sheet === true;
      if (protectedSheet && source.protection?.locked !== false) cell.editable = false;
      cell.style = style(source);
      const merge = merges.masters.get(key);
      if (merge) { cell.colSpan = merge.right - merge.left + 1; cell.rowSpan = merge.bottom - merge.top + 1; }
      cells.push(cell);
    }
    rows.push(cells);
  }
  return rows;
}

function gridComponent(context: SheetImportContext, segment: RowSegment, topMm: number, header: boolean): PlanComponent {
  const { geometry, range, sheet, options } = context;
  const rowHeights = Array.from({ length: segment.bottom - segment.top + 1 }, (_, index) => geometry.rowHeight(segment.top + index));
  return {
    kind: "rect", leftMm: geometry.margin, topMm,
    widthMm: geometry.width, heightMm: rowHeights.reduce((sum, height) => sum + height, 0),
    nid: `xlsx:${context.tableId}:${segment.top}`,
    grid: { cells: gridCells(context, segment), colWidthsMm: geometry.columns, rowHeightsMm: rowHeights, paddingMm: 0.25 * geometry.scale },
    table: {
      id: context.tableId, role: header ? "header" : "body",
      rowIndex: header ? -1 : segment.top - context.headerBottom - 1,
      columnKeys: Array.from({ length: range.right - range.left + 1 }, (_, index) => columnName(range.left + index)),
      title: sheet.name, layout: options.layout === "wide" ? "wide" : "page"
    },
    meta: { xlsxSheet: sheet.name, xlsxRange: rangeName({ ...range, top: segment.top, bottom: segment.bottom }) }
  };
}

function segmentPage(context: SheetImportContext, segment: RowSegment): TemplatePage {
  const { geometry, options, range, headerBottom } = context;
  const components: PlanComponent[] = [];
  let top = geometry.margin;
  if (segment.top === range.top) {
    const header = gridComponent(context, { top: segment.top, bottom: headerBottom }, top, true);
    components.push(header); top += header.heightMm;
  }
  const bodyTop = Math.max(segment.top, headerBottom + 1);
  if (bodyTop <= segment.bottom) components.push(gridComponent(context, { top: bodyTop, bottom: segment.bottom }, top, false));
  return {
    widthMm: geometry.pageWidth, heightMm: geometry.pageHeight,
    layout: options.layout === "wide" ? "wide" : "page",
    marginTopMm: geometry.margin, marginBottomMm: geometry.margin, marginLeftMm: geometry.margin, marginRightMm: geometry.margin,
    components
  };
}

function warnSheetFeatures(sheet: ExcelJS.Worksheet, warnings: ImportWarnings): void {
  const featureSource = sheet as unknown as { conditionalFormattings?: unknown[]; dataValidations?: { model: Record<string, unknown> } };
  if (sheet.state !== "visible") warnings.add(`${sheet.name}: 已按显式选择导入隐藏工作表`);
  if ((sheet as unknown as { sheetProtection?: { sheet?: boolean } }).sheetProtection?.sheet === true) warnings.add(`${sheet.name}: 已保留启用的工作表保护，锁定单元格在预览中保持只读`);
  if (featureSource.conditionalFormattings?.length) warnings.add(`${sheet.name}: 条件格式规则暂不执行，仅使用已保存的基础单元格样式`);
  if (sheet.autoFilter) warnings.add(`${sheet.name}: Excel 筛选下拉与排序操作不导入，完整保留选区单元格`);
  if (Object.keys(featureSource.dataValidations?.model ?? {}).length) warnings.add(`${sheet.name}: Excel 数据验证与下拉输入规则不导入；业务校验应由宿主配置`);
}

async function importSheet(sheet: ExcelJS.Worksheet, range: CellRange, workbook: ExcelJS.Workbook, options: ResolvedImportOptions, warnings: ImportWarnings, index: number, task: OutputTaskOptions): Promise<TemplatePage[]> {
  warnSheetFeatures(sheet, warnings);
  const merges = selectedMerges(sheet, range);
  const groups = mergeRowGroups(range, merges);
  const geometry = sheetGeometry(sheet, range, options, warnings);
  const columns = range.right - range.left + 1;
  // A very wide worksheet also needs a small vertical DOM window, not merely a row cap.
  const rowBudget = Math.max(1, Math.min(options.maxRowsPerPage, Math.floor(10_000 / columns)));
  if (groups.some((group) => (group.bottom - group.top + 1) * columns > Math.max(10_000, columns))) {
    throw new Error(`${sheet.name}: 跨行合并区域超过单段单元格预算，请缩小范围或拆分合并区域`);
  }
  const segments = rowSegments(groups, rowBudget, options.layout === "wide" ? Infinity : geometry.pageHeight - geometry.margin * 2, geometry.rowHeight);
  const context: SheetImportContext = {
    sheet, range, geometry, options, warnings,
    merges: mergeLookup(merges), style: styleImporter(importTheme(workbook), sheet.name, warnings, geometry.scale),
    date1904: workbook.properties.date1904 === true, tableId: `xlsx:${index}:${sheet.name}`, headerBottom: groups[0]!.bottom
  };
  const pages: TemplatePage[] = [];
  for (const segment of segments) {
    assertOutputActive(task.signal);
    pages.push(segmentPage(context, segment));
    // Conversion checkpoints yield without mixing segments into public Sheet progress.
    if (pages.length % 8 === 0) await outputCheckpoint({ signal: task.signal }, pages.length, segments.length);
  }
  return pages;
}

/** Common ZIP budgets and parsing for sheet inspection and actual grid import. */
export async function loadImportWorkbook(input: ArrayBuffer | Uint8Array | Blob, options: ExcelImportOptions, warnings: ImportWarnings): Promise<{ workbook: ExcelJS.Workbook; resolved: ResolvedImportOptions }> {
  assertOutputActive(options.signal);
  const resolved = resolveImportOptions(options);
  const bytes = await checkedExcelBytes(input, resolved, warnings, options);
  assertOutputActive(options.signal);
  const workbook = new ExcelJSRuntime.Workbook();
  try { await waitForOutput(workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer), options.signal); }
  catch { assertOutputActive(options.signal); throw new Error("Excel 文件解析失败；请确认它是未加密且完整的 .xlsx 文件"); }
  assertOutputActive(options.signal);
  if (workbook.worksheets.length > resolved.limits.maxSheets) throw new Error("Excel 工作表数量超过导入上限");
  return { workbook, resolved };
}
export interface ExcelWorkbookSheet {
  name: string;
  index: number;
  range: string;
  rowCount: number;
  columnCount: number;
  visible: boolean;
}
export interface ExcelWorkbookInspection { sheets: ExcelWorkbookSheet[]; warnings: string[] }
/** Internal shared conversion; the public session never exposes the mutable Workbook. */
export function inspectLoadedWorkbook(workbook: ExcelJS.Workbook, options: ExcelImportOptions, warnings: ImportWarnings): ExcelWorkbookInspection {
  const sheets = workbook.worksheets.map((sheet, index) => {
    const range = selectedRange(sheet, sheetRangeOption(options, sheet.name));
    return { name: sheet.name, index: index + 1, range: rangeName(range), rowCount: range.bottom - range.top + 1, columnCount: range.right - range.left + 1, visible: sheet.state === "visible" };
  });
  assertOutputActive(options.signal);
  return { sheets, warnings: warnings.result() };
}
/** Inspect sheet metadata before selecting a bounded import; does not construct any template grids. */
export async function inspectExcelWorkbook(input: ArrayBuffer | Uint8Array | Blob, options: ExcelImportOptions = {}): Promise<ExcelWorkbookInspection> {
  const warnings = new ImportWarnings();
  const { workbook } = await loadImportWorkbook(input, options, warnings);
  return inspectLoadedWorkbook(workbook, options, warnings);
}
/**
 * Import saved .xlsx cell values and common styles as a reusable JSON report template.
 * No formulas, macros, links, database calls or scripts are evaluated. The workbook is not modified.
 */
export async function importExcelTemplate(input: ArrayBuffer | Uint8Array | Blob, options: ExcelImportOptions = {}): Promise<ExcelImportResult> {
  const warnings = new ImportWarnings();
  const { workbook, resolved } = await loadImportWorkbook(input, options, warnings);
  return importLoadedWorkbook(workbook, options, resolved, warnings);
}

/** Internal conversion reused by a bounded session without repeating ZIP/ExcelJS parsing. */
export async function importLoadedWorkbook(workbook: ExcelJS.Workbook, options: ExcelImportOptions, resolved: ResolvedImportOptions, warnings: ImportWarnings): Promise<ExcelImportResult> {
  assertOutputActive(options.signal);
  const selected = selectSheets(workbook, options);
  if (!selected.length) throw new Error("Excel 中没有可导入的可见工作表；可通过 sheets 显式选择隐藏工作表");
  const template: ExcelImportResult["template"] = { schemaVersion: RENDER_PLAN_SCHEMA_VERSION, pages: [] };
  const sheets: ExcelImportedSheet[] = [];
  let remaining = resolved.limits.maxCells;
  for (const sheet of selected) {
    const range = selectedRange(sheet, sheetRangeOption(options, sheet.name));
    remaining -= checkedRange(range, resolved, remaining);
    const index = workbook.worksheets.indexOf(sheet) + 1;
    const pages = await importSheet(sheet, range, workbook, resolved, warnings, index, options);
    sheets.push({ name: sheet.name, index, range: rangeName(range), rowCount: range.bottom - range.top + 1, columnCount: range.right - range.left + 1, pageStart: template.pages.length, pageCount: pages.length });
    template.pages.push(...pages);
    await outputCheckpoint(options, sheets.length, selected.length);
  }
  return { template, warnings: warnings.result(), sheets };
}
