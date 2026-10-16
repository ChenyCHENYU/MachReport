import type { ReportParamDef } from "../layout/paginate";

export type ReportParamIssueCode = "definition" | "required" | "type" | "option" | "minimum" | "maximum" | "minLength" | "maxLength";
export interface ReportParamIssue { code: ReportParamIssueCode; path: string; field: string; message: string }
export interface ReportParamValidation {
  ok: boolean;
  /** 保留历史取数契约的字符串形式；未知参数保留，不能代替接口权限白名单。 */
  values: Record<string, string>;
  /** JSON Schema 对应的规范值：number 参数转换为有限数字。 */
  typedValues: Record<string, string | number>;
  issues: ReportParamIssue[];
}
export class ReportParamValidationError extends Error {
  readonly code = "params";
  constructor(readonly issues: readonly ReportParamIssue[]) {
    super(issues.map((issue) => `${issue.field}: ${issue.message}`).join("; "));
    this.name = "ReportParamValidationError";
  }
}

export function isReportDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validNumber(value: string): boolean {
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) && Number.isFinite(Number(value));
}

function valueIssues(def: ReportParamDef, value: string): Array<[ReportParamIssueCode, string]> {
  if (def.type === "number" && !validNumber(value)) return [["type", "应为有限数字"]];
  if (def.type === "date" && !isReportDate(value)) return [["type", "应为有效的 YYYY-MM-DD 日期"]];
  const issues: Array<[ReportParamIssueCode, string]> = [];
  if (def.type === "select" && def.options && !def.options.some((option) => option.value === value)) issues.push(["option", "不在允许的选项中"]);
  const length = Array.from(value).length;
  if (def.minLength !== undefined && length < def.minLength) issues.push(["minLength", `至少 ${def.minLength} 个字符`]);
  if (def.maxLength !== undefined && length > def.maxLength) issues.push(["maxLength", `最多 ${def.maxLength} 个字符`]);
  const comparable = def.type === "number" ? Number(value) : value;
  if (def.min !== undefined && comparable < def.min) issues.push(["minimum", `不能小于 ${def.min}`]);
  if (def.max !== undefined && comparable > def.max) issues.push(["maximum", `不能大于 ${def.max}`]);
  return issues;
}

function boundsIssues(def: ReportParamDef): string[] {
  const messages: string[] = [];
  for (const key of ["min", "max"] as const) {
    const bound = def[key];
    if (bound === undefined) continue;
    const valid = def.type === "date" ? typeof bound === "string" && isReportDate(bound) : def.type === "number" && typeof bound === "number" && Number.isFinite(bound);
    if (!valid) messages.push(`${key} 应为 number 的有限数字边界或 date 的有效日期边界`);
  }
  const reversedNumber = typeof def.min === "number" && typeof def.max === "number" && def.min > def.max;
  const reversedDate = typeof def.min === "string" && typeof def.max === "string" && def.min > def.max;
  if (reversedNumber || reversedDate) messages.push("最小边界不能大于最大边界");
  return [...messages, ...lengthIssues(def)];
}

function lengthIssues(def: ReportParamDef): string[] {
  const messages: string[] = [];
  if (def.type === "number" && (def.minLength !== undefined || def.maxLength !== undefined)) messages.push("number 参数使用 min/max 而不是文本长度约束");
  for (const key of ["minLength", "maxLength"] as const) {
    const bound = def[key];
    if (bound !== undefined && (!Number.isSafeInteger(bound) || bound < 0)) messages.push(`${key} 应为非负整数`);
  }
  if (typeof def.minLength === "number" && typeof def.maxLength === "number" && def.minLength > def.maxLength) messages.push("最小长度不能大于最大长度");
  return messages;
}

/** 模板参数配置错误也统一返回结构化问题，不让无效默认值或边界静默进入后端。 */
export function validateReportParamDefinitions(defs: readonly ReportParamDef[]): ReportParamIssue[] {
  if (!Array.isArray(defs)) return [{ code: "definition", field: "", path: "$.paramDefs", message: "参数定义应为数组" }];
  const fields = new Set<string>();
  return defs.flatMap((def, index) => {
    const field = def && typeof def.field === "string" ? def.field : "";
    const messages = definitionIssues(def, fields);
    return messages.map((message): ReportParamIssue => ({ code: "definition", field, path: `$.paramDefs.${index}`, message }));
  });
}

function validOptions(options: unknown): options is NonNullable<ReportParamDef["options"]> {
  return Array.isArray(options) && options.every((option: unknown) => !!option && typeof option === "object"
    && typeof (option as { value?: unknown }).value === "string" && typeof (option as { label?: unknown }).label === "string");
}

function metadataIssues(def: ReportParamDef): string[] {
  const issues: string[] = [];
  if (def.type !== undefined && !["text", "number", "date", "select"].includes(def.type)) issues.push("未知参数类型");
  if (def.label !== undefined && typeof def.label !== "string") issues.push("参数标签应为字符串");
  if (def.required !== undefined && typeof def.required !== "boolean") issues.push("required 应为布尔值");
  if (def.defaultValue !== undefined && typeof def.defaultValue !== "string") issues.push("默认值应为字符串");
  if (def.options !== undefined && !validOptions(def.options)) issues.push("选项应为包含字符串 label/value 的数组");
  return issues;
}

function definitionIssues(def: ReportParamDef, fields: Set<string>): string[] {
  if (!def || typeof def !== "object" || Array.isArray(def)) return ["参数定义项应为对象"];
  const messages = metadataIssues(def);
  if (typeof def.field !== "string" || !def.field.trim() || fields.has(def.field)) messages.push("参数名应为非空且不重复的字符串");
  else fields.add(def.field);
  // 元数据形状无效时不再执行依赖 trim/map 的值约束，保证 JSON/JS 调用也返回契约问题。
  if (messages.length) return messages;
  messages.push(...boundsIssues(def));
  if (messages.length) return messages;
  if (def.options && new Set(def.options.map((option) => option.value)).size !== def.options.length) messages.push("选项值不能重复");
  if (def.defaultValue !== undefined) {
    if (def.required && !def.defaultValue.trim()) messages.push("必填参数的默认值不能为空");
    else if (def.defaultValue.trim()) messages.push(...valueIssues(def, def.defaultValue).map(([, message]) => `默认值${message}`));
  }
  return messages;
}

function copyInputValues(input: Record<string, unknown>, values: ReportParamValidation["values"], typedValues: ReportParamValidation["typedValues"]): void {
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" || typeof value === "number" && Number.isFinite(value)) {
      Object.defineProperty(values, key, { value: String(value), writable: true, enumerable: true, configurable: true });
      Object.defineProperty(typedValues, key, { value, writable: true, enumerable: true, configurable: true });
    }
  }
}

function emptyValue(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string" && !value.trim();
}

/** 在浏览器或服务端执行相同默认值、必填、类型、枚举及范围规则。 */
export function validateReportParams(defs: readonly ReportParamDef[], input: Record<string, unknown> = {}): ReportParamValidation {
  const values: Record<string, string> = Object.create(null) as Record<string, string>;
  const typedValues: Record<string, string | number> = Object.create(null) as Record<string, string | number>;
  const issues = validateReportParamDefinitions(defs);
  if (!input || typeof input !== "object" || Array.isArray(input)) issues.push({ code: "type", field: "", path: "$.params", message: "参数应为对象" });
  if (issues.length) return { ok: false, values, typedValues, issues };
  copyInputValues(input, values, typedValues);
  for (const def of defs) {
    const raw = Object.prototype.hasOwnProperty.call(input, def.field) && input[def.field] !== undefined ? input[def.field] : def.defaultValue;
    const add = (code: ReportParamIssueCode, message: string) => issues.push({ code, path: `$.params.${def.field}`, field: def.field, message });
    if (emptyValue(raw)) {
      if (def.required) add("required", "此参数为必填项");
      if (typeof raw === "string") values[def.field] = raw;
      delete typedValues[def.field];
      continue;
    }
    if (typeof raw !== "string" && !(typeof raw === "number" && Number.isFinite(raw))) { add("type", "参数应为字符串或有限数字"); continue; }
    const value = String(raw);
    values[def.field] = value;
    const problems = valueIssues(def, value);
    problems.forEach(([code, message]) => add(code, message));
    typedValues[def.field] = def.type === "number" && validNumber(value) ? Number(value) : value;
  }
  return { ok: issues.length === 0, values, typedValues, issues };
}

export function assertReportParams(defs: readonly ReportParamDef[], input: Record<string, unknown> = {}): Record<string, string> {
  const result = validateReportParams(defs, input);
  if (!result.ok) throw new ReportParamValidationError(result.issues);
  return result.values;
}

function paramSchema(def: ReportParamDef): Record<string, unknown> {
  const schema: Record<string, unknown> = { type: def.type === "number" ? "number" : "string", title: def.label ?? def.field };
  if (def.type === "date") schema.format = "date";
  if (def.required && def.type !== "number") schema.pattern = "\\S";
  if (def.type === "select" && def.options) schema.enum = def.options.map((option) => option.value);
  if (def.defaultValue !== undefined && (def.type !== "number" || def.defaultValue.trim())) schema.default = def.type === "number" ? Number(def.defaultValue) : def.defaultValue;
  if (def.minLength !== undefined) schema.minLength = def.minLength;
  if (def.maxLength !== undefined) schema.maxLength = def.maxLength;
  if (typeof def.min === "number") schema.minimum = def.min;
  if (typeof def.max === "number") schema.maximum = def.max;
  if (typeof def.min === "string") schema["x-report-minimum"] = def.min;
  if (typeof def.max === "string") schema["x-report-maximum"] = def.max;
  return schema;
}

/** 描述 typedValues 的 Draft 2020-12 Schema；日期区间额外保留 x-report-* 扩展。 */
export function reportParamsJsonSchema(defs: readonly ReportParamDef[]): Record<string, unknown> {
  const issues = validateReportParamDefinitions(defs);
  if (issues.length) throw new ReportParamValidationError(issues);
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema", type: "object",
    properties: Object.fromEntries(defs.map((def) => [def.field, paramSchema(def)])),
    required: defs.filter((def) => def.required).map((def) => def.field), additionalProperties: true
  };
}
