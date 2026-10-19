import type { GridCell, PlanGrid } from "../schema/render-plan";
import type { ListComponent } from "./paginate";
function projectGrid(
  grid: PlanGrid,
  visible: Set<number>,
  widths: number[],
): PlanGrid {
  const occupied = new Set<string>();
  const cells = grid.cells.map((row, rowIndex) => {
    const projected: (GridCell | null)[] = [];
    let column = 0;
    for (const cell of row) {
      while (occupied.has(`${rowIndex}:${column}`)) column++;
      const span = cell?.colSpan ?? 1,
        rowSpan = cell?.rowSpan ?? 1;
      let retained = 0;
      for (let c = column; c < column + span; c++) {
        if (visible.has(c)) retained++;
        for (let r = rowIndex + 1; r < rowIndex + rowSpan; r++)
          occupied.add(`${r}:${c}`);
      }
      if (retained)
        projected.push(cell ? { ...cell, colSpan: retained } : null);
      column += span;
    }
    return projected;
  });
  return { ...grid, cells, colWidthsMm: widths };
}
/** Hides physical columns and projects merged headers using the same geometry in every output. */
export function projectListColumns(list: ListComponent): ListComponent {
  if (!list.columns.some((column) => column.hidden)) return list;
  const visible = new Set<number>();
  const columns = list.columns.filter((column, index) => {
    if (column.hidden) return false;
    visible.add(index);
    return true;
  });
  if (!columns.length) throw new Error("列表至少需要一列可见列");
  return {
    ...list,
    columns,
    ...(list.headerGrid
      ? {
          headerGrid: projectGrid(
            list.headerGrid,
            visible,
            columns.map((column) => column.widthMm),
          ),
        }
      : {}),
  };
}
