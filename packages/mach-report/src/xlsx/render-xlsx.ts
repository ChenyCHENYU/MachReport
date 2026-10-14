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
  /** 工作表命名（默认 "Sheet1" 起序） */
  sheetName?: (pageIndex: number) => string;
  /** 默认 text 保留显示文本；raw 使用列表自动保留的原始数值、布尔、文本与空值。 */
  valueMode?: "text" | "raw";
  /** 默认 auto 按计划识别 A3/A4/A5；自定义尺寸回退 A4 并返回告警。 */
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
    cell.value = text;
    return;
  }
  const value = source.value;
  if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
    cell.value = value;
    if (typeof value === "number" && source.numberFormat) cell.numFmt = source.numberFormat;
    return;
  }
  cell.value = text;
  warnings.push(`原始单元格值无效，已保留显示文本：${cell.address}`);
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
  const workbook = new ExcelJSRuntime.Workbook();
  const warnings: string[] = [];

  plan.pages.forEach((page, pageIndex) => {
    const sheet = workbook.addWorksheet(
      options.sheetName?.(pageIndex) ?? `Sheet${pageIndex + 1}`,
      {
        pageSetup: {
          paperSize: paperSize(page, options.paperSize, pageIndex, warnings),
          orientation: page.pageWidthMm > page.pageHeightMm ? "landscape" : "portrait",
          fitToPage: true
        }
      }
    );

    // 标题沿用真实表格列数；Excel 列宽单位不能当作列数量。
    const gridLayouts = new Map<PlanComponent, GridLayout>();
    let sheetColumnCount = 1;
    let textWidthMm = 0;
    for (const comp of page.components) {
      if (comp.grid) {
        const layout = resolveGridLayout(comp.grid, comp.widthMm, comp.heightMm);
        gridLayouts.set(comp, layout);
        sheetColumnCount = Math.max(sheetColumnCount, layout.columns.length);
      } else if (comp.kind === "text") {
        textWidthMm = Math.max(textWidthMm, comp.widthMm);
      }
    }
    if (gridLayouts.size === 0 && textWidthMm > 0) {
      sheet.getColumn(1).width = textWidthMm * MM_TO_COL_WIDTH;
    }

    let cursorRow = 1;
    for (const comp of page.components) {
      if (comp.grid) {
        const layout = gridLayouts.get(comp)!;
        // 列宽：优先 colWidthsMm，否则按解析结果
        const colCount = Math.max(layout.columns.length, 1);
        const widths: number[] = [];
        for (let i = 0; i < colCount; i++) {
          widths.push(layout.columns[i]?.size ?? comp.widthMm / colCount);
        }
        for (let i = 0; i < colCount; i++) {
          const col = sheet.getColumn(i + 1);
          if (col.width == null || col.width < widths[i]! * MM_TO_COL_WIDTH) {
            col.width = widths[i]! * MM_TO_COL_WIDTH;
          }
        }
        // 行高 + 单元格
        for (const box of layout.cells) {
          const row = sheet.getRow(cursorRow + box.ri);
          const rowHpt = (layout.rows[box.ri]?.size ?? 5) * MM_TO_PT;
          if (row.height == null || row.height < rowHpt) row.height = rowHpt;
          const cell = row.getCell(box.ci + 1);
          setCellValue(cell, box.cell, options.valueMode, warnings);
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
          cell.value = text;
          cell.alignment = { horizontal: comp.style?.align === "center" ? "center" : comp.style?.align === "right" ? "right" : "left", vertical: "middle" };
          cellFont(cell, comp.style);
          if (sheetColumnCount > 1) sheet.mergeCells(cursorRow, 1, cursorRow, sheetColumnCount);
          row.height = comp.heightMm * MM_TO_PT;
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
