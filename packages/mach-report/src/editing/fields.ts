import type { ReportCellContext, ReportCellValue } from "./context";
import { parseReportCellInput, ReportCellEditError } from "./value";

interface ReportCellFieldBase {
  /** Presentation only; it never grants write permission. */
  label?: string;
  hint?: string;
  unit?: string;
  required?: boolean;
}
export interface ReportCellChoice { value: Exclude<ReportCellValue, null>; label?: string }
export type ReportCellFieldOptions = ReportCellFieldBase & (
  | { type: "text"; maxLength?: number }
  | { type: "number"; min?: number; max?: number; precision?: number }
  | { type: "boolean"; trueLabel?: string; falseLabel?: string }
  | { type: "enum"; options: readonly ReportCellChoice[] }
  | { type: "date"; min?: string; max?: string }
);
export type ReportCellFieldErrorCode = "definition" | "type" | "required" | "min" | "max" | "precision" | "length" | "choice" | "date";

/** Shared structured validation for browser editors, pasted values and backend adapters. */
export class ReportCellFieldError extends Error {
  constructor(public readonly code: ReportCellFieldErrorCode, public readonly field: ReportCellFieldOptions, public readonly expected?: string | number) {
    const name = typeof field.label === "string" ? field.label : "单元格";
    const messages: Record<ReportCellFieldErrorCode, string> = {
      definition: `${name}的编辑器配置无效`, type: `${name}的编辑器与数据类型不一致`, required: `${name}不能为空`,
      min: `${name}不能小于 ${expected}`, max: `${name}不能大于 ${expected}`, precision: `${name}最多保留 ${expected} 位小数`,
      length: `${name}最多允许 ${expected} 个字符`, choice: `${name}请选择有效选项`, date: `${name}请输入有效日期（YYYY-MM-DD）`
    };
    super(messages[code]); this.name = "ReportCellFieldError";
  }
}

function fail(field: ReportCellFieldOptions, code: ReportCellFieldErrorCode, expected?: string | number): never {
  throw new ReportCellFieldError(code, field, expected);
}
function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function decimalPlaces(value: number): number {
  const [base = "", exponent = "0"] = String(value).toLowerCase().split("e");
  return Math.max(0, (base.split(".")[1]?.length ?? 0) - Number(exponent));
}
function validateRange(field: ReportCellFieldOptions & { type: "number" }, value: number): void {
  if (field.min !== undefined && value < field.min) fail(field, "min", field.min);
  if (field.max !== undefined && value > field.max) fail(field, "max", field.max);
  if (field.precision !== undefined && decimalPlaces(value) > field.precision) fail(field, "precision", field.precision);
}
function validateDate(field: ReportCellFieldOptions & { type: "date" }, value: ReportCellValue): void {
  if (!validDate(value)) fail(field, "date");
  if (field.min !== undefined && value < field.min) fail(field, "min", field.min);
  if (field.max !== undefined && value > field.max) fail(field, "max", field.max);
}
function validateNumberDefinition(field: ReportCellFieldOptions & { type: "number" }): void {
  if ([field.min, field.max].some((value) => value !== undefined && !Number.isFinite(value))) fail(field, "definition");
  if (field.min !== undefined && field.max !== undefined && field.min > field.max) fail(field, "definition");
  if (field.precision !== undefined && (!Number.isInteger(field.precision) || field.precision < 0 || field.precision > 15)) fail(field, "definition");
}
function validateDateDefinition(field: ReportCellFieldOptions & { type: "date" }): void {
  if ([field.min, field.max].some((value) => value !== undefined && !validDate(value))) fail(field, "definition");
  if (field.min !== undefined && field.max !== undefined && field.min > field.max) fail(field, "definition");
}
function validateEnumDefinition(context: ReportCellContext, field: ReportCellFieldOptions & { type: "enum" }): void {
  if (!Array.isArray(field.options) || !field.options.length) fail(field, "definition");
  const type = context.valueType === "text" ? "string" : context.valueType;
  const seen = new Set<ReportCellValue>();
  for (const option of field.options) {
    if (!option || typeof option.value !== type || typeof option.value === "number" && !Number.isFinite(option.value)) fail(field, "definition");
    if (option.label !== undefined && typeof option.label !== "string") fail(field, "definition");
    if (seen.has(option.value)) fail(field, "definition");
    seen.add(option.value);
  }
}
function validateFieldBase(field: ReportCellFieldOptions): void {
  if (field.required !== undefined && typeof field.required !== "boolean") fail(field, "definition");
  if ([field.label, field.hint, field.unit].some((value) => value !== undefined && typeof value !== "string")) fail(field, "definition");
  if (field.type === "boolean" && [field.trueLabel, field.falseLabel].some((value) => value !== undefined && typeof value !== "string")) fail(field, "definition");
}

/** Check configuration before opening an input, including JSON/JavaScript callers. */
export function validateReportCellFieldDefinition(context: ReportCellContext, field: ReportCellFieldOptions): void {
  if (!field || typeof field !== "object" || Array.isArray(field) || !["text", "number", "boolean", "enum", "date"].includes(field.type)) fail(field ?? { type: "text" }, "definition");
  validateFieldBase(field);
  if ((field.type === "number" || field.type === "boolean") && context.valueType !== field.type) fail(field, "type");
  if ((field.type === "text" || field.type === "date") && context.valueType !== "text") fail(field, "type");
  if (field.type === "number") validateNumberDefinition(field);
  if (field.type === "text" && field.maxLength !== undefined && (!Number.isInteger(field.maxLength) || field.maxLength < 0)) fail(field, "definition");
  if (field.type === "date") validateDateDefinition(field);
  if (field.type === "enum") validateEnumDefinition(context, field);
}

/** Core type parsing is authoritative; field controls add restrictions, never coerce IDs or bypass readonly. */
export function parseReportCellFieldInput(context: ReportCellContext, input: ReportCellValue, field?: ReportCellFieldOptions): ReportCellValue {
  if (!context.editable) throw new ReportCellEditError("readonly");
  if (field) validateReportCellFieldDefinition(context, field);
  const value = parseReportCellInput(context, input);
  if (!field) return value;
  if (field.required && typeof value === "string" && !value.trim()) fail(field, "required");
  if (value === null || value === "") {
    if (field.required) fail(field, "required");
    return value;
  }
  if (field.type === "number") validateRange(field, value as number);
  if (field.type === "date") validateDate(field, value);
  if (field.type === "text" && field.maxLength !== undefined && [...String(value)].length > field.maxLength) fail(field, "length", field.maxLength);
  if (field.type === "enum" && !field.options.some((option) => Object.is(option.value, value))) fail(field, "choice");
  return value;
}
