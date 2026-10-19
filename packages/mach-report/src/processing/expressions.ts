import { aggregateRows, type AggregateOperation } from "./aggregate";
import {
  addDecimal,
  divideDecimal,
  multiplyDecimal,
  parseDecimal,
  printDecimal,
} from "./decimal";
export type ReportExpression =
  | { field: string }
  | { value: string | number | boolean | null }
  | { aggregate: AggregateOperation; field?: string; weightField?: string }
  | {
      op: "add" | "subtract" | "multiply" | "divide" | "coalesce";
      args: readonly ReportExpression[];
    };
export interface ExpressionContext {
  row: Record<string, unknown>;
  rowIndex: number;
  rows: readonly Record<string, unknown>[];
}
export interface ExpressionOptions {
  numeric?: "number" | "decimal";
  digits?: number;
  nulls?: "propagate" | "error";
  divisionByZero?: "null" | "error";
}
export type ExpressionReader = (context: ExpressionContext) => unknown;
const UNSAFE = new Set(["__proto__", "prototype", "constructor"]);
export function computationFieldName(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || UNSAFE.has(value))
    throw new Error("计算字段应为安全的非空字段名");
}
export function computationScalar(value: unknown): boolean {
  return (
    value === null ||
    ["string", "boolean"].includes(typeof value) ||
    (typeof value === "number" && Number.isFinite(value))
  );
}
function numeric(values: unknown[]): number[] {
  if (
    values.some((value) => typeof value !== "number" || !Number.isFinite(value))
  )
    throw new Error("算术参数必须是有限数字；空值和小数文本不会隐式转换");
  return values as number[];
}
function calculateNumber(op: string, values: unknown[]): number {
  const numbers = numeric(values);
  let result: number;
  if (op === "add") result = numbers.reduce((a, b) => a + b, 0);
  else if (op === "multiply") result = numbers.reduce((a, b) => a * b, 1);
  else if (op === "subtract") result = numbers[0]! - numbers[1]!;
  else {
    if (numbers[1] === 0) throw new Error("不能除以零");
    result = numbers[0]! / numbers[1]!;
  }
  if (!Number.isFinite(result)) throw new Error("计算结果不是有限数字");
  return result;
}
function calculateDecimal(
  op: string,
  values: unknown[],
  digits?: number,
): string {
  const numbers = values.map(parseDecimal);
  let result;
  if (op === "add") result = numbers.reduce(addDecimal);
  else if (op === "multiply") result = numbers.reduce(multiplyDecimal);
  else if (op === "subtract")
    result = addDecimal(numbers[0]!, {
      ...numbers[1]!,
      coefficient: -numbers[1]!.coefficient,
    });
  else result = divideDecimal(numbers[0]!, numbers[1]!, digits);
  return printDecimal(result, digits);
}
function calculate(
  op: string,
  values: unknown[],
  options: ExpressionOptions,
): unknown {
  if (options.nulls !== "error" && values.some((value) => value == null))
    return null;
  if (op === "divide" && options.divisionByZero === "null") {
    const zero =
      options.numeric === "decimal"
        ? parseDecimal(values[1]).coefficient === 0n
        : values[1] === 0;
    if (zero) return null;
  }
  return options.numeric === "decimal"
    ? calculateDecimal(op, values, options.digits)
    : calculateNumber(op, values);
}
function aggregateReader(
  expression: Extract<ReportExpression, { aggregate: string }>,
  options: ExpressionOptions,
): ExpressionReader {
  if (expression.field !== undefined) computationFieldName(expression.field);
  if (expression.weightField !== undefined)
    computationFieldName(expression.weightField);
  const request = {
    op: expression.aggregate,
    field: expression.field,
    weightField: expression.weightField,
    numeric: options.numeric,
    digits: options.digits,
  };
  aggregateRows([], request); // Validate even when the input dataset is empty.
  const cache = new WeakMap<
    readonly Record<string, unknown>[],
    { value?: unknown; error?: Error }
  >();
  return (context) => {
    let entry = cache.get(context.rows);
    if (!entry) {
      try {
        entry = { value: aggregateRows(context.rows, request) };
      } catch (cause) {
        entry = {
          error: cause instanceof Error ? cause : new Error(String(cause)),
        };
      }
      cache.set(context.rows, entry);
    }
    if (entry.error) throw entry.error;
    return entry.value;
  };
}
function coalesce(
  readers: ExpressionReader[],
  context: ExpressionContext,
): unknown {
  for (const read of readers) {
    const value = read(context);
    if (value != null) return value;
  }
  return null;
}
export function compileReportExpression(
  expression: ReportExpression,
  options: ExpressionOptions = {},
  budget = { nodes: 0 },
  depth = 0,
): ExpressionReader {
  if (++budget.nodes > 256 || depth > 16)
    throw new Error("计算表达式超出深度或节点预算");
  if (
    !expression ||
    typeof expression !== "object" ||
    Array.isArray(expression)
  )
    throw new Error("计算表达式应为声明式对象");
  if ("aggregate" in expression) return aggregateReader(expression, options);
  if ("field" in expression) {
    computationFieldName(expression.field);
    const field = expression.field;
    return ({ row }) =>
      Object.prototype.hasOwnProperty.call(row, field) ? row[field] : undefined;
  }
  if ("value" in expression) {
    if (!computationScalar(expression.value))
      throw new Error("常量应为有限 JSON 标量");
    return () => expression.value;
  }
  return compileOperation(expression, options, budget, depth);
}
function compileOperation(
  expression: Extract<ReportExpression, { op: string }>,
  options: ExpressionOptions,
  budget: { nodes: number },
  depth: number,
): ExpressionReader {
  if (
    !["add", "subtract", "multiply", "divide", "coalesce"].includes(
      expression.op,
    ) ||
    !Array.isArray(expression.args)
  )
    throw new Error("未知计算操作");
  if (
    expression.args.length > 256 ||
    Object.keys(expression.args).length !== expression.args.length
  )
    throw new Error("计算参数超出预算或包含空位");
  if (
    expression.args.length < 2 ||
    (["subtract", "divide"].includes(expression.op) &&
      expression.args.length !== 2)
  )
    throw new Error("运算参数数量不正确");
  const readers = expression.args.map((argument) =>
    compileReportExpression(argument, options, budget, depth + 1),
  );
  if (expression.op === "coalesce")
    return (context) => coalesce(readers, context);
  return (context) =>
    calculate(
      expression.op,
      readers.map((read) => read(context)),
      options,
    );
}
/** Exact field dependencies, including aggregate weights; the same budgets as runtime apply. */
export function expressionFields(expression: ReportExpression): string[] {
  compileReportExpression(expression);
  const fields = new Set<string>();
  const visit = (node: ReportExpression) => {
    if ("field" in node && node.field) fields.add(node.field);
    if ("aggregate" in node && node.weightField) fields.add(node.weightField);
    if ("args" in node) node.args.forEach(visit);
  };
  visit(expression);
  return [...fields];
}
