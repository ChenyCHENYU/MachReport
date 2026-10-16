export interface ReportFieldContract {
  field: string;
  label?: string;
  type: "text" | "number" | "boolean" | "date" | "decimal";
  required?: boolean;
  nullable?: boolean;
  enum?: readonly (string | number | boolean)[];
  min?: number; max?: number;
  minLength?: number; maxLength?: number;
  semanticRole?: "identifier" | "dimension" | "measure" | "date" | "text";
  unit?: string;
}
export interface DatasetContract { fields: readonly ReportFieldContract[]; rowKey?: string }
export interface DatasetIssue { code: "schema" | "budget" | "row" | "required" | "type" | "enum" | "range" | "row-key"; path: string; message: string; rowIndex?: number; field?: string }
export interface DatasetValidationOptions { path?: string; maxRows?: number; maxCells?: number; maxIssues?: number }
const TYPES = ["text", "number", "boolean", "date", "decimal"];
const UNSAFE = new Set(["__proto__", "prototype", "constructor"]);

function schemaError(message: string): never { throw new Error(`数据契约无效：${message}`); }
function checkContract(contract: DatasetContract): void {
  if (!contract || !Array.isArray(contract.fields) || !contract.fields.length || contract.fields.length > 2048) schemaError("fields 应包含 1–2048 个字段");
  const fields = new Set<string>();
  for (const field of contract.fields) {
    if (!field || typeof field.field !== "string" || !field.field.trim() || UNSAFE.has(field.field) || fields.has(field.field)) schemaError("字段名应安全、非空且唯一");
    fields.add(field.field);
    if (!TYPES.includes(field.type)) schemaError(`未知字段类型 ${field.type}`);
    checkBounds(field);
    checkMetadata(field);
    checkEnum(field);
  }
  checkRowKey(contract, fields);
}
function checkEnum(field: ReportFieldContract): void {
  if (field.enum !== undefined && (!Array.isArray(field.enum) || !field.enum.length || field.enum.some((value: unknown) => !matchesType(value, field.type)))) schemaError("enum 应为匹配字段类型的非空标量数组");
}
function checkRowKey(contract: DatasetContract, fields: Set<string>): void {
  if (contract.rowKey === undefined) return;
  if (typeof contract.rowKey !== "string" || !contract.rowKey.trim() || !fields.has(contract.rowKey)) schemaError("rowKey 应为引用已声明字段的非空字符串");
  if (contract.fields.find((field) => field.field === contract.rowKey)?.type === "boolean") schemaError("布尔字段不能作为业务主键");
}
function checkMetadata(field: ReportFieldContract): void {
  for (const key of ["label", "unit"] as const) if (field[key] !== undefined && typeof field[key] !== "string") schemaError(`${key} 应为字符串`);
  for (const key of ["required", "nullable"] as const) if (field[key] !== undefined && typeof field[key] !== "boolean") schemaError(`${key} 应为布尔值`);
  if (field.semanticRole !== undefined && !["identifier", "dimension", "measure", "date", "text"].includes(field.semanticRole)) schemaError("未知字段语义");
}
function checkBounds(field: ReportFieldContract): void {
  for (const key of ["min", "max", "minLength", "maxLength"] as const) {
    const value = field[key];
    if (value !== undefined && (!Number.isFinite(value) || (key.includes("Length") && (!Number.isInteger(value) || value < 0)))) schemaError(`${key} 无效`);
  }
  if (field.min !== undefined && field.max !== undefined && field.min > field.max) schemaError("min 不能超过 max");
  if (field.minLength !== undefined && field.maxLength !== undefined && field.minLength > field.maxLength) schemaError("minLength 不能超过 maxLength");
  if (field.type !== "number" && (field.min !== undefined || field.max !== undefined)) schemaError("min/max 仅适用于 number，精确小数文本需业务校验");
  if (["number", "boolean"].includes(field.type) && (field.minLength !== undefined || field.maxLength !== undefined)) schemaError("长度约束仅适用于文本类型");
}
function isoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
}
function matchesType(value: unknown, type: ReportFieldContract["type"]): boolean {
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "boolean") return typeof value === "boolean";
  if (typeof value !== "string") return false;
  if (type === "date") return isoDate(value);
  if (type === "decimal") return value.length <= 10_000 && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value);
  return true;
}
function fieldIssue(value: unknown, field: ReportFieldContract): Pick<DatasetIssue, "code" | "message"> | undefined {
  if (value === undefined || value === null) {
    if (field.required || (value === null && field.nullable === false)) return { code: "required", message: "缺少必需字段值" };
    return;
  }
  if (!matchesType(value, field.type)) return { code: "type", message: `值应为 ${field.type}，不会自动转换原始值` };
  if (field.enum && !field.enum.includes(value as string | number | boolean)) return { code: "enum", message: "值不在允许的枚举中" };
  if (typeof value === "number" && ((field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max))) return { code: "range", message: "数值超出范围" };
  if (typeof value === "string" && !validLength(value, field)) return { code: "range", message: "文本长度超出范围" };
}
function validLength(value: string, field: ReportFieldContract): boolean {
  if (field.minLength === undefined && field.maxLength === undefined) return true;
  let length = 0;
  for (const _character of value) length++;
  return (field.minLength === undefined || length >= field.minLength) && (field.maxLength === undefined || length <= field.maxLength);
}
function positive(value: number | undefined, fallback: number): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < 1) throw new Error("数据校验预算应为正整数");
  return result;
}
function rowKeyIssue(row: Record<string, unknown>, field: string, keys: Set<string>): string | undefined {
  const value = Object.prototype.hasOwnProperty.call(row, field) ? row[field] : undefined;
  if ((typeof value !== "string" || !value.trim()) && !(typeof value === "number" && Number.isFinite(value))) return "业务主键应为非空字符串或有限数字";
  const key = JSON.stringify([typeof value, value]);
  if (keys.has(key)) return "业务主键重复";
  keys.add(key);
}

/** 浏览器/Node共用的只读值校验；返回精确路径，不以0或空数组掩盖接口结构错误。 */
export function validateDatasetRows(input: unknown, contract: DatasetContract, options: DatasetValidationOptions = {}): { ok: boolean; issues: DatasetIssue[] } {
  checkContract(contract);
  const path = options.path ?? "$.rows", issues: DatasetIssue[] = [];
  const limit = positive(options.maxIssues, 100);
  if (!Array.isArray(input)) return { ok: false, issues: [{ code: "row", path, message: "数据集应为对象数组" }] };
  if (input.length > positive(options.maxRows, 100_000) || input.length * contract.fields.length > positive(options.maxCells, 2_000_000)) return { ok: false, issues: [{ code: "budget", path, message: "数据校验超出行数或单元格预算" }] };
  const keys = new Set<string>();
  for (let rowIndex = 0; rowIndex < input.length && issues.length < limit; rowIndex++) {
    const row = input[rowIndex];
    if (!row || typeof row !== "object" || Array.isArray(row)) { issues.push({ code: "row", path: `${path}[${rowIndex}]`, rowIndex, message: "行应为对象" }); continue; }
    validateRow(row, contract, rowIndex, path, keys, issues, limit);
  }
  return { ok: issues.length === 0, issues };
}
function validateRow(row: Record<string, unknown>, contract: DatasetContract, rowIndex: number, path: string, keys: Set<string>, issues: DatasetIssue[], limit: number): void {
  for (const field of contract.fields) {
    if (issues.length >= limit) return;
    const issue = fieldIssue(Object.prototype.hasOwnProperty.call(row, field.field) ? row[field.field] : undefined, field);
    if (issue) issues.push({ ...issue, rowIndex, field: field.field, path: `${path}[${rowIndex}].${field.field}` });
  }
  if (contract.rowKey && issues.length < limit) {
    const message = rowKeyIssue(row, contract.rowKey, keys);
    if (message) issues.push({ code: "row-key", path: `${path}[${rowIndex}].${contract.rowKey}`, message, rowIndex, field: contract.rowKey });
  }
}

/** 公开JSON Schema供Java DTO/表单/接口文档复用；decimal保持文本以免精度丢失。 */
export function datasetJsonSchema(contract: DatasetContract): Record<string, unknown> {
  checkContract(contract);
  const properties = Object.fromEntries(contract.fields.map((field) => [field.field, fieldSchema(field, field.field === contract.rowKey)]));
  return { $schema: "https://json-schema.org/draft/2020-12/schema", type: "array", items: { type: "object", properties, required: contract.fields.filter((field) => field.required || field.field === contract.rowKey).map((field) => field.field), additionalProperties: true }, ...(contract.rowKey ? { "x-report-rowKey": contract.rowKey } : {}) };
}
function fieldSchema(field: ReportFieldContract, rowKey: boolean): Record<string, unknown> {
  const nullable = !rowKey && field.nullable !== false && !field.required;
  return {
    type: nullable ? [jsonType(field.type), "null"] : jsonType(field.type),
    ...(field.label ? { title: field.label } : {}),
    ...(field.type === "date" ? { format: "date" } : {}),
    ...(field.type === "decimal" ? { pattern: "^-?(?:0|[1-9]\\d*)(?:\\.\\d+)?$" } : {}),
    ...(field.enum ? { enum: nullable ? [...field.enum, null] : [...field.enum] } : {}),
    ...(field.min === undefined ? {} : { minimum: field.min }), ...(field.max === undefined ? {} : { maximum: field.max }),
    ...lengthSchema(field, rowKey),
    ...(rowKey && field.type === "text" ? { pattern: "\\S" } : {}),
    ...(field.unit ? { "x-report-unit": field.unit } : {}), ...(field.semanticRole ? { "x-report-semanticRole": field.semanticRole } : {})
  };
}
function lengthSchema(field: ReportFieldContract, rowKey: boolean): Record<string, unknown> {
  const schema: Record<string, unknown> = {};
  if (field.minLength !== undefined || (rowKey && field.type !== "number")) schema.minLength = Math.max(field.minLength ?? 0, rowKey ? 1 : 0);
  if (field.type === "decimal") schema.maxLength = Math.min(field.maxLength ?? 10_000, 10_000);
  else if (field.maxLength !== undefined) schema.maxLength = field.maxLength;
  return schema;
}
function jsonType(type: ReportFieldContract["type"]): string { return type === "text" || type === "date" || type === "decimal" ? "string" : type; }
