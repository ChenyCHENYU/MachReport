import type { ListComponent } from "../layout/paginate";
import { resolveListSampleCell, resolveTreeListSampleCell } from "../layout/list-cell";
import type { GridCell } from "../schema/render-plan";
import { createTreeTable } from "../processing/tree";

/** Never display raw parent amounts as if they were checked rollups in a designer sample. */
export function designListSamples(list: ListComponent, rows: Record<string, unknown>[], count = 3): GridCell[][] {
  if (!list.tree) return rows.slice(0, count).map(row => list.columns.map(column => resolveListSampleCell(list, column, row)));
  if (rows.length > 200) return [];
  try {
    const tree = createTreeTable(rows, { ...list.tree, maxRows: Math.min(200, list.tree.maxRows ?? 200), maxAggregationVisits: Math.min(2000, list.tree.maxAggregationVisits ?? 2000) }, { computed: list.computed?.length ? { fields: list.computed, maxRows: 200, maxCells: 4096 } : undefined });
    return tree.entries.slice(0, count).map(entry => list.columns.map(column => resolveTreeListSampleCell(list, column, entry)));
  } catch { return []; }
}
