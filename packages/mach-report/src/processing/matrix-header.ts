import type { GridCell, PlanGrid } from "../schema/render-plan";
import type { MatrixColumnMember, MatrixHierarchyOptions } from "./matrix-model";
import type { MatrixTableOptions } from "./matrix";

function headerPart(member: MatrixColumnMember, depth: number, hierarchy: MatrixHierarchyOptions): { key: string; text: string; rowSpan: number } | undefined {
  if (member.kind !== "member" && depth > member.depth) return;
  if (member.kind === "total") return { key: "total", text: hierarchy.totalLabel ?? "合计", rowSpan: 0 };
  if (member.kind === "subtotal" && depth === member.depth) return { key: member.key, text: hierarchy.subtotalLabel ?? "小计", rowSpan: 0 };
  return { key: JSON.stringify(member.values.slice(0, depth + 1).map(value => [typeof value, value])), text: member.labels[depth]!, rowSpan: 1 };
}
/** Build true physical spans; no renderer-specific interpretation of slash-joined labels. */
export function matrixHeaderGrid(options: MatrixTableOptions, columns: MatrixColumnMember[]): PlanGrid {
  const rowCount = options.columnFields.length + 1, dimensionCount = options.rowFields.length;
  const cells: (GridCell | null)[][] = Array.from({ length: rowCount }, () => Array<GridCell | null>(dimensionCount + columns.length).fill(null));
  for (let row = 0; row < options.columnFields.length; row++) {
    let previous: { key: string; cell: GridCell } | undefined;
    columns.forEach((column, index) => {
      const part = headerPart(column, row, options.hierarchy!);
      if (!part) { previous = undefined; return; }
      if (previous?.key === part.key) { previous.cell.colSpan = (previous.cell.colSpan ?? 1) + 1; return; }
      const cell: GridCell = { text: part.text, rowSpan: part.rowSpan || options.columnFields.length - row, editable: false, derived: true };
      cells[row]![dimensionCount + index] = cell;
      previous = { key: part.key, cell };
    });
  }
  options.rowFields.forEach((field, index) => { cells[0]![index] = { text: options.hierarchy!.row?.labels?.[index] ?? field, rowSpan: rowCount, editable: false, derived: true }; });
  columns.forEach((column, index) => {
    const measure = options.measures[column.measure]!;
    cells[rowCount - 1]![dimensionCount + index] = { text: measure.label ?? `${measure.field} (${measure.op})`, editable: false, derived: true };
  });
  // PlanGrid rows are compact: covered physical slots must not become empty cells.
  return { cells: cells.map(row => row.filter((cell): cell is GridCell => cell !== null)),
    colWidthsMm: [...options.rowFields.map(() => options.rowWidthMm ?? 40), ...columns.map(() => options.columnWidthMm ?? 28)] };
}
