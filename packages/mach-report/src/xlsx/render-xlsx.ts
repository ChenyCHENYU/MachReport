import ExcelJSRuntime from "exceljs";
import type * as ExcelJS from "exceljs";
import type { RenderPlan } from "../schema/render-plan";
import type { ComponentStyle, GridCell, PlanComponent, PlanPage } from "../schema/render-plan";
import { resolveGridLayout, type GridLayout } from "../render/grid-geometry";
import { mergeComponentStyles, resolveFontSize } from "../render/style";
import { mmToExcelColumnWidth } from "./column-width";

/**
 * RenderPlan → xlsx 导出（B 端第二出口，对齐家族 @agile-team/mach-table-xlsx 路线）：
 * - 网格组件 → 真表格：列宽（mm→Excel 宽度）、行高（mm→pt）、colSpan/rowSpan 合并、
 *   加粗/对齐/底色/字号直译（resolveGridLayout 复用单真相源几何）
 * - 文本组件 → 合并标题行（顺序流式输出，保字号/加粗/对齐；非像素级定位，
 *   目标是"财务能直接用的对账表"而非复刻版面）
 * - 未支持组件、富文本专有内容与单元格嵌套组件跳过并计入 warnings
 */

export interface XlsxRenderOptions {
  /** 工作表命名（连续表默认使用标题，其余默认 "Sheet1" 起序）。 */
  sheetName?: (sheetIndex: number) => string;
  /** auto 默认将 wide 逻辑表合并为连续 Sheet；pages 保留逐页；continuous 要求明确的表来源。 */
  sheetMode?: "auto" | "pages" | "continuous";
  /** 宽表或连续表默认 raw，其余默认 text；显式配置可覆盖默认值。 */
  valueMode?: "text" | "raw";
  /** 连续表默认不限制打印纸型；显式 A3/A4/A5 仅设置打印适配，不改变 Excel 列宽。 */
  paperSize?: "auto" | "a3" | "a4" | "a5";
}

export interface XlsxRenderResult {
  workbook: ExcelJS.Workbook;
  buffer: ExcelJS.Buffer;
  warnings: string[];
}

const MM_TO_PT = 72 / 25.4;
const MAX_CELL_CHARACTERS = 32_767;
const MAX_CELL_LINE_FEEDS = 253;

/** 仅校验最终写入 Excel 的字符串；原始数值不受其显示文本长度影响。 */
function validateCellText(value: unknown, address: string): void {
  if (typeof value !== "string") return;
  if (value.length > MAX_CELL_CHARACTERS) {
    throw new Error(`Excel 单元格 ${address} 最多支持 32767 个字符，无法无损导出；内容未裁剪`);
  }
  let lineFeeds = 0;
  for (let index = 0; index < value.length; index++) {
    if (value.charCodeAt(index) === 10 && ++lineFeeds > MAX_CELL_LINE_FEEDS) {
      throw new Error(`Excel 单元格 ${address} 最多支持 253 个换行，无法无损导出；内容未改写`);
    }
  }
}

function argbOf(hex: string | undefined): string | undefined {
  if (!hex) return undefined;
  const h = hex.replace("#", "");
  return /^[0-9a-fA-F]{6}$/.test(h) ? `FF${h.toUpperCase()}` : undefined;
}

function cellFont(cell: ExcelJS.Cell, style: ComponentStyle = {}): void {
  cell.font = {
    name: style.fontFamily,
    bold: style.bold === true,
    italic: style.italic === true,
    underline: style.underline === true,
    size: resolveFontSize(style).fontSizePt,
    color: argbOf(style.color) ? { argb: argbOf(style.color)! } : undefined
  };
}

const EXCEL_PAPERS = {
  a3: { width: 297, height: 420, code: 8 },
  a4: { width: 210, height: 297, code: 9 },
  a5: { width: 148, height: 210, code: 11 }
} as const;

function paperSize(page: PlanPage, option: XlsxRenderOptions["paperSize"], index: number, warnings: string[]): number {
  if (option && option !== "auto") return EXCEL_PAPERS[option].code;
  const width = Math.min(page.pageWidthMm, page.pageHeightMm);
  const height = Math.max(page.pageWidthMm, page.pageHeightMm);
  const match = Object.values(EXCEL_PAPERS).find((paper) => Math.abs(width - paper.width) <= 1 && Math.abs(height - paper.height) <= 1);
  if (match) return match.code;
  warnings.push(`page ${index + 1}: 自定义纸张 ${page.pageWidthMm}×${page.pageHeightMm}mm 无对应 Excel 纸型，打印设置回退 A4；可显式配置 paperSize`);
  return EXCEL_PAPERS.a4.code;
}

function setCellValue(cell: ExcelJS.Cell, source: GridCell, mode: XlsxRenderOptions["valueMode"], warnings: string[]): void {
  const text = typeof source.text === "string" ? source.text : "";
  if (mode !== "raw" || !Object.prototype.hasOwnProperty.call(source, "value")) {
    validateCellText(text, cell.address);
    cell.value = text;
    return;
  }
  const value = source.value;
  if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
    validateCellText(value, cell.address);
    cell.value = value;
    if (source.numberFormat) cell.numFmt = source.numberFormat;
    return;
  }
  validateCellText(text, cell.address);
  cell.value = text;
  warnings.push(`原始单元格值无效，已保留显示文本：${cell.address}`);
}

interface SheetUnit {
  pages: { page: PlanPage; index: number }[];
  continuous: boolean;
  tableId?: string;
  title?: string;
}

interface TablePage {
  id: string;
  title?: string;
  wide: boolean;
}

/** 仅在整页可可靠归属同一张逻辑表时合并；普通自由布局绝不推测。 */
function tablePage(page: PlanPage): TablePage | undefined {
  const fragments = page.components.filter((comp) => comp.table !== undefined);
  const first = fragments[0]?.table;
  if (!first || typeof first.id !== "string" || !first.id.trim() || !Array.isArray(first.columnKeys) || !first.columnKeys.length) return undefined;
  for (const comp of page.components) {
    if (comp.table) {
      if (!comp.grid || comp.table.id !== first.id) return undefined;
      continue;
    }
    if (comp.grid || comp.kind !== "text") return undefined;
    if (comp.richParagraphs?.length && !comp.text && !comp.lines?.length) return undefined;
  }
  return { id: first.id, title: first.title, wide: first.layout === "wide" || page.layout === "wide" };
}

function blockedTableIds(plan: RenderPlan, candidates: (TablePage | undefined)[]): Set<string> {
  const blocked = new Set<string>();
  for (const [index, page] of plan.pages.entries()) {
    if (candidates[index]) continue;
    for (const comp of page.components) {
      if (typeof comp.table?.id === "string") blocked.add(comp.table.id);
    }
  }
  return blocked;
}

function isWidePage(page: PlanPage): boolean {
  return page.layout === "wide" || page.components.some((comp) => comp.table?.layout === "wide");
}

function sheetUnits(plan: RenderPlan, mode: XlsxRenderOptions["sheetMode"], warnings: string[]): SheetUnit[] {
  const units: SheetUnit[] = [];
  const candidates = plan.pages.map(tablePage);
  // 某页混入自由矩阵时整张逻辑表一起回退，避免只导出部分连续行。
  const blockedIds = blockedTableIds(plan, candidates);
  for (const [index, page] of plan.pages.entries()) {
    const candidate = candidates[index];
    const allowed = candidate && !blockedIds.has(candidate.id);
    const table = mode === "pages" || !allowed ? undefined : candidate;
    if (mode === "continuous" && !table) {
      throw new Error(`page ${index + 1}: continuous Excel 需要完整、单一的逻辑表来源；自由布局请使用 sheetMode: 'pages'`);
    }
    const continuous = table !== undefined && (mode === "continuous" || table.wide);
    if (!continuous && mode !== "pages" && isWidePage(page)) {
      warnings.push(`page ${index + 1}: 混合或缺少逻辑表来源，已保留独立 Sheet，未猜测合并内容`);
    }
    const previous = units[units.length - 1];
    if (continuous && previous?.continuous && previous.tableId === table.id) {
      previous.pages.push({ page, index });
    } else {
      units.push({ pages: [{ page, index }], continuous, ...(continuous ? { tableId: table.id, title: table.title } : {}) });
    }
  }
  return units;
}

interface ContinuousTableState {
  keys?: string[];
  widths?: number[];
  expectedRow: number;
  headerSeen: boolean;
}

function sameColumns<T>(expected: T[] | undefined, actual: T[], equal: (a: T, b: T) => boolean): boolean {
  return !expected || (expected.length === actual.length && expected.every((value, index) => equal(value, actual[index]!)));
}

function validateTableFragment(comp: PlanComponent, layout: GridLayout, pageIndex: number, state: ContinuousTableState): void {
  const fragment = comp.table!;
  const widths = layout.columns.map((column) => column.size);
  const keysMatch = sameColumns(state.keys, fragment.columnKeys, (a, b) => a === b);
  const widthsMatch = sameColumns(state.widths, widths, (a, b) => Math.abs(a - b) <= 0.001);
  if (fragment.columnKeys.length !== widths.length || !keysMatch || !widthsMatch) {
    throw new Error(`page ${pageIndex + 1}: 连续 Excel 逻辑表 ${fragment.id} 的列结构或列宽不一致`);
  }
  state.keys ??= fragment.columnKeys;
  state.widths ??= widths;
  if (fragment.role === "header") {
    if (fragment.rowIndex !== -1) throw new Error(`page ${pageIndex + 1}: 连续 Excel 表头 rowIndex 必须为 -1`);
    state.headerSeen = true;
  } else {
    if (!["body", "group-header", "subtotal", "grand-total"].includes(fragment.role) || fragment.rowIndex !== state.expectedRow) {
      throw new Error(`page ${pageIndex + 1}: 连续 Excel 逻辑行来源不连续或重复（期望 ${state.expectedRow}）`);
    }
    state.expectedRow += layout.rows.length;
  }
  if (layout.cells.some((box) => box.cell.children?.length)) {
    throw new Error(`page ${pageIndex + 1}: 连续 Excel 暂不支持嵌套组件；请使用独立 Sheet 导出并检查告警`);
  }
}

function validateContinuousTable(unit: SheetUnit, grids: Map<PlanComponent, GridLayout>): void {
  const state: ContinuousTableState = { expectedRow: 0, headerSeen: false };
  for (const { page, index } of unit.pages) {
    for (const comp of page.components) {
      const layout = grids.get(comp);
      if (comp.table && layout) validateTableFragment(comp, layout, index, state);
    }
  }
  if (!state.headerSeen) throw new Error("连续 Excel 逻辑表缺少明确表头来源");
}

function generatedSheetName(title: string | undefined, index: number, used: Set<string>): string {
  let base = (title?.replace(/[\\/*?:[\]]/g, " ").replace(/\s+/g, " ").trim() || `Sheet${index + 1}`)
    .slice(0, 31).replace(/^'+|'+$/g, "").trim() || `Sheet${index + 1}`;
  if (base.toLowerCase() === "history") base += " 报表";
  let name = base;
  let suffix = 1;
  while (used.has(name.toLowerCase())) {
    const tail = ` (${++suffix})`;
    name = base.slice(0, 31 - tail.length) + tail;
  }
  used.add(name.toLowerCase());
  return name;
}

interface DimensionLimits {
  column(width: number): number;
  row(height: number): number;
}

function dimensionLimits(warnings: string[]): DimensionLimits {
  const warned = new Set<string>();
  function limit(value: number, maximum: number, kind: string, warning: string): number {
    if (value <= maximum) return value;
    if (!warned.has(kind)) {
      warnings.push(warning);
      warned.add(kind);
    }
    return maximum;
  }
  return {
    column: (width) => limit(width, 255, "column", "Excel 单列宽度上限为 255 字符，超宽列已收敛至 255；单元格值完整保留，显示范围可能受限"),
    row: (height) => limit(height, 409, "row", "Excel 行高上限为 409pt，超高行已收敛至 409pt；单元格值完整保留，显示范围可能受限")
  };
}

interface SheetContents {
  components: { comp: PlanComponent; pageIndex: number }[];
  grids: Map<PlanComponent, GridLayout>;
  columnCount: number;
  textWidthMm: number;
}

function sheetContents(unit: SheetUnit): SheetContents {
  const components = unit.pages.flatMap(({ page, index }) => page.components.map((comp) => ({ comp, pageIndex: index })));
  const grids = new Map<PlanComponent, GridLayout>();
  let columnCount = 1;
  let textWidthMm = 0;
  for (const { comp } of components) {
    if (comp.grid) {
      const layout = resolveGridLayout(comp.grid, comp.widthMm, comp.heightMm);
      grids.set(comp, layout);
      columnCount = Math.max(columnCount, layout.columns.length);
    } else if (comp.kind === "text") {
      textWidthMm = Math.max(textWidthMm, comp.widthMm);
    }
  }
  if (columnCount > 16_384) throw new Error("Excel 最多支持 16384 列，无法无损导出此报表");
  return { components, grids, columnCount, textWidthMm };
}

function worksheetOptions(unit: SheetUnit, paperOption: XlsxRenderOptions["paperSize"], warnings: string[]): Partial<ExcelJS.AddWorksheetOptions> {
  const { page, index } = unit.pages[0]!;
  const explicitPaper = paperOption !== undefined && paperOption !== "auto";
  if ((unit.continuous || isWidePage(page)) && !explicitPaper) return {};
  return { pageSetup: {
    paperSize: paperSize(page, paperOption, index, warnings),
    orientation: page.pageWidthMm > page.pageHeightMm ? "landscape" : "portrait",
    fitToPage: true,
    ...(unit.continuous ? { fitToWidth: 1, fitToHeight: 0 } : {})
  } };
}

function cellBorders(style: ComponentStyle): Partial<ExcelJS.Borders> {
  const color = argbOf(style.borderColor ?? style.lineColor);
  const edge = { style: "thin" as const, ...(color ? { color: { argb: color } } : {}) };
  return {
    ...(style.borderTop !== false ? { top: edge } : {}),
    ...(style.borderLeft !== false ? { left: edge } : {}),
    ...(style.borderBottom !== false ? { bottom: edge } : {}),
    ...(style.borderRight !== false ? { right: edge } : {})
  };
}

function applyGridCellStyle(cell: ExcelJS.Cell, style: ComponentStyle): void {
  cell.alignment = { horizontal: style.align ?? "left", vertical: style.verticalAlign ?? "middle", wrapText: true };
  const background = argbOf(style.backgroundColor);
  if (background) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: background } };
  cell.border = cellBorders(style);
  cellFont(cell, style);
}

interface SheetWriter {
  sheet: ExcelJS.Worksheet;
  warnings: string[];
  limits: DimensionLimits;
  valueMode: XlsxRenderOptions["valueMode"];
}

function configureGridDimensions(writer: SheetWriter, layout: GridLayout, cursorRow: number): void {
  for (const [index, column] of layout.columns.entries()) {
    const target = writer.sheet.getColumn(index + 1);
    const width = writer.limits.column(mmToExcelColumnWidth(column.size));
    if (target.width == null || target.width < width) target.width = width;
  }
  // 行高属于网格几何，不能仅遍历可见单元格；被 rowSpan 覆盖的行也必须写入。
  for (const [index, source] of layout.rows.entries()) {
    const row = writer.sheet.getRow(cursorRow + index);
    const height = writer.limits.row(source.size * MM_TO_PT);
    if (row.height == null || row.height < height) row.height = height;
  }
}

function mergeGridCell(sheet: ExcelJS.Worksheet, box: GridLayout["cells"][number], layout: GridLayout, cursorRow: number): void {
  const colSpan = Math.max(1, Math.min(box.cell.colSpan ?? 1, layout.columns.length - box.ci));
  const rowSpan = Math.max(1, Math.min(box.cell.rowSpan ?? 1, layout.rows.length - box.ri));
  if (colSpan > 1 || rowSpan > 1) {
    sheet.mergeCells(cursorRow + box.ri, box.ci + 1, cursorRow + box.ri + rowSpan - 1, box.ci + colSpan);
  }
}

function writeGrid(writer: SheetWriter, comp: PlanComponent, layout: GridLayout, cursorRow: number, pageIndex: number): number {
  if (cursorRow + layout.rows.length - 1 > 1_048_576) throw new Error("Excel 最多支持 1048576 行，无法无损导出此报表");
  configureGridDimensions(writer, layout, cursorRow);
  for (const box of layout.cells) {
    const cell = writer.sheet.getCell(cursorRow + box.ri, box.ci + 1);
    setCellValue(cell, box.cell, writer.valueMode, writer.warnings);
    if (box.cell.children?.length) {
      writer.warnings.push(`page ${pageIndex + 1} ${comp.nid ?? comp.kind} cell ${box.ri + 1}:${box.ci + 1}: 嵌套组件内容暂不支持 xlsx 导出，已跳过`);
    }
    applyGridCellStyle(cell, mergeComponentStyles(comp.style, box.cell.style));
    mergeGridCell(writer.sheet, box, layout, cursorRow);
  }
  return cursorRow + layout.rows.length;
}

function writeText(writer: SheetWriter, comp: PlanComponent, cursorRow: number, columnCount: number, pageIndex: number): number {
  const text = Array.isArray(comp.lines) && comp.lines.length > 0 ? comp.lines.join("\n") : (comp.text ?? "");
  if (comp.richParagraphs?.length) {
    const message = text.length === 0
      ? "富文本内容暂不支持 xlsx 导出，已跳过"
      : "富文本按已有文本回退导出，内联样式未保留";
    writer.warnings.push(`page ${pageIndex + 1} ${comp.nid ?? comp.kind}: ${message}`);
  }
  const row = writer.sheet.getRow(cursorRow);
  const cell = row.getCell(1);
  validateCellText(text, cell.address);
  cell.value = text;
  cell.alignment = { horizontal: comp.style?.align ?? "left", vertical: comp.style?.verticalAlign ?? "middle", wrapText: true };
  const background = argbOf(comp.style?.backgroundColor);
  if (background) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: background } };
  cellFont(cell, comp.style);
  if (columnCount > 1) writer.sheet.mergeCells(cursorRow, 1, cursorRow, columnCount);
  row.height = writer.limits.row(comp.heightMm * MM_TO_PT);
  return cursorRow + 1;
}

function freezeHeader(sheet: ExcelJS.Worksheet, cursorRow: number, rowCount: number): void {
  const frozenRows = cursorRow + rowCount - 1;
  sheet.views = [{ state: "frozen", ySplit: frozenRows, xSplit: 0 }];
  sheet.pageSetup.printTitlesRow = `1:${frozenRows}`;
}

function writeSheet(writer: SheetWriter, contents: SheetContents, continuous: boolean): void {
  if (!contents.grids.size && contents.textWidthMm > 0) {
    writer.sheet.getColumn(1).width = writer.limits.column(mmToExcelColumnWidth(contents.textWidthMm));
  }
  let cursorRow = 1;
  let headerWritten = false;
  for (const { comp, pageIndex } of contents.components) {
    const header = continuous && comp.table?.role === "header";
    if (header && headerWritten) continue;
    if (cursorRow > 1_048_576) throw new Error("Excel 最多支持 1048576 行，无法无损导出此报表");
    const layout = contents.grids.get(comp);
    if (layout) {
      if (header) { freezeHeader(writer.sheet, cursorRow, layout.rows.length); headerWritten = true; }
      cursorRow = writeGrid(writer, comp, layout, cursorRow, pageIndex);
    } else if (comp.kind === "text") {
      cursorRow = writeText(writer, comp, cursorRow, contents.columnCount, pageIndex);
    } else {
      writer.warnings.push(`page ${pageIndex + 1} ${comp.nid ?? comp.kind}: 组件类型 ${comp.kind} 暂不支持 xlsx 导出，已跳过`);
    }
  }
}

function validateOptions(options: XlsxRenderOptions): void {
  if (options.valueMode !== undefined && options.valueMode !== "text" && options.valueMode !== "raw") {
    throw new Error("xlsx valueMode 必须是 text 或 raw");
  }
  if (options.paperSize !== undefined && options.paperSize !== "auto" && !Object.prototype.hasOwnProperty.call(EXCEL_PAPERS, options.paperSize)) {
    throw new Error("xlsx paperSize 必须是 auto、a3、a4 或 a5");
  }
  if (options.sheetMode !== undefined && !["auto", "pages", "continuous"].includes(options.sheetMode)) {
    throw new Error("xlsx sheetMode 必须是 auto、pages 或 continuous");
  }
}

export async function renderPlanToXlsx(plan: RenderPlan, options: XlsxRenderOptions = {}): Promise<XlsxRenderResult> {
  validateOptions(options);
  const workbook = new ExcelJSRuntime.Workbook();
  const warnings: string[] = [];
  const limits = dimensionLimits(warnings);
  const units = sheetUnits(plan, options.sheetMode, warnings);
  const usedNames = new Set<string>();
  for (const [sheetIndex, unit] of units.entries()) {
    const contents = sheetContents(unit);
    if (unit.continuous) validateContinuousTable(unit, contents.grids);
    const page = unit.pages[0]!.page;
    const name = options.sheetName?.(sheetIndex) ?? generatedSheetName(unit.title, sheetIndex, usedNames);
    usedNames.add(name.toLowerCase());
    const sheet = workbook.addWorksheet(name, worksheetOptions(unit, options.paperSize, warnings));
    const valueMode = options.valueMode ?? (isWidePage(page) || unit.continuous ? "raw" : "text");
    writeSheet({ sheet, warnings, limits, valueMode }, contents, unit.continuous);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return { workbook, buffer, warnings };
}
