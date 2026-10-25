import type { TableTemplateColumn } from "../builder/table-template";
import { createAggregateAccumulator, type AggregateAccumulator } from "./aggregate";
import { addMatrixAxisRow, createMatrixAxis, expandMatrixAxis, matrixAxisKeys, type MatrixAxis } from "./matrix-axis";
import { matrixHeaderGrid } from "./matrix-header";
import type { MatrixColumnMember, MatrixDimensionMember, MatrixTableResult } from "./matrix-model";
import type { MatrixTableOptions, MatrixTableShape } from "./matrix";

interface HierarchyIndex { row: MatrixAxis; column: MatrixAxis; shape: MatrixTableShape }
function checkedShape(inputLength: number, options: MatrixTableOptions, row: MatrixAxis, column: MatrixAxis): MatrixTableShape {
  const total = Number(!!options.totals && inputLength > 0);
  const rowCount = row.expanded + total, columnCount = (column.expanded + total) * options.measures.length + options.rowFields.length;
  if (rowCount > (options.maxRows ?? 1000) || column.expanded + total > (options.maxColumns ?? 200)) throw new Error("矩阵层级展开数量超出预算（包含小计/总计）");
  if (rowCount * columnCount > (options.maxCells ?? 2_000_000)) throw new Error("矩阵输出超出 maxCells 预算");
  return { rowCount, columnCount, cells: rowCount * columnCount };
}
function hierarchyIndex(input: readonly Record<string, unknown>[], options: MatrixTableOptions): HierarchyIndex {
  if (!Array.isArray(input) || input.length > (options.maxInputRows ?? 100_000)) throw new Error("矩阵输入超出预算");
  const row = createMatrixAxis(options.rowFields, options.hierarchy!.row, options.hierarchy!), column = createMatrixAxis(options.columnFields, options.hierarchy!.column, options.hierarchy!);
  const updates = input.length * (1 + (row.options.subtotals?.length ?? 0) + Number(!!options.totals)) * (1 + (column.options.subtotals?.length ?? 0) + Number(!!options.totals)) * options.measures.length;
  if (updates > (options.maxAggregateUpdates ?? 10_000_000)) throw new Error("矩阵聚合更新超出 maxAggregateUpdates 预算");
  let shape = checkedShape(0, options, row, column);
  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("矩阵数据行应为对象");
    addMatrixAxisRow(row, item); addMatrixAxisRow(column, item);
    shape = checkedShape(input.length, options, row, column);
  }
  return { row, column, shape };
}
export function estimateHierarchicalMatrix(input: readonly Record<string, unknown>[], options: MatrixTableOptions): MatrixTableShape {
  return hierarchyIndex(input, options).shape;
}
type States = Map<string, Map<string, AggregateAccumulator[]>>;
function aggregateHierarchy(input: readonly Record<string, unknown>[], options: MatrixTableOptions, index: HierarchyIndex): States {
  const states: States = new Map();
  for (const row of input) {
    const rowKeys = matrixAxisKeys(index.row, row, !!options.totals), columnKeys = matrixAxisKeys(index.column, row, !!options.totals);
    for (const rowKey of rowKeys) {
      let cells = states.get(rowKey);
      if (!cells) { cells = new Map(); states.set(rowKey, cells); }
      for (const columnKey of columnKeys) {
        let accumulators = cells.get(columnKey);
        if (!accumulators) { accumulators = options.measures.map(measure => createAggregateAccumulator({ ...measure, field: measure.valueField ?? measure.field })); cells.set(columnKey, accumulators); }
        accumulators.forEach(state => state.add(row));
      }
    }
  }
  return states;
}
function generatedColumns(members: MatrixDimensionMember[], options: MatrixTableOptions): MatrixColumnMember[] {
  return members.flatMap((member, index) => options.measures.map((measure, metric) => ({ ...member,
    field: member.kind === "total" ? `total_${metric}` : `c${index}_${metric}`, measure: metric, measureField: measure.field,
    valueField: measure.valueField ?? measure.field, operation: measure.op,
  })));
}
function memberLabel(member: MatrixDimensionMember, options: MatrixTableOptions): string {
  if (member.kind === "total") return options.hierarchy!.totalLabel ?? "合计";
  return [...member.labels, ...(member.kind === "subtotal" ? [options.hierarchy!.subtotalLabel ?? "小计"] : [])].join(" / ");
}
function hierarchyColumns(columns: MatrixColumnMember[], options: MatrixTableOptions): TableTemplateColumn[] {
  return [
    ...options.rowFields.map((field, index): TableTemplateColumn => ({ field: `r${index}`, header: options.hierarchy!.row?.labels?.[index] ?? field, semanticRole: "dimension" })),
    ...columns.map((column): TableTemplateColumn => {
      const measure = options.measures[column.measure]!;
      return { field: column.field, header: `${memberLabel(column, options)} · ${measure.label ?? `${measure.field} (${measure.op})`}`, semanticRole: "measure",
        ...(measure.digits === undefined ? {} : { format: { kind: "number", digits: measure.digits } }) };
    }),
  ];
}
function hierarchyRows(members: MatrixDimensionMember[], columns: MatrixColumnMember[], options: MatrixTableOptions, states: States): Record<string, unknown>[] {
  return members.map(member => {
    const row: Record<string, unknown> = {};
    options.rowFields.forEach((_, index) => { row[`r${index}`] = member.kind === "total" ? index === 0 ? options.hierarchy!.totalLabel ?? "合计" : null : member.labels[index] ?? (index === member.depth ? options.hierarchy!.subtotalLabel ?? "小计" : null); });
    for (const column of columns) row[column.field] = states.get(member.key)?.get(column.key)?.[column.measure]?.value() ?? (options.measures[column.measure]!.op === "count" ? 0 : null);
    return row;
  });
}
/** Prefix accumulators consume original rows. AVG/weighted AVG never aggregate displayed averages. */
export function createHierarchicalMatrix(input: readonly Record<string, unknown>[], options: MatrixTableOptions): MatrixTableResult {
  const index = hierarchyIndex(input, options), rows = expandMatrixAxis(index.row, !!options.totals), columns = generatedColumns(expandMatrixAxis(index.column, !!options.totals), options);
  const states = aggregateHierarchy(input, options, index);
  return { columns: hierarchyColumns(columns, options), rows: hierarchyRows(rows, columns, options, states), headerGrid: matrixHeaderGrid(options, columns), metadata: {
    rowFields: [...options.rowFields], rowLabels: [...options.hierarchy!.row?.labels ?? options.rowFields],
    columnFields: [...options.columnFields], columnLabels: [...options.hierarchy!.column?.labels ?? options.columnFields], rows, columns,
  } };
}
