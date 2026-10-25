import { compileReportPredicate, type ReportPredicate } from "../processing/predicate";
import {
  validateMatrixOptions,
  type MatrixTableOptions,
} from "../processing/matrix";
import {
  validateComputedFields,
  type ComputedField,
} from "../processing/computed";
import { createAggregateAccumulator } from "../processing/aggregate";
import type { ValidationError } from "../schema/validate";
type ObjectValue = Record<string, unknown>;
function object(value: unknown): value is ObjectValue {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function validateRowCondition(
  value: unknown,
  path: string,
  errors: ValidationError[],
): void {
  if (value === undefined) return;
  try { compileReportPredicate(value as ReportPredicate); }
  catch (cause) { errors.push({ path, message: cause instanceof Error ? cause.message : String(cause) }); }

}
export function validateAggregates(
  value: unknown,
  path: string,
  errors: ValidationError[],
): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > 2048) {
    errors.push({ path, message: "聚合应为数组且最多 2048 项" });
    return;
  }
  const names = new Set<string>();
  value.forEach((definition, index) => {
    const here = `${path}.${index}`;
    if (!object(definition)) {
      errors.push({ path: here, message: "聚合应为对象" });
      return;
    }
    const field = definition.field;
    if (typeof field !== "string" || !field.trim() || names.has(field))
      errors.push({
        path: `${here}.field`,
        message: "聚合输出字段应非空且唯一",
      });
    else names.add(field);
    if (
      definition.numeric !== undefined &&
      definition.numeric !== "number" &&
      definition.numeric !== "decimal"
    )
      errors.push({
        path: `${here}.numeric`,
        message: "数值模式应为 number 或 decimal",
      });
    if (
      definition.digits !== undefined &&
      (!Number.isInteger(definition.digits) ||
        Number(definition.digits) < 0 ||
        Number(definition.digits) > 100)
    )
      errors.push({
        path: `${here}.digits`,
        message: "小数位应为 0–100 的整数",
      });
    try {
      createAggregateAccumulator({
        ...definition,
        field: definition.valueField ?? field,
      } as Parameters<typeof createAggregateAccumulator>[0]);
    } catch (cause) {
      errors.push({
        path: here,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  });
}
export function validateComputed(
  value: unknown,
  path: string,
  errors: ValidationError[],
): void {
  if (value === undefined) return;
  const result = validateComputedFields(value as ComputedField[]);
  for (const message of result.errors) errors.push({ path, message });
}

export function validateMatrix(
  value: unknown,
  path: string,
  errors: ValidationError[],
): void {
  if (value === undefined) return;
  try {
    validateMatrixOptions(value as MatrixTableOptions);
  } catch (cause) {
    errors.push({
      path,
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
}
