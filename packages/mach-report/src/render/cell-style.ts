import type { ComponentStyle, GridCell } from "../schema/render-plan";
import { mergeComponentStyles } from "./style";

/** Automatic data-cell alignment is shared by lists, imported workbooks and raw grids. */
export function automaticCellAlignment(value: unknown, declaredNumeric = false): "left" | "center" {
  return declaredNumeric || typeof value === "boolean" || value instanceof Date
    || typeof value === "number" && Number.isFinite(value) ? "center" : "left";
}

export function hasNumericCellFormat(format: string | undefined): boolean {
  return format !== undefined && /[0#?]/.test(format.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, ""));
}

/** Explicit cell and component styles remain authoritative across all renderers. */
export function gridCellAlignment(base: ComponentStyle | undefined, cell: GridCell): NonNullable<ComponentStyle["align"]> {
  return cell.style?.align ?? base?.align ?? automaticCellAlignment(cell.value,
    cell.valueType === "number" || cell.valueType === "boolean" || cell.value == null && hasNumericCellFormat(cell.numberFormat));
}

export function resolveGridCellStyle(base: ComponentStyle | undefined, cell: GridCell): ComponentStyle {
  const style = mergeComponentStyles(base, cell.style);
  style.align = gridCellAlignment(base, cell);
  return style;
}
