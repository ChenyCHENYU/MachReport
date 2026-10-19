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
  if (!object(value)) {
    errors.push({ path, message: "条件应为对象" });
    return;
  }
  if (typeof value.field !== "string" || !value.field.trim())
    errors.push({ path: `${path}.field`, message: "条件需要字段" });
  if (
    value.numeric !== undefined &&
    value.numeric !== "number" &&
    value.numeric !== "decimal"
  )
    errors.push({ path: `${path}.numeric`, message: "未知条件数值模式" });
  if (![">", ">=", "<", "<=", "==", "!="].includes(value.op as string))
    errors.push({ path: `${path}.op`, message: "未知条件运算符" });
  if (
    typeof value.value !== "string" &&
    !(typeof value.value === "number" && Number.isFinite(value.value))
  )
    errors.push({
      path: `${path}.value`,
      message: "条件值应为字符串或有限数字",
    });
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
