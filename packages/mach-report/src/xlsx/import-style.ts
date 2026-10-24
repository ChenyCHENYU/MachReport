import type * as ExcelJS from "exceljs";
import type { ComponentStyle, RichSegment } from "../schema/render-plan";
import { ImportWarnings } from "./import-types";

const OFFICE_THEME = ["FFFFFF", "000000", "E7E6E6", "44546A", "4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47", "0563C1", "954F72"];
const INDEXED = [
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080",
  "9999FF", "993366", "FFFFCC", "CCFFFF", "660066", "FF8080", "0066CC", "CCCCFF",
  "000080", "FF00FF", "FFFF00", "00FFFF", "800080", "800000", "008080", "0000FF",
  "00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF", "FF99CC", "CC99FF", "FFCC99",
  "3366FF", "33CCCC", "99CC00", "FFCC00", "FF9900", "FF6600", "666699", "969696",
  "003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333"
];
const BORDER_WIDTH: Record<string, number> = { hair: 0.25, dotted: 0.5, dashed: 0.5, thin: 0.5, medium: 1, thick: 1.5, double: 1 };

/** OOXML theme colours are data; no XML entities, links or scripts are executed. */
export function importTheme(workbook: ExcelJS.Workbook): string[] {
  const model = workbook.model as unknown as { themes?: { theme1?: string } };
  const scheme = /<(?:\w+:)?clrScheme\b[^>]*>([\s\S]*?)<\/(?:\w+:)?clrScheme>/.exec(model.themes?.theme1 ?? "");
  if (!scheme) return OFFICE_THEME;
  const colours = [...scheme[1]!.matchAll(/<(?:\w+:)?(?:srgbClr|sysClr)\b[^>]*(?:val|lastClr)="([A-Fa-f0-9]{6})"[^>]*\/?\s*>/g)].map((match) => match[1]!.toUpperCase());
  // clrScheme document order is dk1, lt1, dk2, lt2; theme indices use lt1, dk1, lt2, dk2.
  if (colours.length < 12) return OFFICE_THEME;
  return [colours[1]!, colours[0]!, colours[3]!, colours[2]!, ...colours.slice(4, 12)];
}

function tintColour(hex: string, tint = 0): string {
  return `#${[0, 2, 4].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16);
    const adjusted = tint < 0 ? channel * (1 + tint) : channel * (1 - tint) + 255 * tint;
    return Math.max(0, Math.min(255, Math.round(adjusted))).toString(16).padStart(2, "0");
  }).join("").toUpperCase()}`;
}

interface WorkbookColour extends Partial<ExcelJS.Color> { tint?: number; indexed?: number }

function colour(value: WorkbookColour | undefined, theme: string[], warn: () => void = () => {}): string | undefined {
  if (!value) return undefined;
  const argb = value.argb;
  if (argb && /^[A-Fa-f\d]{6,8}$/.test(argb)) return tintColour(argb.slice(-6), value.tint);
  if (value.theme !== undefined && theme[value.theme]) return tintColour(theme[value.theme]!, value.tint);
  if (value.indexed !== undefined && INDEXED[value.indexed]) return tintColour(INDEXED[value.indexed]!, value.tint);
  if (value.indexed === 64 || value.indexed === 65) { warn(); return value.indexed === 64 ? "#000000" : "#FFFFFF"; }
  if (value.argb !== undefined || value.theme !== undefined || value.indexed !== undefined) warn();
  return undefined;
}

function applyBorders(style: ComponentStyle, border: Partial<ExcelJS.Borders>, theme: string[], warn: () => void): void {
  const edges = [border.top, border.right, border.bottom, border.left];
  const enabled = edges.map((edge) => !!edge?.style);
  [style.borderTop, style.borderRight, style.borderBottom, style.borderLeft] = enabled;
  const present = edges.filter((edge) => edge?.style);
  if (!present.length) return;
  style.borderColor = colour(present[0]?.color, theme, warn) ?? "#000000";
  style.lineWidthPt = BORDER_WIDTH[present[0]!.style!] ?? 0.5;
  if (present.some((edge) => edge!.style !== "thin" && edge!.style !== "medium" && edge!.style !== "thick")) warn();
  if (present.some((edge) => colour(edge!.color, theme) !== colour(present[0]!.color, theme) || edge!.style !== present[0]!.style)) warn();
  if (border.diagonal?.style) warn();
}

function applyAlignment(style: ComponentStyle, alignment: Partial<ExcelJS.Alignment>, warn: () => void): void {
  const horizontal = alignment.horizontal;
  if (horizontal && ["left", "center", "right", "justify"].includes(horizontal)) style.align = horizontal as ComponentStyle["align"];
  else if (horizontal) warn();
  if (alignment.vertical) style.verticalAlign = alignment.vertical === "distributed" || alignment.vertical === "justify" ? "middle" : alignment.vertical;
  if (alignment.textRotation || alignment.shrinkToFit || alignment.indent || alignment.readingOrder) warn();
}

function createCellStyle(cell: ExcelJS.Cell, theme: string[], sheet: string, warnings: ImportWarnings): ComponentStyle {
  const source = cell.style;
  const font = source.font ?? {};
  const style: ComponentStyle = { align: "left", verticalAlign: "bottom", fontFamily: font.name || "Calibri", fontSize: font.size || 11 };
  if (font.bold !== undefined) style.bold = font.bold;
  if (font.italic !== undefined) style.italic = font.italic;
  if (font.underline !== undefined) style.underline = !!font.underline;
  const warnColour = () => warnings.add(`${sheet}!${cell.address}: 系统色按黑/白还原，未知颜色使用默认样式；请在 Excel 中指定明确 RGB 颜色`);
  const fontColour = colour(font.color, theme, warnColour);
  if (fontColour) style.color = fontColour;
  const fill = source.fill;
  if (fill?.type === "pattern" && fill.pattern === "solid") {
    const background = colour(fill.fgColor, theme, warnColour);
    if (background) style.backgroundColor = background;
  } else if (fill && !(fill.type === "pattern" && fill.pattern === "none")) warnings.add(`${sheet}: 渐变或图案填充暂不支持，保留单元格内容`);
  // 报表网格默认绘制边框；Excel 无边框必须显式关闭，不能凭空增加源模板中不存在的黑框。
  applyBorders(style, source.border ?? {}, theme, () => warnings.add(`${sheet}: 多种边线颜色、虚线、双线或对角线按单元格统一实线近似呈现`));
  if (source.alignment) applyAlignment(style, source.alignment, () => warnings.add(`${sheet}: 部分旋转、缩进、收缩或分散对齐样式暂不支持`));
  if (font.strike || font.vertAlign) warnings.add(`${sheet}: 删除线、上标或下标暂不支持`);
  return style;
}

/** ExcelJS interns workbook styles; reuse the mapped object for large repeated grids. */
export function styleImporter(theme: string[], sheet: string, warnings: ImportWarnings, scale = 1): (cell: ExcelJS.Cell) => ComponentStyle {
  const cache = new WeakMap<object, { left: ComponentStyle; center: ComponentStyle; right: ComponentStyle }>();
  return (cell) => {
    let variants = cache.get(cell.style);
    if (!variants) {
      const base = createCellStyle(cell, theme, sheet, warnings);
      base.fontSize = (base.fontSize ?? 11) * scale;
      variants = cell.alignment?.horizontal ? { left: base, center: base, right: base } : {
        left: base, center: { ...base, align: "center" }, right: { ...base, align: "right" }
      };
      cache.set(cell.style, variants);
    }
    const raw = cell.value;
    const value = raw && typeof raw === "object" && ("formula" in raw || "sharedFormula" in raw) ? cell.result : raw;
    const numericBlank = value == null && /[0#?]/.test((cell.numFmt ?? "").replace(/"[^"]*"|\\.|\[[^\]]*\]/g, ""));
    return typeof value === "boolean" ? variants.center : typeof value === "number" || value instanceof Date || numericBlank ? variants.right : variants.left;
  };
}

/** Reuse workbook theme/indexed colour mapping for each native rich text run. */
export function importRichSegments(runs: ExcelJS.RichText[], theme: string[], warnings: ImportWarnings, location: string, scale: number): RichSegment[] {
  return runs.map(run => {
    const font = run.font ?? {}, style: ComponentStyle = {};
    if (font.name) style.fontFamily = font.name;
    if (font.size) style.fontSize = font.size * scale;
    for (const key of ["bold", "italic"] as const) if (font[key] !== undefined) style[key] = font[key];
    if (font.underline !== undefined) style.underline = !!font.underline;
    const color = colour(font.color, theme, () => warnings.add(`${location}: 富文本系统色/未知色按默认颜色还原`));
    if (color) style.color = color;
    if (font.strike || font.vertAlign || typeof font.underline === "string" && font.underline !== "single") warnings.add(`${location}: 富文本删除线、上下标或特殊下划线暂不支持`);
    return { text: run.text, style };
  });
}
