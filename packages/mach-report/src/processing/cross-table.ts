import {
  createAggregateAccumulator,
  type AggregateAccumulator,
  type AggregateOperation,
} from "./aggregate";
import type { TableTemplateColumn } from "../builder/table-template";

export interface CrossTableOptions {
  rowField: string;
  columnField: string;
  valueField?: string;
  aggregate?: AggregateOperation;
  weightField?: string;
  numeric?: "number" | "decimal";
  digits?: number;
  totals?: boolean;
  rowHeader?: string;
  /** Existing count defaults to row counts; opt-in SQL COUNT(field) skips nulls. */
  countMode?: "rows" | "nonNull";
  maxRows?: number;
  maxColumns?: number;
  maxInputRows?: number;
  /** Dense output cells, including the dimension column and optional totals; default 2 million. */
  maxCells?: number;
}
export interface CrossTableResult {
  columns: TableTemplateColumn[];
  rows: Record<string, unknown>[];
}
function own(row: Record<string, unknown>, field: string): unknown {
  return Object.prototype.hasOwnProperty.call(row, field)
    ? row[field]
    : undefined;
}
function key(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (
    typeof value !== "string" &&
    typeof value !== "boolean" &&
    !(typeof value === "number" && Number.isFinite(value))
  )
    throw new Error("交叉表维度应为字符串、布尔、有限数字或空值");
  return JSON.stringify([typeof value, value]);
}
function label(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}
function budget(value: number | undefined, fallback: number): number {
  const limit = value ?? fallback;
  if (!Number.isInteger(limit) || limit < 1)
    throw new Error("交叉表预算应为正整数");
  return limit;
}
function checkOutputCells(
  rows: number,
  columns: number,
  totals: boolean | undefined,
  limit: number,
): void {
  const extra = totals ? 1 : 0;
  if ((rows + extra) * (columns + 1 + extra) > limit)
    throw new Error(
      "交叉表输出单元格超出 maxCells 预算，请减少维度或服务端预聚合",
    );
}

/** 通用交叉聚合；合计直接累计原始度量，平均值不会错误地平均各分组合计。 */
export function createCrossTable(
  input: readonly Record<string, unknown>[],
  options: CrossTableOptions,
): CrossTableResult {
  if (!Array.isArray(input)) throw new Error("交叉表数据应为对象数组");
  const kind = options.aggregate ?? "sum";
  if (!["sum", "count", "avg", "min", "max", "weightedAvg"].includes(kind))
    throw new Error("未知交叉表聚合类型");
  if (
    !options.rowField ||
    !options.columnField ||
    (kind !== "count" && !options.valueField)
  )
    throw new Error("交叉表需要明确的行维度、列维度和度量字段");
  if (input.length > budget(options.maxInputRows, 100_000))
    throw new Error("交叉表输入超出预算，请在服务端预聚合");
  const rowLimit = budget(options.maxRows, 1000),
    columnLimit = budget(options.maxColumns, 200);
  const cellLimit = budget(options.maxCells, 2_000_000);
  const empty = () =>
    createAggregateAccumulator({
      op: kind,
      field:
        kind === "count" && options.countMode !== "nonNull"
          ? undefined
          : options.valueField,
      weightField: options.weightField,
      numeric: options.numeric,
      digits: options.digits,
    });
  const columns = new Map<string, string>(),
    groups = new Map<
      string,
      {
        label: string;
        cells: Map<string, AggregateAccumulator>;
        total: AggregateAccumulator;
      }
    >();
  const columnTotals = new Map<string, AggregateAccumulator>(),
    total = empty();
  for (const row of input) {
    const r = key(own(row, options.rowField)),
      c = key(own(row, options.columnField));
    if (!columns.has(c)) columns.set(c, label(own(row, options.columnField)));
    if (!groups.has(r))
      groups.set(r, {
        label: label(own(row, options.rowField)),
        cells: new Map(),
        total: empty(),
      });
    if (columns.size > columnLimit || groups.size > rowLimit)
      throw new Error("交叉表维度数量超出预算");
    checkOutputCells(groups.size, columns.size, options.totals, cellLimit);
    const group = groups.get(r)!;
    if (!group.cells.has(c)) group.cells.set(c, empty());
    if (!columnTotals.has(c)) columnTotals.set(c, empty());
    for (const state of [
      group.cells.get(c)!,
      group.total,
      columnTotals.get(c)!,
      total,
    ])
      state.add(row);
  }
  const result: CrossTableResult = {
    columns: [
      {
        header: options.rowHeader ?? options.rowField,
        field: "rowLabel",
        semanticRole: "dimension",
      },
      ...[...columns.values()].map(
        (header, index): TableTemplateColumn => ({
          header,
          field: `c${index}`,
          semanticRole: "measure",
        }),
      ),
    ],
    rows: [...groups.values()].map((group) => ({
      rowLabel: group.label,
      ...Object.fromEntries(
        [...columns.keys()].map((c, index) => [
          `c${index}`,
          group.cells.get(c)?.value() ?? (kind === "count" ? 0 : null),
        ]),
      ),
      ...(options.totals ? { total: group.total.value() } : {}),
    })),
  };
  if (options.totals) {
    result.columns.push({
      header: "合计",
      field: "total",
      semanticRole: "measure",
    });
    if (input.length)
      result.rows.push({
        rowLabel: "合计",
        ...Object.fromEntries(
          [...columns.keys()].map((c, index) => [
            `c${index}`,
            columnTotals.get(c)?.value() ?? (kind === "count" ? 0 : null),
          ]),
        ),
        total: total.value(),
      });
  }
  return result;
}
