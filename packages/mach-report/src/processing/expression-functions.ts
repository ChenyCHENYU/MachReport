import { decimalDigits, parseDecimal, printDecimal } from "./decimal";
import { predicateCalendarDay } from "./predicate";
export type ReportExpressionOperation = "add" | "subtract" | "multiply" | "divide" | "coalesce" | "if" | "round" | "abs" | "concat" | "trim" | "upper" | "lower" | "dateYear" | "dateMonth" | "dateDay";
export interface ReportExpressionFunction {
  readonly name: ReportExpressionOperation;
  readonly minArgs: number;
  readonly maxArgs: number;
  readonly input: string;
  readonly output: string;
  readonly example: string;
}
const definitions: readonly ReportExpressionFunction[] = [
  { name: "add", minArgs: 2, maxArgs: 256, input: "numeric", output: "numeric", example: "add(quantity, adjustment)" },
  { name: "subtract", minArgs: 2, maxArgs: 2, input: "numeric", output: "numeric", example: "subtract(input, output)" },
  { name: "multiply", minArgs: 2, maxArgs: 256, input: "numeric", output: "numeric", example: "multiply(quantity, price)" },
  { name: "divide", minArgs: 2, maxArgs: 2, input: "numeric", output: "numeric", example: "divide(amount, quantity)" },
  { name: "coalesce", minArgs: 2, maxArgs: 256, input: "scalar", output: "scalar", example: "coalesce(actual, planned)" },
  { name: "if", minArgs: 2, maxArgs: 2, input: "condition + branches", output: "scalar", example: "if(quantity > 0, divide(amount, quantity), null)" },
  { name: "round", minArgs: 1, maxArgs: 2, input: "numeric, digits?", output: "numeric", example: "round(amount, 2)" },
  { name: "abs", minArgs: 1, maxArgs: 1, input: "numeric", output: "numeric", example: "abs(difference)" },
  { name: "concat", minArgs: 2, maxArgs: 256, input: "text", output: "text", example: "concat(plant, '-' , heat)" },
  { name: "trim", minArgs: 1, maxArgs: 1, input: "text", output: "text", example: "trim(heat)" },
  { name: "upper", minArgs: 1, maxArgs: 1, input: "text", output: "text", example: "upper(grade)" },
  { name: "lower", minArgs: 1, maxArgs: 1, input: "text", output: "text", example: "lower(code)" },
  { name: "dateYear", minArgs: 1, maxArgs: 1, input: "YYYY-MM-DD", output: "number", example: "dateYear(reportDate)" },
  { name: "dateMonth", minArgs: 1, maxArgs: 1, input: "YYYY-MM-DD", output: "number", example: "dateMonth(reportDate)" },
  { name: "dateDay", minArgs: 1, maxArgs: 1, input: "YYYY-MM-DD", output: "number", example: "dateDay(reportDate)" },
] as const;
/** Shared compiler metadata is immutable at runtime as well as in declarations. */
export const REPORT_EXPRESSION_FUNCTIONS: readonly ReportExpressionFunction[] = Object.freeze(definitions.map(item => Object.freeze(item)));
export function evaluateScalarFunction(op: string, values: unknown[], numeric?: "number" | "decimal", digits?: number, nulls?: "propagate" | "error"): unknown {
  if (values.some(value => value == null)) { if (nulls === "error") throw new Error("函数参数包含空值"); return null; }
  if (op === "round" || op === "abs") return numericFunction(op, values, numeric, digits);
  if (op.startsWith("date")) {
    const date = predicateCalendarDay(values[0]);
    return Number(date.slice(op === "dateYear" ? 0 : op === "dateMonth" ? 5 : 8, op === "dateYear" ? 4 : op === "dateMonth" ? 7 : 10));
  }
  if (values.some(value => typeof value !== "string")) throw new Error("文本函数只接受文本，不隐式转换数字或空值");
  if (values.reduce<number>((total, value) => total + (value as string).length, 0) > 1_000_000) throw new Error("计算文本超出长度预算");
  const text = values[0] as string;
  const result = op === "concat" ? values.join("") : op === "trim" ? text.trim() : op === "upper" ? text.toUpperCase() : text.toLowerCase();
  if (result.length > 1_000_000) throw new Error("计算文本超出长度预算");
  return result;
}
function numericFunction(op: string, values: unknown[], numeric?: "number" | "decimal", digits?: number): unknown {
  const value = values[0];
  if (numeric !== "decimal" && (typeof value !== "number" || !Number.isFinite(value))) throw new Error("普通数值函数需要有限数字");
  const decimal = parseDecimal(value);
  if (op === "abs") { decimal.coefficient = decimal.coefficient < 0n ? -decimal.coefficient : decimal.coefficient; }
  const precision = op === "round" ? values.length === 2 ? values[1] : digits ?? 0 : digits;
  if (precision !== undefined) { if (typeof precision !== "number") throw new Error("小数位必须为数字"); decimalDigits(precision); }
  const result = printDecimal(decimal, precision as number | undefined);
  const number = Number(result);
  if (numeric !== "decimal" && !Number.isFinite(number)) throw new Error("计算结果不是有限数字");
  return numeric === "decimal" ? result : number;
}
