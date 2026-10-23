import type { CrossTableResult } from "./cross-table";
import { accumulatePivotRows } from "./pivot-accumulator";
import {
  createAggregateAccumulator,
  type AggregateDefinition,
} from "./aggregate";
export interface MatrixTableOptions {
  rowFields: readonly string[];
  columnFields: readonly string[];
  measures: readonly (AggregateDefinition & { label?: string })[];
  totals?: boolean;
  rowHeader?: string;
  columnWidthMm?: number;
  rowWidthMm?: number;
  maxRows?: number;
  maxColumns?: number;
  maxInputRows?: number;
  maxCells?: number;
}
function dimension(
  row: Record<string, unknown>,
  fields: readonly string[],
): { key: string; label: string } {
  const values = fields.map((field) =>
    Object.prototype.hasOwnProperty.call(row, field) ? row[field] : null,
  );
  if (
    values.some(
      (value) =>
        value != null &&
        typeof value !== "string" &&
        typeof value !== "boolean" &&
        !(typeof value === "number" && Number.isFinite(value)),
    )
  )
    throw new Error("矩阵维度必须是有限 JSON 标量");
  return {
    key: JSON.stringify(values.map((value) => [typeof value, value ?? null])),
    label: values
      .map((value) => (value == null ? "" : String(value)))
      .join(" / "),
  };
}
function validateMatrixBounds(options: MatrixTableOptions): void {
  for (const key of [
    "maxRows",
    "maxColumns",
    "maxInputRows",
    "maxCells",
  ] as const)
    if (
      options[key] !== undefined &&
      (!Number.isSafeInteger(options[key]) || options[key]! < 1)
    )
      throw new Error("矩阵预算应为正安全整数");
  for (const key of ["columnWidthMm", "rowWidthMm"] as const)
    if (
      options[key] !== undefined &&
      (!Number.isFinite(options[key]) || options[key]! <= 0)
    )
      throw new Error("矩阵列宽应为正数");
}
export function validateMatrixOptions(options: MatrixTableOptions): void {
  if (
    !options ||
    !Array.isArray(options.rowFields) ||
    !Array.isArray(options.columnFields) ||
    !Array.isArray(options.measures)
  )
    throw new Error("矩阵需要行维度、列维度和度量数组");
  for (const fields of [options.rowFields, options.columnFields])
    if (
      fields.some((field) => typeof field !== "string" || !field.trim()) ||
      new Set(fields).size !== fields.length
    )
      throw new Error("矩阵维度字段应非空且唯一");
  validateMatrixBounds(options);
  if (
    !options.rowFields.length ||
    !options.columnFields.length ||
    options.rowFields.length > 16 ||
    options.columnFields.length > 16
  )
    throw new Error("矩阵需要 1–16 个行/列维度");
  if (!options.measures.length || options.measures.length > 32)
    throw new Error("矩阵需要 1–32 个度量");
  const names = options.measures.map((item) => {
    if (!item || typeof item !== "object") throw new Error("矩阵度量应为对象");
    createAggregateAccumulator({
      ...item,
      field: item.valueField ?? item.field,
    });
    if (item.label !== undefined && typeof item.label !== "string")
      throw new Error("矩阵度量标签应为字符串");
    return item.field;
  });
  if (names.some((name) => typeof name !== "string" || !name.trim()))
    throw new Error("矩阵度量字段应非空");
}
export interface MatrixTableShape {
  rowCount: number;
  columnCount: number;
  cells: number;
}
/** Cardinality pass checks expansion budgets before allocating the dense pivot output. */
export function estimateMatrixTable(
  input: readonly Record<string, unknown>[],
  options: MatrixTableOptions,
): MatrixTableShape {
  validateMatrixOptions(options);
  if (!Array.isArray(input) || input.length > (options.maxInputRows ?? 100_000))
    throw new Error("矩阵输入超出预算");
  const rows = new Set<string>(),
    columns = new Set<string>();
  for (const row of input) {
    if (!row || typeof row !== "object" || Array.isArray(row))
      throw new Error("矩阵数据行应为对象");
    rows.add(dimension(row, options.rowFields).key);
    columns.add(dimension(row, options.columnFields).key);
    if (
      rows.size > (options.maxRows ?? 1000) ||
      columns.size > (options.maxColumns ?? 200)
    )
      throw new Error("矩阵维度数量超出预算");
    const cells =
      (rows.size + Number(!!options.totals)) *
      ((columns.size + Number(!!options.totals)) * options.measures.length + 1);
    if (cells > (options.maxCells ?? 2_000_000))
      throw new Error("矩阵输出超出 maxCells 预算");
  }
  const rowCount = rows.size + Number(!!options.totals && input.length > 0),
    columnCount =
      (columns.size + Number(!!options.totals)) * options.measures.length + 1;
  return { rowCount, columnCount, cells: rowCount * columnCount };
}
/** Multi-measure pivot shares dimensions and original rows; weighted totals never average averages. */
export function createMatrixTable(input: readonly Record<string, unknown>[], options: MatrixTableOptions): CrossTableResult {
  estimateMatrixTable(input, options);
  const pivot = accumulatePivotRows(input, {
    row: row => dimension(row, options.rowFields), column: row => dimension(row, options.columnFields),
    measures: options.measures.map(measure => ({ ...measure, field: measure.valueField ?? measure.field })),
    totals: options.totals, check: () => {}, // Cardinality/budgets were checked before allocating accumulators.
  });
  const rows: Record<string, unknown>[] = [...pivot.groups.values()].map(group => ({ rowLabel: group.label }));
  const columns: CrossTableResult["columns"] = [{ field: "rowLabel", header: options.rowHeader ?? options.rowFields.join(" / "), semanticRole: "dimension" }];
  const totalRow: Record<string, unknown> = { rowLabel: "合计" };
  options.measures.forEach((measure, metric) => {
    const dimensions = [...pivot.columns.entries()].map(([key, label], index) => ({ key, label, field: `c${index}_${metric}` }));
    if (options.totals) dimensions.push({ key: "", label: "合计", field: `total_${metric}` });
    for (const column of dimensions) {
      const total = column.field === `total_${metric}`;
      columns.push({ field: column.field, header: `${column.label} · ${measure.label ?? `${measure.field} (${measure.op})`}`, semanticRole: "measure",
        ...(measure.digits === undefined ? {} : { format: { kind: "number", digits: measure.digits } }) });
      let index = 0;
      for (const group of pivot.groups.values()) {
        rows[index++]![column.field] = (total ? group.totals?.[metric] : group.cells.get(column.key)?.[metric])?.value() ?? (measure.op === "count" ? 0 : null);
      }
      totalRow[column.field] = (total ? pivot.totals?.[metric] : pivot.columnTotals.get(column.key)?.[metric])?.value() ?? (measure.op === "count" ? 0 : null);
    }
  });
  if (options.totals && input.length) rows.push(totalRow);
  return { rows, columns };
}
