import {
  createAggregateAccumulator,
  type AggregateOperation,
} from "./aggregate";
import { accumulatePivotRows } from "./pivot-accumulator";
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
  const measure = {
    op: kind,
    field: kind === "count" && options.countMode !== "nonNull" ? undefined : options.valueField,
    weightField: options.weightField, numeric: options.numeric, digits: options.digits,
  };
  createAggregateAccumulator(measure); // Validate even when input is empty.
  const { groups, columns, columnTotals, totals } = accumulatePivotRows(input, {
    row: row => ({ key: key(own(row, options.rowField)), label: label(own(row, options.rowField)) }),
    column: row => ({ key: key(own(row, options.columnField)), label: label(own(row, options.columnField)) }),
    measures: [measure], totals: options.totals,
    check: (rows, columns) => {
      if (rows > rowLimit || columns > columnLimit) throw new Error("交叉表维度数量超出预算");
      checkOutputCells(rows, columns, options.totals, cellLimit);
    },
  });
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
          group.cells.get(c)?.[0]?.value() ?? (kind === "count" ? 0 : null),
        ]),
      ),
      ...(options.totals ? { total: group.totals![0]!.value() } : {}),
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
            columnTotals.get(c)?.[0]?.value() ?? (kind === "count" ? 0 : null),
          ]),
        ),
        total: totals![0]!.value(),
      });
  }
  return result;
}
