import type { ValidationError } from "./validate";

/** Shared by JSON templates and runtime plans so malformed edit controls cannot change semantics. */
export function validateEditableMetadata(value: Record<string, unknown>, path: string, errors: ValidationError[]): void {
  if (value.editable !== undefined && typeof value.editable !== "boolean") {
    errors.push({ path: `${path}.editable`, message: "编辑控制应为布尔值" });
  }
  if (value.valueType !== undefined && !["text", "number", "boolean"].includes(value.valueType as string)) {
    errors.push({ path: `${path}.valueType`, message: "编辑类型应为 text、number 或 boolean" });
  }
}

export function validateGridCellEditingMetadata(cell: Record<string, unknown>, path: string, errors: ValidationError[]): void {
  validateEditableMetadata(cell, path, errors);
  if (cell.formula !== undefined && typeof cell.formula !== "string") {
    errors.push({ path: `${path}.formula`, message: "单元格公式应为字符串" });
  }
}
