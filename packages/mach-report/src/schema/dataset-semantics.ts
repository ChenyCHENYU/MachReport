import type { ColumnFormat } from "../format";
import type { ReportFieldContract } from "./dataset";

export type ReportFieldAggregation = "sum" | "avg" | "min" | "max" | "count" | "none";
export interface ReportFieldCalculation {
  /** Business-owned explanation, never executable JavaScript or an inferred business formula. */
  description: string;
  dependsOn: readonly string[];
}
export interface ReportFieldSemantics {
  description?: string;
  /** Explicit meaning of null/missing; does not convert blanks into zero. */
  missingMeaning?: string;
  /** Recommended aggregation; none marks non-additive measures such as ratios. No aggregation runs implicitly. */
  aggregation?: ReportFieldAggregation;
  /** Shared presentation only; raw values and calculation precision remain unchanged. */
  format?: ColumnFormat;
  calculation?: ReportFieldCalculation;
}
function fail(message: string): never { throw new Error(`数据契约无效：${message}`); }
function text(value: unknown): boolean { return typeof value === "string" && value.trim().length > 0 && value.length <= 4096; }
export function validateFieldSemantics(field: ReportFieldContract): void {
  for (const key of ["description", "missingMeaning"] as const) if (field[key] !== undefined && !text(field[key])) fail(`${key} 应为 1–4096 位非空字符串`);
  if (field.aggregation !== undefined && !["sum", "avg", "min", "max", "count", "none"].includes(field.aggregation)) fail("未知字段聚合语义");
  if (field.aggregation && !["count", "none"].includes(field.aggregation) && !["number", "decimal"].includes(field.type)) fail("数值聚合仅适用于 number/decimal");
  if (field.format !== undefined) validateFormat(field);
  if (field.calculation !== undefined && (!field.calculation || !text(field.calculation.description) || !Array.isArray(field.calculation.dependsOn) || !field.calculation.dependsOn.length || field.calculation.dependsOn.length > 256 || field.calculation.dependsOn.some(value => typeof value !== "string" || !value.trim()) || new Set(field.calculation.dependsOn).size !== field.calculation.dependsOn.length)) fail("计算说明需包含说明及 1–256 个唯一依赖字段");
}
function validateFormat(field: ReportFieldContract): void {
  const format = field.format!;
  if (!format || !["number", "percent", "date"].includes(format.kind)) fail("未知字段显示格式");
  if (format.kind === "date") {
    if (field.type !== "date" || format.pattern !== undefined && (!text(format.pattern) || format.pattern.length > 128)) fail("日期格式仅适用于日期，pattern 最多 128 位");
    return;
  }
  if (!["number", "decimal"].includes(field.type)) fail("数值显示格式仅适用于 number/decimal");
  if (format.digits !== undefined && (!Number.isSafeInteger(format.digits) || format.digits < 0 || format.digits > 100)) fail("显示小数位应为 0–100 的整数");
  if (format.kind === "number" && format.thousands !== undefined && typeof format.thousands !== "boolean") fail("thousands 应为布尔值");
}
export function validateFieldDependencies(fields: readonly ReportFieldContract[]): void {
  const definitions = new Map(fields.map(field => [field.field, field]));
  const visited = new Set<string>();
  for (const field of fields) {
    const pending = [{ field: field.field, exit: false }], active = new Set<string>();
    while (pending.length) {
      const step = pending.pop()!;
      if (step.exit) { active.delete(step.field); visited.add(step.field); continue; }
      if (active.has(step.field)) fail("字段计算依赖存在循环");
      if (visited.has(step.field)) continue;
      const definition = definitions.get(step.field);
      if (!definition) fail(`计算依赖字段未声明：${step.field}`);
      active.add(step.field); pending.push({ field: step.field, exit: true });
      for (const dependency of definition.calculation?.dependsOn ?? []) pending.push({ field: dependency, exit: false });
    }
  }
}
