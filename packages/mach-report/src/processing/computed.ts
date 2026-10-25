import { REPORT_EXPRESSION_FUNCTIONS } from "./expression-functions";
import {
  compileReportExpression,
  computationFieldName,
  computationScalar,
  expressionFields,
  type ExpressionOptions,
  type ReportExpression,
} from "./expressions";
import { decimalDigits } from "./decimal";
import { cachedRowValue, computedProgram, rememberRowValue, type CompiledComputationField, type ComputationRun } from "./computation-workspace";
export type { ReportExpression } from "./expressions";
export interface ComputedField extends ExpressionOptions {
  field: string;
  expression: ReportExpression | string;
  /** Scope controls aggregate inputs; row expressions may reference the current row in any scope. */
  scope?: "row" | "group" | "dataset";
  groupBy?: readonly string[];
  /** String adapter expressions cannot be inspected; declare dependencies explicitly. */
  dependsOn?: readonly string[];
}
export interface FormulaAdapter {
  /** Explicit trusted engine; core never evaluates source code/macros/external workbook references. */
  evaluate(
    expression: string,
    context: {
      row: Readonly<Record<string, unknown>>;
      rowIndex: number;
      rows: readonly Record<string, unknown>[];
    },
  ): unknown;
}
export interface ComputedDatasetOptions {
  fields: readonly ComputedField[];
  formula?: FormulaAdapter;
  maxRows?: number;
  maxCells?: number;
  signal?: AbortSignal;
  onError?: "throw" | "null";
}
export interface ComputationIssue {
  rowIndex: number;
  field: string;
  message: string;
}
export interface ComputedFieldDiagnostic {
  field: string;
  dependencies: string[];
  scope: "row" | "group" | "dataset";
}
export interface ComputationValidation {
  valid: boolean;
  errors: string[];
  fields: ComputedFieldDiagnostic[];
  order: string[];
}
function checkDefinition(field: ComputedField): void {
  computationFieldName(field.field);
  if (
    field.scope !== undefined &&
    !["row", "group", "dataset"].includes(field.scope)
  )
    throw new Error("未知计算范围");
  if (
    field.numeric !== undefined &&
    field.numeric !== "number" &&
    field.numeric !== "decimal"
  )
    throw new Error("未知数值模式");
  if (field.digits !== undefined) decimalDigits(field.digits);
  if (
    field.nulls !== undefined &&
    field.nulls !== "propagate" &&
    field.nulls !== "error"
  )
    throw new Error("未知空值规则");
  if (
    field.divisionByZero !== undefined &&
    field.divisionByZero !== "null" &&
    field.divisionByZero !== "error"
  )
    throw new Error("未知除零规则");
  if (
    field.scope === "group" &&
    (!Array.isArray(field.groupBy) || !field.groupBy.length)
  )
    throw new Error("分组计算需要 groupBy 字段");
  checkDependencyFields(field);
}
function checkDependencyFields(field: ComputedField): void {
  if (field.groupBy !== undefined) {
    if (!Array.isArray(field.groupBy) || field.groupBy.length > 16)
      throw new Error("计算分组最多 16 级");
    field.groupBy.forEach(computationFieldName);
  }
  if (field.dependsOn !== undefined) {
    if (!Array.isArray(field.dependsOn) || field.dependsOn.length > 2048)
      throw new Error("计算依赖超出预算");
    field.dependsOn.forEach(computationFieldName);
  }
}
function dependencies(field: ComputedField): string[] {
  return [
    ...new Set([
      ...(typeof field.expression === "string"
        ? field.dependsOn ?? []
        : expressionFields(field.expression)),
      ...(field.groupBy ?? []),
    ]),
  ];
}
function orderedFields(definitions: readonly ComputedField[]): ComputedField[] {
  if (!Array.isArray(definitions) || definitions.length > 2048)
    throw new Error("计算字段应为数组且最多2048项");
  const map = new Map<string, ComputedField>();
  for (const field of definitions) {
    checkDefinition(field);
    if (map.has(field.field)) throw new Error(`计算字段重复：${field.field}`);
    map.set(field.field, field);
  }
  const visiting = new Set<string>(),
    completed = new Set<string>(),
    result: ComputedField[] = [];
  function visit(field: ComputedField): void {
    if (completed.has(field.field)) return;
    if (visiting.has(field.field))
      throw new Error(
        `计算字段存在循环依赖：${[...visiting, field.field].join(" → ")}`,
      );
    visiting.add(field.field);
    for (const name of dependencies(field)) {
      const target = map.get(name);
      if (target) visit(target);
    }
    visiting.delete(field.field);
    completed.add(field.field);
    result.push(field);
  }
  definitions.forEach(visit);
  return result;
}
/** Design-time validation: no input data, adapters, evaluation or DOM required. */
export function validateComputedFields(
  definitions: readonly ComputedField[],
): ComputationValidation {
  try {
    const ordered = orderedFields(definitions);
    return {
      valid: true,
      errors: [],
      order: ordered.map((item) => item.field),
      fields: definitions.map((item) => ({
        field: item.field,
        dependencies: dependencies(item),
        scope: item.scope ?? "row",
      })),
    };
  } catch (cause) {
    return {
      valid: false,
      errors: [cause instanceof Error ? cause.message : String(cause)],
      fields: [],
      order: [],
    };
  }
}
export function getComputationMetadata(
  fields: readonly { field: string; type: string; label?: string }[] = [],
) {
  return {
    fields: fields.map((field) => ({ ...field })),
    functions: REPORT_EXPRESSION_FUNCTIONS,
    operations: REPORT_EXPRESSION_FUNCTIONS.map(item => item.name),
    aggregates: ["sum", "count", "avg", "min", "max", "weightedAvg"] as const,
    scopes: ["row", "group", "dataset"] as const,
    numericModes: ["number", "decimal"] as const,
    rules: {
      nulls: "propagate",
      aggregateNulls: "skip",
      emptyAggregate: null,
      countEmpty: 0,
      divisionByZero: "error",
      decimalOutput: "string",
      rounding: "half-away-from-zero",
    } as const,
  };
}
function compileFields(options: ComputedDatasetOptions): CompiledComputationField[] {
  return orderedFields(options.fields).map((definition) => {
    const fieldDependencies = dependencies(definition);
    if (typeof definition.expression !== "string")
      return {
        definition,
        dependencies: fieldDependencies,
        read: compileReportExpression(definition.expression, definition),
      };
    if (!options.formula)
      throw new Error("字符串公式需要显式配置 formula adapter");
    const expression = definition.expression;
    return {
      definition,
      dependencies: fieldDependencies,
      read: (context) => options.formula!.evaluate(expression, context),
    };
  });
}
function groupKey(
  row: Record<string, unknown>,
  fields: readonly string[],
): string {
  return JSON.stringify(
    fields.map((field) => {
      const value = Object.prototype.hasOwnProperty.call(row, field)
        ? row[field]
        : null;
      if (value != null && !computationScalar(value))
        throw new Error("分组字段应为有限 JSON 标量");
      return [typeof value, value ?? null];
    }),
  );
}
function scopeRows(
  rows: Record<string, unknown>[],
  definition: ComputedField,
): (row: Record<string, unknown>) => readonly Record<string, unknown>[] {
  if (definition.scope === "dataset") return () => rows;
  if (definition.scope !== "group") {
    const singletons = new WeakMap<object, Record<string, unknown>[]>();
    return (row) => {
      let value = singletons.get(row);
      if (!value) {
        value = [row];
        singletons.set(row, value);
      }
      return value;
    };
  }
  const groups = new Map<string, Record<string, unknown>[]>(),
    keys = new WeakMap<object, string>();
  for (const row of rows) {
    const key = groupKey(row, definition.groupBy!);
    keys.set(row, key);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return (row) => groups.get(keys.get(row)!)!;
}
function checkInput(
  input: readonly Record<string, unknown>[],
  options: ComputedDatasetOptions,
): void {
  const maxRows = options.maxRows ?? 100_000,
    maxCells = options.maxCells ?? 2_000_000;
  if (
    !Array.isArray(input) ||
    !Number.isSafeInteger(maxRows) ||
    maxRows < 1 ||
    input.length > maxRows
  )
    throw new Error("计算数据行数超出预算或输入不是数组");
  if (!Array.isArray(options.fields) || options.fields.length > 2048)
    throw new Error("计算字段应为数组且最多2048项");
  if (
    !Number.isSafeInteger(maxCells) ||
    maxCells < 1 ||
    input.length * options.fields.length > maxCells
  )
    throw new Error("计算单元格超出 maxCells 预算");
}
function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error("数据计算已取消");
    error.name = "AbortError";
    throw error;
  }
}
function evaluateField(
  item: CompiledComputationField,
  row: Record<string, unknown>,
  rowIndex: number,
  rows: readonly Record<string, unknown>[],
  options: ComputedDatasetOptions,
  issues: ComputationIssue[],
): void {
  try {
    const value = item.read({ row, rowIndex, rows });
    if (value !== undefined && !computationScalar(value))
      throw new Error("计算结果应为有限 JSON 标量，异步公式请先在数据源中求值");
    row[item.definition.field] = value ?? null;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (options.onError !== "null")
      throw Object.assign(
        new Error(`第 ${rowIndex + 1} 行 ${item.definition.field}：${message}`),
        { cause },
      );
    row[item.definition.field] = null;
    issues.push({ rowIndex, field: item.definition.field, message });
  }
}
function evaluateCachedField(run: ComputationRun, source: object, item: CompiledComputationField, row: Record<string, unknown>, rowIndex: number, rows: readonly Record<string, unknown>[], options: ComputedDatasetOptions, issues: ComputationIssue[]): void {
  const cached = cachedRowValue(run, source, item, row);
  if (cached && (!cached.issue || options.onError === "null")) {
    row[item.definition.field] = cached.value;
    if (cached.issue) issues.push({ ...cached.issue, rowIndex });
    return;
  }
  const issueCount = issues.length;
  evaluateField(item, row, rowIndex, rows, options, issues);
  rememberRowValue(run, source, item, row, issues.length > issueCount ? issues[issues.length - 1] : undefined);
}
/** Topologically ordered column passes keep aggregate dependencies correct and avoid quadratic group scans. */
export function computeDataset(
  input: readonly Record<string, unknown>[],
  options: ComputedDatasetOptions,
): { rows: Record<string, unknown>[]; issues: ComputationIssue[] } {
  checkInput(input, options);
  checkAbort(options.signal);
  const program = computedProgram(input, options.fields, () => compileFields(options));
  const run: ComputationRun = { program, writes: new WeakMap() };
  const compiled = program?.fields ?? compileFields(options),
    issues: ComputationIssue[] = [];
  const rows = input.map((source, index) => {
    if (!source || typeof source !== "object" || Array.isArray(source))
      throw new Error(`第 ${index + 1} 行应为对象`);
    return { ...source };
  });
  for (const item of compiled) {
    const scope = scopeRows(rows, item.definition);
    rows.forEach((row, index) => {
      checkAbort(options.signal);
      evaluateCachedField(run, input[index]!, item, row, index, scope(row), options, issues);
    });
  }
  return { rows, issues };
}
