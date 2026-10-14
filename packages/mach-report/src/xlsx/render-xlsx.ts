import ExcelJSRuntime from "exceljs";
import type * as ExcelJS from "exceljs";
import type { RenderPlan } from "../schema/render-plan";
import type { ComponentStyle, GridCell, PlanComponent, PlanPage } from "../schema/render-plan";
import { resolveGridLayout, type GridLayout } from "../render/grid-geometry";
import { resolveFontSize } from "../render/style";

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
/** Excel 列宽单位 ≈ 7px（Calibri 11）；96dpi 下 mm→px 再除 7 */
const MM_TO_COL_WIDTH = (96 / 25.4) / 7;
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
    if (typeof value === "number" && source.numberFormat) cell.numFmt = source.numberFormat;
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

function sheetUnits(plan: RenderPlan, mode: XlsxRenderOptions["sheetMode"], warnings: string[]): SheetUnit[] {
  const units: SheetUnit[] = [];
  const candidates = plan.pages.map((page) => tablePage(page));
  // 某页混入自由矩阵时整张逻辑表一起回退，避免只导出部分连续行。
  const blockedIds = new Set<string>();
  for (const [index, page] of plan.pages.entries()) {
    if (candidates[index]) continue;
    for (const comp of page.components) {
      if (typeof comp.table?.id === "string") blockedIds.add(comp.table.id);
    }
  }
  for (const [index, page] of plan.pages.entries()) {
    const candidate = candidates[index];
    const table = mode !== "pages" && (mode === "continuous" || !candidate || !blockedIds.has(candidate.id)) ? candidate : undefined;
    if (mode === "continuous" && !table) {
      throw new Error(`page ${index + 1}: continuous Excel 需要完整、单一的逻辑表来源；自由布局请使用 sheetMode: 'pages'`);
    }
    const continuous = table !== undefined && (mode === "continuous" || table.wide);
    if (!continuous && mode !== "pages" && (page.layout === "wide" || page.components.some((comp) => comp.table?.layout === "wide"))) {
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

function validateContinuousTable(unit: SheetUnit): void {
  let keys: string[] | undefined;
  let widths: number[] | undefined;
  let expectedRow = 0;
  let headerSeen = false;
  for (const { page, index } of unit.pages) {
    for (const comp of page.components) {
      if (!comp.table || !comp.grid) continue;
      const fragment = comp.table;
      const layout = resolveGridLayout(comp.grid, comp.widthMm, comp.heightMm);
      const currentWidths = layout.columns.map((column) => column.size);
      if (
        fragment.columnKeys.length !== currentWidths.length ||
        (keys && (keys.length !== fragment.columnKeys.length || keys.some((key, i) => key !== fragment.columnKeys[i]))) ||
        (widths && (widths.length !== currentWidths.length || widths.some((width, i) => Math.abs(width - currentWidths[i]!) > 0.001)))
      ) {
        throw new Error(`page ${index + 1}: 连续 Excel 逻辑表 ${fragment.id} 的列结构或列宽不一致`);
      }
      keys ??= fragment.columnKeys;
      widths ??= currentWidths;
      if (fragment.role === "header") {
        if (fragment.rowIndex !== -1) throw new Error(`page ${index + 1}: 连续 Excel 表头 rowIndex 必须为 -1`);
        headerSeen = true;
      } else {
        if (!["body", "group-header", "subtotal", "grand-total"].includes(fragment.role) || fragment.rowIndex !== expectedRow) {
          throw new Error(`page ${index + 1}: 连续 Excel 逻辑行来源不连续或重复（期望 ${expectedRow}）`);
        }
        expectedRow += layout.rows.length;
      }
      if (layout.cells.some((box) => box.cell.children?.length)) {
        throw new Error(`page ${index + 1}: 连续 Excel 暂不支持嵌套组件；请使用独立 Sheet 导出并检查告警`);
      }
    }
  }
  if (!headerSeen) throw new Error("连续 Excel 逻辑表缺少明确表头来源");
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

export async function renderPlanToXlsx(
  plan: RenderPlan,
  options: XlsxRenderOptions = {}
): Promise<XlsxRenderResult> {
  if (options.valueMode !== undefined && options.valueMode !== "text" && options.valueMode !== "raw") {
    throw new Error("xlsx valueMode 必须是 text 或 raw");
  }
  if (options.paperSize !== undefined && options.paperSize !== "auto" && !Object.prototype.hasOwnProperty.call(EXCEL_PAPERS, options.paperSize)) {
    throw new Error("xlsx paperSize 必须是 auto、a3、a4 或 a5");
  }
  if (options.sheetMode !== undefined && !["auto", "pages", "continuous"].includes(options.sheetMode)) {
    throw new Error("xlsx sheetMode 必须是 auto、pages 或 continuous");
  }
  const workbook = new ExcelJSRuntime.Workbook();
  const warnings: string[] = [];
  const dimensionWarnings = new Set<"column" | "row">();
  const limitColumnWidth = (width: number): number => {
    if (width <= 255) return width;
    if (!dimensionWarnings.has("column")) {
      warnings.push("Excel 单列宽度上限为 255 字符，超宽列已收敛至 255；单元格值完整保留，显示范围可能受限");
      dimensionWarnings.add("column");
    }
    return 255;
  };
  const limitRowHeight = (height: number): number => {
    if (height <= 409) return height;
    if (!dimensionWarnings.has("row")) {
      warnings.push("Excel 行高上限为 409pt，超高行已收敛至 409pt；单元格值完整保留，显示范围可能受限");
      dimensionWarnings.add("row");
    }
    return 409;
  };
  const units = sheetUnits(plan, options.sheetMode, warnings);
  const usedNames = new Set<string>();

  units.forEach((unit, sheetIndex) => {
    if (unit.continuous) validateContinuousTable(unit);
    const { page, index: pageIndex } = unit.pages[0]!;
    const name = options.sheetName?.(sheetIndex) ?? generatedSheetName(unit.title, sheetIndex, usedNames);
    usedNames.add(name.toLowerCase());
    const naturalWide = page.layout === "wide" || page.components.some((comp) => comp.table?.layout === "wide");
    const configurePaper = (!unit.continuous && !naturalWide) || (options.paperSize !== undefined && options.paperSize !== "auto");
    const sheet = workbook.addWorksheet(
      name,
      configurePaper ? {
        pageSetup: {
          paperSize: paperSize(page, options.paperSize, pageIndex, warnings),
          orientation: page.pageWidthMm > page.pageHeightMm ? "landscape" : "portrait",
          fitToPage: true,
          ...(unit.continuous ? { fitToWidth: 1, fitToHeight: 0 } : {})
        }
      } : {}
    );
    const valueMode = options.valueMode ?? (naturalWide || unit.continuous ? "raw" : "text");
    const components = unit.pages.flatMap((entry) => entry.page.components.map((comp) => ({ comp, pageIndex: entry.index })));

    // 标题沿用真实表格列数；Excel 列宽单位不能当作列数量。
    const gridLayouts = new Map<PlanComponent, GridLayout>();
    let sheetColumnCount = 1;
    let textWidthMm = 0;
    for (const { comp } of components) {
      if (comp.grid) {
        const layout = resolveGridLayout(comp.grid, comp.widthMm, comp.heightMm);
        gridLayouts.set(comp, layout);
        sheetColumnCount = Math.max(sheetColumnCount, layout.columns.length);
      } else if (comp.kind === "text") {
        textWidthMm = Math.max(textWidthMm, comp.widthMm);
      }
    }
    if (sheetColumnCount > 16_384) throw new Error("Excel 最多支持 16384 列，无法无损导出此报表");
    if (gridLayouts.size === 0 && textWidthMm > 0) {
      sheet.getColumn(1).width = limitColumnWidth(textWidthMm * MM_TO_COL_WIDTH);
    }

    let cursorRow = 1;
    let headerWritten = false;
    for (const { comp, pageIndex } of components) {
      if (unit.continuous && comp.table?.role === "header") {
        if (headerWritten) continue;
        headerWritten = true;
      }
      if (cursorRow > 1_048_576) throw new Error("Excel 最多支持 1048576 行，无法无损导出此报表");
      if (comp.grid) {
        const layout = gridLayouts.get(comp)!;
        if (cursorRow + layout.rows.length - 1 > 1_048_576) throw new Error("Excel 最多支持 1048576 行，无法无损导出此报表");
        if (unit.continuous && comp.table?.role === "header") {
          const frozenRows = cursorRow + layout.rows.length - 1;
          sheet.views = [{ state: "frozen", ySplit: frozenRows, xSplit: 0 }];
          sheet.pageSetup.printTitlesRow = `1:${frozenRows}`;
        }
        // 列宽：优先 colWidthsMm，否则按解析结果
        const colCount = Math.max(layout.columns.length, 1);
        const widths: number[] = [];
        for (let i = 0; i < colCount; i++) {
          widths.push(layout.columns[i]?.size ?? comp.widthMm / colCount);
        }
        for (let i = 0; i < colCount; i++) {
          const col = sheet.getColumn(i + 1);
          const width = limitColumnWidth(widths[i]! * MM_TO_COL_WIDTH);
          if (col.width == null || col.width < width) {
            col.width = width;
          }
        }
        // 行高 + 单元格
        for (const box of layout.cells) {
          const row = sheet.getRow(cursorRow + box.ri);
          const rowHpt = limitRowHeight((layout.rows[box.ri]?.size ?? 5) * MM_TO_PT);
          if (row.height == null || row.height < rowHpt) row.height = rowHpt;
          const cell = row.getCell(box.ci + 1);
          setCellValue(cell, box.cell, valueMode, warnings);
          if (box.cell.children?.length) {
            warnings.push(`page ${pageIndex + 1} ${comp.nid ?? comp.kind} cell ${box.ri + 1}:${box.ci + 1}: 嵌套组件内容暂不支持 xlsx 导出，已跳过`);
          }
          const style = { ...comp.style, ...box.cell.style };
          cell.alignment = {
            horizontal: style.align ?? "left",
            vertical: style.verticalAlign ?? "middle",
            wrapText: true
          };
          const bg = argbOf(style.backgroundColor);
          if (bg) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
          const borderColor = argbOf(style.borderColor ?? style.lineColor);
          const edge = { style: "thin" as const, ...(borderColor ? { color: { argb: borderColor } } : {}) };
          cell.border = {
            ...(style.borderTop !== false ? { top: edge } : {}),
            ...(style.borderLeft !== false ? { left: edge } : {}),
            ...(style.borderBottom !== false ? { bottom: edge } : {}),
            ...(style.borderRight !== false ? { right: edge } : {})
          };
          cellFont(cell, style);
          // 与统一几何一致，越界跨度收敛到当前网格内，避免占用后续组件行。
          const colSpan = Math.max(1, Math.min(box.cell.colSpan ?? 1, layout.columns.length - box.ci));
          const rowSpan = Math.max(1, Math.min(box.cell.rowSpan ?? 1, layout.rows.length - box.ri));
          if (colSpan > 1 || rowSpan > 1) {
            sheet.mergeCells(
              cursorRow + box.ri,
              box.ci + 1,
              cursorRow + box.ri + rowSpan - 1,
              box.ci + colSpan
            );
          }
        }
        cursorRow += layout.rows.length;
        continue;
      }
      switch (comp.kind) {
        case "text": {
          const text = Array.isArray(comp.lines) && comp.lines.length > 0
            ? comp.lines.join("\n")
            : (comp.text ?? "");
          if (comp.richParagraphs?.length && text.length === 0) {
            warnings.push(`page ${pageIndex + 1} ${comp.nid ?? comp.kind}: 富文本内容暂不支持 xlsx 导出，已跳过`);
          }
          const row = sheet.getRow(cursorRow);
          const cell = row.getCell(1);
          validateCellText(text, cell.address);
          cell.value = text;
          cell.alignment = { horizontal: comp.style?.align === "center" ? "center" : comp.style?.align === "right" ? "right" : "left", vertical: "middle" };
          cellFont(cell, comp.style);
          if (sheetColumnCount > 1) sheet.mergeCells(cursorRow, 1, cursorRow, sheetColumnCount);
          row.height = limitRowHeight(comp.heightMm * MM_TO_PT);
          cursorRow += 1;
          break;
        }
        default:
          warnings.push(`page ${pageIndex + 1} ${comp.nid ?? comp.kind}: 组件类型 ${comp.kind} 暂不支持 xlsx 导出，已跳过`);
          break;
      }
    }
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return { workbook, buffer, warnings };
}
