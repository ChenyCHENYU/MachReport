import { createMatrixTable, type MatrixDimensionMember, type MatrixTableMetadata, type MatrixTableOptions } from "../processing/matrix";
import type { ComponentStyle, GridCell, PlanGrid, PlanTableFragment } from "../schema/render-plan";
import { resolveFontSize } from "../render/style";
import { LINE_HEIGHT } from "../defaults";
import { resolveGridLayout } from "../render/grid-geometry";
import { resolveListHeaderStyle } from "./list-cell";
import { wrapText, type TextMeasurer } from "./textwrap";
import type { ListColumn, ListComponent } from "./list-model";

export interface MatrixLayoutMetadata { rows: WeakMap<Record<string, unknown>, MatrixDimensionMember>; header: Omit<MatrixTableMetadata, "rows"> }
export function matrixRowRole(matrix: MatrixLayoutMetadata | undefined, row: Record<string, unknown>): PlanTableFragment["role"] {
  return ({ member: "body", subtotal: "subtotal", total: "grand-total" } as const)[matrix?.rows.get(row)?.kind ?? "member"];
}
function matrixDisplayOptions(list: ListComponent): MatrixTableOptions {
  const options = list.matrix!;
  if (!options.hierarchy) return options;
  const labels = new Map(list.columns.map(column => [column.field, column.header]));
  const operations = { sum: "求和", count: "计数", avg: "平均", min: "最小", max: "最大", weightedAvg: "加权平均" };
  return { ...options, hierarchy: { ...options.hierarchy,
    row: { ...options.hierarchy.row, labels: options.hierarchy.row?.labels ?? options.rowFields.map(field => labels.get(field) ?? field) },
    column: { ...options.hierarchy.column, labels: options.hierarchy.column?.labels ?? options.columnFields.map(field => labels.get(field) ?? field) },
  }, measures: options.measures.map(measure => {
    const label = labels.get(measure.field) ?? labels.get(measure.valueField ?? measure.field);
    return measure.label === undefined && label ? { ...measure, label: `${label}（${operations[measure.op]}）` } : measure;
  }) };
}
export function resolveMatrixLayout(list: ListComponent, rows: Record<string, unknown>[]): { list: ListComponent; rows: Record<string, unknown>[]; matrix?: MatrixLayoutMetadata } {
  if (!list.matrix) return { list, rows };
  if (list.detail || list.groupBy || list.groups?.length || list.grandTotal) throw new Error("矩阵不能同时配置普通分组、总计或主从明细");
  const result = createMatrixTable(rows, matrixDisplayOptions(list));
  const columns: ListColumn[] = result.columns.map(column => ({ ...column, widthMm: column.semanticRole === "dimension" ? list.matrix!.rowWidthMm ?? 40 : list.matrix!.columnWidthMm ?? 28, editable: false, align: column.semanticRole === "dimension" ? "center" : "right" }));
  const derived: ListComponent = { ...list, columns, headerGrid: result.headerGrid, rowKey: undefined, revisionField: undefined, sourceTokenField: undefined };
  if (list.layout === "wide") derived.widthMm = columns.reduce((sum, column) => sum + column.widthMm, 0);
  const metadata = result.metadata;
  const matrix = metadata ? { rows: new WeakMap(result.rows.map((row, index) => [row, metadata.rows[index]!])), header: {
    columns: metadata.columns, rowFields: metadata.rowFields, rowLabels: metadata.rowLabels, columnFields: metadata.columnFields, columnLabels: metadata.columnLabels,
  } } : undefined;
  return { list: derived, rows: result.rows, ...(matrix ? { matrix } : {}) };
}
/** Measure generated hierarchy after physical column scaling; merged headings share the same widths as all exporters. */
export function prepareMatrixHeader(list: ListComponent, measurer: TextMeasurer): PlanGrid | undefined {
  if (!list.matrix?.hierarchy || !list.headerGrid) return list.headerGrid;
  const padding = list.paddingMm ?? 1;
  const rowHeightsMm = list.headerGrid.cells.map(() => list.rowHeightMm ?? 0);
  const colWidthsMm = list.columns.map(column => column.widthMm);
  const layout = resolveGridLayout({ ...list.headerGrid, colWidthsMm }, colWidthsMm.reduce((sum, width) => sum + width, 0), rowHeightsMm.length);
  const styles = new WeakMap<GridCell, ComponentStyle>();
  for (const { cell, ci, ri, widthMm } of layout.cells) {
    const style = { ...resolveListHeaderStyle(list, list.columns[ci]!), ...cell.style };
    const fontSizePt = resolveFontSize(style).fontSizePt;
    const lines = wrapText(cell.text ?? "", Math.max(1, widthMm - padding * 2), { fontSizePt, fontFamily: style.fontFamily, bold: style.bold, italic: style.italic, letterSpacingPt: style.letterSpacing }, measurer);
    const height = (lines.length * fontSizePt * (style.lineHeight ?? LINE_HEIGHT) * 25.4 / 72 + padding * 2) / (cell.rowSpan ?? 1);
    for (let index = ri; index < ri + (cell.rowSpan ?? 1); index++) rowHeightsMm[index] = Math.max(rowHeightsMm[index] ?? 0, height);
    styles.set(cell, style);
  }
  const cells = list.headerGrid.cells.map(row => row.map(cell => cell ? { ...cell, style: styles.get(cell) } : null));
  return { ...list.headerGrid, cells, rowHeightsMm };
}
