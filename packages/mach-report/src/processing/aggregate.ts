import {
  addDecimal,
  compareDecimal,
  divideDecimal,
  multiplyDecimal,
  parseDecimal,
  printDecimal,
  decimalDigits,
  type DecimalValue,
} from "./decimal";
export type AggregateOperation =
  | "sum"
  | "count"
  | "avg"
  | "min"
  | "max"
  | "weightedAvg";
export interface AggregateDefinition {
  /** Output column; valueField defaults to this field. */
  field: string;
  op: AggregateOperation;
  valueField?: string;
  weightField?: string;
  numeric?: "number" | "decimal";
  digits?: number;
}
export interface AggregateRequest {
  op: AggregateOperation;
  field?: string;
  weightField?: string;
  numeric?: "number" | "decimal";
  digits?: number;
}
export interface AggregateAccumulator {
  add(row: Readonly<Record<string, unknown>>): void;
  value(): number | string | null;
}
const OPERATIONS: readonly AggregateOperation[] = [
  "sum",
  "count",
  "avg",
  "min",
  "max",
  "weightedAvg",
];
function finite(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(
      "聚合度量必须是有限数字，不能隐式转换；小数文本请显式选择 decimal",
    );
  return value;
}
function own(row: Readonly<Record<string, unknown>>, field?: string): unknown {
  return field && Object.prototype.hasOwnProperty.call(row, field)
    ? row[field]
    : undefined;
}
function numericAccumulator(request: AggregateRequest): AggregateAccumulator {
  let count = 0,
    sum = 0,
    correction = 0,
    denominator = 0,
    min = Infinity,
    max = -Infinity;
  const sumValue = (value: number) => {
    const adjusted = value - correction,
      next = sum + adjusted;
    correction = next - sum - adjusted;
    sum = next;
  };
  return {
    add(row) {
      const raw = own(row, request.field);
      if (request.op === "count") {
        if (!request.field || raw != null) count++;
        return;
      }
      if (raw == null) return;
      const value = finite(raw),
        weight =
          request.op === "weightedAvg" ? own(row, request.weightField) : 1;
      if (weight == null) return;
      const factor = finite(weight);
      if (request.op === "weightedAvg" && factor < 0)
        throw new Error("加权平均的权重不能为负数");
      if (["sum", "avg", "weightedAvg"].includes(request.op))
        sumValue(value * factor);
      denominator += factor;
      min = Math.min(min, value);
      max = Math.max(max, value);
      count++;
    },
    value() {
      if (request.op === "count") return count;
      if (!count) return null;
      const result =
        request.op === "min"
          ? min
          : request.op === "max"
            ? max
            : request.op === "avg"
              ? sum / count
              : request.op === "weightedAvg"
                ? denominator === 0
                  ? null
                  : sum / denominator
                : sum;
      if (result !== null && !Number.isFinite(result))
        throw new Error("聚合计算溢出");
      return result;
    },
  };
}
function decimalAccumulator(request: AggregateRequest): AggregateAccumulator {
  let count = 0,
    sum = parseDecimal("0"),
    weightSum = parseDecimal("0"),
    min: DecimalValue | undefined,
    max: DecimalValue | undefined;
  return {
    add(row) {
      const raw = own(row, request.field);
      if (request.op === "count") {
        if (!request.field || raw != null) count++;
        return;
      }
      if (raw == null) return;
      const weight =
        request.op === "weightedAvg" ? own(row, request.weightField) : "1";
      if (weight == null) return;
      const value = parseDecimal(raw),
        factor = parseDecimal(weight);
      if (request.op === "weightedAvg" && factor.coefficient < 0n)
        throw new Error("加权平均的权重不能为负数");
      if (["sum", "avg", "weightedAvg"].includes(request.op))
        sum = addDecimal(sum, multiplyDecimal(value, factor));
      if (request.op === "weightedAvg")
        weightSum = addDecimal(weightSum, factor);
      if (!min || compareDecimal(value, min) < 0) min = value;
      if (!max || compareDecimal(value, max) > 0) max = value;
      count++;
    },
    value() {
      if (request.op === "count") return count;
      if (!count) return null;
      if (request.op === "weightedAvg" && weightSum.coefficient === 0n)
        return null;
      let result =
        request.op === "min" ? min! : request.op === "max" ? max! : sum;
      if (request.op === "avg")
        result = divideDecimal(sum, parseDecimal(count), request.digits);
      if (request.op === "weightedAvg")
        result = divideDecimal(sum, weightSum, request.digits);
      return printDecimal(result, request.digits);
    },
  };
}
/** Nulls are skipped; count with no field counts rows, all-null numeric aggregates stay null. */
export function createAggregateAccumulator(
  request: AggregateRequest,
): AggregateAccumulator {
  if (request.digits !== undefined) decimalDigits(request.digits);
  if (
    request.numeric !== undefined &&
    request.numeric !== "number" &&
    request.numeric !== "decimal"
  )
    throw new Error("未知聚合数值模式");
  if (!OPERATIONS.includes(request.op)) throw new Error("未知聚合操作");
  if (request.op !== "count" && !request.field)
    throw new Error("聚合需要度量字段");
  if (request.op === "weightedAvg" && !request.weightField)
    throw new Error("加权平均需要权重字段");
  return request.numeric === "decimal"
    ? decimalAccumulator(request)
    : numericAccumulator(request);
}
export function aggregateRows(
  rows: readonly Record<string, unknown>[],
  request: AggregateRequest,
): number | string | null {
  const accumulator = createAggregateAccumulator(request);
  for (const row of rows) accumulator.add(row);
  return accumulator.value();
}
