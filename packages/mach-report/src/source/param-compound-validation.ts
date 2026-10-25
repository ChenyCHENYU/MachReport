import type { ReportParamDef } from "../layout/paginate";
import type { ReportParamIssueCode } from "./param-validation";
import { compoundParamValue, validCascaderPath, snapshotReportParamOptions, PARAM_SELECTION_LIMIT, PARAM_WIRE_MAX_CODE_UNITS } from "./param-compound";
type Issue = [ReportParamIssueCode, string];
export function compoundValueIssues(def: ReportParamDef, raw: string): Issue[] {
  const value = compoundParamValue(def, raw);
  if (!value) return [["type", def.type === "numberRange" ? "请填写完整数字范围，最小值不能大于最大值" : def.type === "cascader" ? "请选择完整的末级路径" : "请选择有效选项，不能重复或超出数量限制"]];
  if (def.type === "numberRange") return numberBounds(def, value as readonly number[]);
  const selection = value as string[], issues: Issue[] = [];
  if (def.type === "cascader" && def.options && !validCascaderPath(def.options, selection)) issues.push(["option", "应为允许选项中的完整叶节点路径"]);
  if (def.type === "multiSelect") {
    if (def.options && selection.some(item => !def.options!.some(option => option.value === item))) issues.push(["option", "不在允许的选项中"]);
    if (def.minItems !== undefined && selection.length < def.minItems) issues.push(["minItems", `至少选择 ${def.minItems} 项`]);
    if (def.maxItems !== undefined && selection.length > def.maxItems) issues.push(["maxItems", `最多选择 ${def.maxItems} 项`]);
  }
  return issues;
}
function numberBounds(def: ReportParamDef, value: readonly number[]): Issue[] {
  const issues: Issue[] = [];
  if (typeof def.min === "number" && value[0]! < def.min) issues.push(["minimum", `不能小于 ${def.min}`]);
  if (typeof def.max === "number" && value[1]! > def.max) issues.push(["maximum", `不能大于 ${def.max}`]);
  return issues;
}
export function compoundDefinitionIssues(def: ReportParamDef): string[] {
  const issues: string[] = [];
  for (const key of ["minItems", "maxItems"] as const) if (def[key] !== undefined) {
    if (def.type !== "multiSelect" || !Number.isSafeInteger(def[key]) || def[key]! < 0 || def[key]! > PARAM_SELECTION_LIMIT) issues.push(`${key} 应为多选参数的 0–100 整数边界`);
  }
  if (def.minItems !== undefined && def.maxItems !== undefined && def.minItems > def.maxItems) issues.push("最少项目数不能大于最多项目数");
  return issues;
}
export function compoundParamSchema(def: ReportParamDef): Record<string, unknown> {
  if (def.type === "numberRange") {
    const item = { type: "number", ...(typeof def.min === "number" ? { minimum: def.min } : {}), ...(typeof def.max === "number" ? { maximum: def.max } : {}) };
    return { type: "array", minItems: 2, maxItems: 2, prefixItems: [item, { ...item }], items: false, "x-report-number-range": { ordered: true }, "x-report-wire-encoding": "json" };
  }
  const schema: Record<string, unknown> = { "x-report-wire-encoding": "json", "x-report-wire-max-code-units": PARAM_WIRE_MAX_CODE_UNITS, type: "array", minItems: Math.max(def.required ? 1 : 0, def.minItems ?? 0), maxItems: def.type === "cascader" ? 16 : def.maxItems ?? PARAM_SELECTION_LIMIT, items: { type: "string", minLength: 1, maxLength: 1024, pattern: "\\S", "x-report-max-code-units": 1024 } };
  if (def.type === "multiSelect") {
    schema.uniqueItems = true;
    if (def.options) schema.items = { ...schema.items as object, enum: def.options.map(option => option.value) };
  } else {
    schema["x-report-cascader"] = { leafOnly: true, ...(def.options ? { options: snapshotReportParamOptions(def.options) } : {}) };
  }
  return schema;
}
