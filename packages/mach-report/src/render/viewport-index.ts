import type { GridCellBox, GridLayout } from "./grid-geometry";
import type { GridStroke } from "./grid-strokes";

/** Preview coordinates only. Output plans and their complete geometry remain unchanged. */
export interface ReportViewport { leftMm: number; topMm: number; widthMm: number; heightMm: number }

function firstAfter<T>(items: readonly T[], value: number, end: (item: T) => number): number {
  let low = 0, high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (end(items[middle]!) < value) low = middle + 1;
    else high = middle;
  }
  return low;
}
export function checkedViewport(viewport: ReportViewport): ReportViewport {
  if (![viewport.leftMm, viewport.topMm, viewport.widthMm, viewport.heightMm].every(Number.isFinite) || viewport.widthMm < 0 || viewport.heightMm < 0) throw new RangeError("Preview viewport must have finite coordinates and nonnegative dimensions.");
  return viewport;
}

/** Build once for an owned page renderer. Merged anchors are indexed in every intersected row. */
export function createGridViewportIndex(layout: GridLayout) {
  const rows: GridCellBox[][] = layout.rows.map(() => []);
  for (const box of layout.cells) {
    const bottom = Math.min(rows.length, box.ri + (box.cell.rowSpan ?? 1));
    for (let row = box.ri; row < bottom; row++) rows[row]!.push(box);
  }
  for (const row of rows) row.sort((a, b) => a.xMm - b.xMm);
  return {
    cells(viewport: ReportViewport): GridCellBox[] {
      checkedViewport(viewport);
      const found = new Set<GridCellBox>();
      const bottom = viewport.topMm + viewport.heightMm, right = viewport.leftMm + viewport.widthMm;
      let rowIndex = firstAfter(layout.rows, viewport.topMm, axis => axis.pos + axis.size);
      while (rowIndex < rows.length && layout.rows[rowIndex]!.pos <= bottom) {
        const row = rows[rowIndex++]!;
        let column = firstAfter(row, viewport.leftMm, box => box.xMm + box.widthMm);
        while (column < row.length && row[column]!.xMm <= right) found.add(row[column++]!);
      }
      return [...found].sort((a, b) => a.ri - b.ri || a.ci - b.ci);
    }
  };
}

/** Position-sorted edges avoid walking every offscreen border during scrolling. */
export function createGridStrokeViewportIndex(strokes: readonly GridStroke[]) {
  const axes = ["h", "v"].map(kind => strokes.filter(edge => edge.kind === kind).sort((a, b) => a.pos - b.pos));
  return (viewport: ReportViewport): GridStroke[] => {
    const result: GridStroke[] = [];
    axes.forEach((edges, axis) => {
      const low = axis === 0 ? viewport.topMm : viewport.leftMm;
      const high = low + (axis === 0 ? viewport.heightMm : viewport.widthMm);
      const from = axis === 0 ? viewport.leftMm : viewport.topMm;
      const to = from + (axis === 0 ? viewport.widthMm : viewport.heightMm);
      let cursor = firstAfter(edges, low, edge => edge.pos);
      while (cursor < edges.length && edges[cursor]!.pos <= high) {
        const edge = edges[cursor++]!;
        if (edge.to >= from && edge.from <= to) result.push(edge);
      }
    });
    return result;
  };
}
