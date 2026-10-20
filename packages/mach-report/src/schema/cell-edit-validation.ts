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
  if (cell.indentMm !== undefined && (typeof cell.indentMm !== "number" || !Number.isFinite(cell.indentMm) || cell.indentMm < 0)) errors.push({ path: `${path}.indentMm`, message: "单元格缩进应为有限非负数" });
  if (cell.derived !== undefined && typeof cell.derived !== "boolean") errors.push({ path: `${path}.derived`, message: "派生结果标记应为布尔值" });
  validateBusinessSource(cell.source, `${path}.source`, errors, true);
  if (cell.formula !== undefined && typeof cell.formula !== "string") {
    errors.push({ path: `${path}.formula`, message: "单元格公式应为字符串" });
  }
}

/** 校验序列化业务定位元数据；这不是服务端授权或数据库版本校验。 */
export function validateBusinessSource(value: unknown, path: string, errors: ValidationError[], cell = false): void {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push({ path, message: "业务来源应为对象" });
    return;
  }
  const source = value as Record<string, unknown>;
  for (const key of ["datasetId", ...(cell ? ["field"] : [])]) {
    if (typeof source[key] !== "string" || !(source[key] as string).trim()) errors.push({ path: `${path}.${key}`, message: "业务标识应为非空字符串" });
  }
  for (const key of ["rowKey", "revision"]) {
    const item = source[key];
    if (item === undefined && !(cell && key === "rowKey")) continue;
    if (typeof item !== "string" && !(typeof item === "number" && Number.isFinite(item))) errors.push({ path: `${path}.${key}`, message: "业务键及修订号应为字符串或有限数字" });
  }
  if (source.sourceToken !== undefined && typeof source.sourceToken !== "string") errors.push({ path: `${path}.sourceToken`, message: "来源令牌应为字符串" });
}
