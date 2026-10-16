export type ReportExpression =
  | { field: string }
  | { value: string | number | boolean | null }
  | { op: "add" | "subtract" | "multiply" | "divide" | "coalesce"; args: readonly ReportExpression[] };
export interface ComputedField { field: string; expression: ReportExpression | string }
export interface FormulaAdapter {
  /** 显式注入受信任的公式引擎；核心不执行 eval、宏或外部工作簿引用。 */
  evaluate(expression: string, context: { row: Readonly<Record<string, unknown>>; rowIndex: number }): unknown;
}
export interface ComputedDatasetOptions {
  fields: readonly ComputedField[];
  formula?: FormulaAdapter;
  maxRows?: number;
  /** Calculated cells (rows × fields), default 2 million; at most 2048 field definitions. */
  maxCells?: number;
  signal?: AbortSignal;
  onError?: "throw" | "null";
}
export interface ComputationIssue { rowIndex: number; field: string; message: string }
type Reader = (row: Record<string, unknown>, index: number) => unknown;
const UNSAFE = new Set(["__proto__", "prototype", "constructor"]);

function fieldName(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || UNSAFE.has(value)) throw new Error("计算字段应为安全的非空字段名");
}
function scalar(value: unknown): boolean { return value === null || ["string", "boolean"].includes(typeof value) || (typeof value === "number" && Number.isFinite(value)); }
function numeric(values: unknown[]): number[] {
  if (values.some((value) => typeof value !== "number" || !Number.isFinite(value))) throw new Error("算术参数必须是有限数字；空值和小数文本不会隐式转换");
  return values as number[];
}
function calculate(op: string, values: unknown[]): unknown {
  const numbers = numeric(values);
  let result: number;
  if (op === "add") result = numbers.reduce((a, b) => a + b, 0);
  else if (op === "multiply") result = numbers.reduce((a, b) => a * b, 1);
  else if (op === "subtract") result = numbers[0]! - numbers[1]!;
  else { if (numbers[1] === 0) throw new Error("不能除以零"); result = numbers[0]! / numbers[1]!; }
  if (!Number.isFinite(result)) throw new Error("计算结果不是有限数字");
  return result;
}
function compile(expression: ReportExpression, budget: { nodes: number }, depth = 0): Reader {
  if (++budget.nodes > 256 || depth > 16) throw new Error("计算表达式超出深度或节点预算");
  if (!expression || typeof expression !== "object" || Array.isArray(expression)) throw new Error("计算表达式应为声明式对象");
  if ("field" in expression) {
    fieldName(expression.field);
    const field = expression.field;
    return (row) => Object.prototype.hasOwnProperty.call(row, field) ? row[field] : undefined;
  }
  if ("value" in expression) {
    if (!scalar(expression.value)) throw new Error("常量应为有限 JSON 标量");
    return () => expression.value;
  }
  if (!["add", "subtract", "multiply", "divide", "coalesce"].includes(expression.op) || !Array.isArray(expression.args)) throw new Error("未知计算操作");
  if (expression.args.length < 2 || (["subtract", "divide"].includes(expression.op) && expression.args.length !== 2)) throw new Error("运算参数数量不正确");
  const readers = expression.args.map((argument) => compile(argument, budget, depth + 1));
  if (expression.op === "coalesce") return (row, index) => coalesce(readers, row, index);
  return (row, index) => calculate(expression.op, readers.map((read) => read(row, index)));
}
function coalesce(readers: Reader[], row: Record<string, unknown>, index: number): unknown {
  for (const read of readers) {
    const value = read(row, index);
    if (value !== null && value !== undefined) return value;
  }
  return null;
}
function fields(options: ComputedDatasetOptions) {
  const names = new Set<string>();
  return options.fields.map((field) => {
    fieldName(field.field);
    if (names.has(field.field)) throw new Error(`计算字段重复：${field.field}`);
    names.add(field.field);
    const expression = field.expression;
    let read: Reader;
    if (typeof expression === "string") {
      if (!options.formula) throw new Error("字符串公式需要显式配置 formula adapter");
      read = (row, rowIndex) => options.formula!.evaluate(expression, { row, rowIndex });
    } else read = compile(expression, { nodes: 0 });
    return { field: field.field, read };
  });
}
function checkInput(input: readonly Record<string, unknown>[], options: ComputedDatasetOptions): void {
  const maxRows = options.maxRows ?? 100_000, maxCells = options.maxCells ?? 2_000_000;
  if (!Array.isArray(input) || !Number.isSafeInteger(maxRows) || maxRows < 1 || input.length > maxRows) throw new Error("计算数据行数超出预算或输入不是数组");
  if (!Array.isArray(options.fields) || options.fields.length > 2048) throw new Error("计算字段应为数组且最多2048项");
  if (!Number.isSafeInteger(maxCells) || maxCells < 1 || input.length * options.fields.length > maxCells) throw new Error("计算单元格超出 maxCells 预算");
}

/** 纯数据计算与界面解耦；字段按声明顺序计算，可供后续字段引用，不修改输入数据。 */
export function computeDataset(input: readonly Record<string, unknown>[], options: ComputedDatasetOptions): { rows: Record<string, unknown>[]; issues: ComputationIssue[] } {
  checkInput(input, options);
  const compiled = fields(options), issues: ComputationIssue[] = [];
  const rows = input.map((source, rowIndex) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error(`第 ${rowIndex + 1} 行应为对象`);
    if (options.signal?.aborted) { const error = new Error("数据计算已取消"); error.name = "AbortError"; throw error; }
    const row = { ...source };
    for (const item of compiled) {
      try {
        const value = item.read(row, rowIndex);
        if (value !== undefined && !scalar(value)) throw new Error("计算结果应为有限 JSON 标量，异步公式请先在数据源中求值");
        row[item.field] = value ?? null;
      }
      catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        if (options.onError !== "null") throw Object.assign(new Error(`第 ${rowIndex + 1} 行 ${item.field}：${message}`), { cause });
        row[item.field] = null; issues.push({ rowIndex, field: item.field, message });
      }
    }
    return row;
  });
  return { rows, issues };
}
