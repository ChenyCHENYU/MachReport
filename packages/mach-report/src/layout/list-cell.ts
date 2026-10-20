import type { ComponentStyle, GridCell } from "../schema/render-plan";
import type { ListColumn, ListComponent } from "./list-model";
import { DEFAULT_FONT_PT } from "../defaults";
import { evalStyleRule, formatValue, toExcelNumberFormat, type ColumnFormat } from "../format";
import { mergeComponentStyles } from "../render/style";
/** Shared semantic alignment for the paginator and bounded designer samples. */
export function resolveListAutoAlignment(value: unknown, format?: ColumnFormat, role?: ListColumn["semanticRole"]): "left" | "center" | "right" {
  if (role === "identifier" || role === "dimension" || role === "date") return "center";
  if (role === "measure") return "right";
  if (role === "text") return "left";
  if (format?.kind === "number" || format?.kind === "percent") return "right";
  if (format?.kind === "date" || value instanceof Date || typeof value === "boolean") return "center";
  return typeof value === "number" && Number.isFinite(value) ? "right" : "left";
}
export function listCellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "是" : "否";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  try { return JSON.stringify(value); } catch { return String(value); }
}
export function resolveListHeaderStyle(list: ListComponent, column: ListColumn): ComponentStyle {
  let style = mergeComponentStyles({ fontSize: list.fontSizePt ?? DEFAULT_FONT_PT, bold: list.headerBold ?? true, align: "center", verticalAlign: "middle", backgroundColor: list.headerBackgroundColor }, column.style);
  if (list.headerAlign !== undefined) style.align = list.headerAlign;
  style = mergeComponentStyles(style, list.headerStyle);
  if (column.headerAlign !== undefined) style.align = column.headerAlign;
  return mergeComponentStyles(style, column.headerStyle);
}
/** Resolves only one sample cell; it performs no grouping, pagination or full-dataset traversal. */
function sampleValueMetadata(cell: GridCell, column: ListColumn, value: unknown): void {
  if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) cell.value = value;
  const numeric = column.format?.kind === "number" || column.format?.kind === "percent";
  if (column.valueType !== undefined) cell.valueType = column.valueType;
  else if (numeric) cell.valueType = "number";
  if (column.editable !== undefined) cell.editable = column.editable;
  const numberFormat = toExcelNumberFormat(column.format);
  if ((typeof cell.value === "number" || cell.value == null) && numberFormat !== undefined) cell.numberFormat = numberFormat;
}
export function resolveListSampleCell(list: ListComponent, column: ListColumn, row: Record<string, unknown>): GridCell {
  const hidden = !!column.visibleWhen && !evalStyleRule(row, column.visibleWhen);
  const value = hidden ? null : row[column.field];
  const alignment = column.align ?? column.style?.align ?? list.align ?? "left";
  let style = mergeComponentStyles({ fontSize: list.fontSizePt ?? DEFAULT_FONT_PT, verticalAlign: "middle" }, column.style);
  style.align = alignment === "auto" ? resolveListAutoAlignment(value, column.format, column.semanticRole) : alignment;
  const rule = column.rules?.find((item) => evalStyleRule(row, item.when));
  if (rule) style = mergeComponentStyles(style, rule.style);
  const cell: GridCell = { text: column.format ? formatValue(value, column.format) : listCellText(value), style };
  sampleValueMetadata(cell, column, value);
  if (list.computed?.some((item) => item.field === column.field)) { cell.derived = true; cell.editable = false; }
  if (hidden) cell.editable = false;
  return cell;
}
