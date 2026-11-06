import type { PlanComponent, PlanGrid } from "../schema/render-plan";
import { resolveGridLayout, type GridCellBox, type GridLayout } from "./grid-geometry";
import { resolveGridStrokes, type GridStroke } from "./grid-strokes";
import { createGridViewportIndex, createGridStrokeViewportIndex, checkedViewport, type ReportViewport } from "./viewport-index";

export interface ViewportGridMount {
  grid: PlanGrid;
  component: PlanComponent;
  table: HTMLTableElement;
  rowClass: string;
  body: HTMLElement;
  drawCell(box: GridCellBox): HTMLElement;
  reuseKey?(box: GridCellBox): string | undefined;
  reuseCell?(cell: HTMLElement, box: GridCellBox): boolean;
  drawEdges(strokes: GridStroke[]): HTMLElement[];
  edgeHost: HTMLElement;
}
export interface PreviewFrozenPanes { frozenColumns?: number; freezeHeaders?: boolean }
interface MountedGrid { component: PlanComponent; update(viewport: ReportViewport, retained?: { rowIndex: number; columnIndex: number }, frozen?: PreviewFrozenPanes): boolean }

/** Per-page lifetime: no global geometry, DOM or business-value cache. */
export function createDomViewportContext() {
  const grids: MountedGrid[] = [];
  return {
    mount(input: ViewportGridMount): void { grids.push(mountGrid(input)); },
    update(viewport: ReportViewport, component?: PlanComponent, retained?: { rowIndex: number; columnIndex: number }, frozen?: PreviewFrozenPanes): boolean {
      checkedViewport(viewport);
      let changed = false;
      for (const grid of grids) changed = grid.update(viewport, grid.component === component ? retained : undefined, frozen) || changed;
      return changed;
    }
  };
}
function localViewport(viewport: ReportViewport, component: PlanComponent): ReportViewport {
  // One extra screen quarter avoids churn at every pixel of horizontal/vertical scrolling.
  const padX = Math.max(8, viewport.widthMm / 4), padY = Math.max(8, viewport.heightMm / 4);
  return { leftMm: viewport.leftMm - component.leftMm - padX, topMm: viewport.topMm - component.topMm - padY,
    widthMm: viewport.widthMm + 2 * padX, heightMm: viewport.heightMm + 2 * padY };
}
function rowElement(input: ViewportGridMount, rows: Map<number, HTMLTableRowElement>, index: number): HTMLTableRowElement {
  let row = rows.get(index);
  if (!row) {
    row = input.table.ownerDocument.createElement("tr"); row.className = input.rowClass; row.setAttribute("role", "row");
    row.setAttribute("aria-rowindex", String(index + 1)); row.style.cssText = "all:unset;display:contents;box-sizing:border-box";
    rows.set(index, row);
  }
  return row;
}
function reconcileCells(input: ViewportGridMount, boxes: GridCellBox[], cells: Map<GridCellBox, HTMLElement>, rows: Map<number, HTMLTableRowElement>): void {
  const selected = new Set(boxes), rowIds = new Set(boxes.map(box => box.ri));
  const recycled = new Map<string, HTMLElement[]>();
  for (const [box, cell] of cells) if (!selected.has(box)) {
    cell.remove(); cells.delete(box);
    const key = input.reuseKey?.(box);
    if (key !== undefined) { const pool = recycled.get(key) ?? []; pool.push(cell); recycled.set(key, pool); }
  }
  for (const [index, row] of rows) if (!rowIds.has(index)) { row.remove(); rows.delete(index); }
  for (const box of boxes) {
    let cell = cells.get(box);
    if (!cell) {
      const key = input.reuseKey?.(box), previous = key === undefined ? undefined : recycled.get(key)?.pop();
      cell = previous && input.reuseCell?.(previous, box) ? previous : input.drawCell(box);
      cell.setAttribute("aria-colindex", String(box.ci + 1)); cells.set(box, cell);
    }
    const row = rowElement(input, rows, box.ri);
    // appendChild preserves the node, editor and listeners when a cell remains visible.
    if (cell.parentElement !== row) row.appendChild(cell);
  }
  const rowCells = new Map<number, HTMLElement[]>();
  for (const box of boxes) { const list = rowCells.get(box.ri) ?? []; list.push(cells.get(box)!); rowCells.set(box.ri, list); }
  for (const [index, list] of rowCells) orderChildren(rows.get(index)!, list);
  orderChildren(input.body, [...rowIds].sort((a, b) => a - b).map(index => rows.get(index)!));
}
function orderChildren(parent: HTMLElement, elements: HTMLElement[]): void {
  let next = parent.firstElementChild;
  for (const element of elements) {
    if (element === next) next = next.nextElementSibling;
    else parent.insertBefore(element, next);
  }
}
function headerHeight(component: PlanComponent, layout: GridLayout): number {
  return component.table?.role === "header" ? component.heightMm : layout.rows[0]?.size ?? 0;
}
function frozenWindows(window: ReportViewport, layout: GridLayout, component: PlanComponent, panes: PreviewFrozenPanes): ReportViewport[] {
  const windows = [window];
  const header = panes.freezeHeaders && (component.table?.role === "header" || !component.table);
  const top = headerHeight(component, layout);
  if (header) windows.push({ ...window, topMm: 0, heightMm: Math.max(0, top - 0.0001) });
  const count = Math.max(0, Math.min(20, Math.floor(panes.frozenColumns ?? 0))) || 0;
  if (!count || !layout.columns.length) return windows;
  const last = layout.columns[Math.min(count, layout.columns.length) - 1]!;
  const left = { ...window, leftMm: 0, widthMm: Math.max(0, last.pos + last.size - 0.0001) };
  windows.push(left);
  if (header) windows.push({ ...left, topMm: 0, heightMm: Math.max(0, top - 0.0001) });
  return windows;
}
function mountGrid(input: ViewportGridMount): MountedGrid {
  const layout = resolveGridLayout(input.grid, input.component.widthMm, input.component.heightMm);
  const byAddress = new Map(layout.cells.map(box => [`${box.ri}:${box.ci}`, box]));
  const index = createGridViewportIndex(layout), cells = new Map<GridCellBox, HTMLElement>(), rows = new Map<number, HTMLTableRowElement>();
  const edges = createGridStrokeViewportIndex(resolveGridStrokes(layout, input.component));
  input.table.setAttribute("aria-rowcount", String(layout.rows.length)); input.table.setAttribute("aria-colcount", String(layout.columns.length));
  let previous = "", previousEdges = "";
  function visibleBoxes(window: ReportViewport, frozen?: PreviewFrozenPanes): GridCellBox[] {
    const boxes = new Set<GridCellBox>();
    for (const area of frozenWindows(window, layout, input.component, frozen ?? {})) for (const box of index.cells(area)) boxes.add(box);
    return [...boxes];
  }
  return { component: input.component, update(viewport, retained, frozen) {
    const window = localViewport(viewport, input.component);
    const boxes = visibleBoxes(window, frozen), pinned = retained && byAddress.get(`${retained.rowIndex}:${retained.columnIndex}`);
    if (pinned && !boxes.includes(pinned)) boxes.push(pinned);
    boxes.sort((a, b) => a.ri - b.ri || a.ci - b.ci);
    const key = boxes.map(box => `${box.ri}:${box.ci}`).join(";");
    const visibleEdges = edges(window), edgeKey = visibleEdges.map(edge => `${edge.kind}:${edge.pos}:${edge.from}:${edge.to}`).join(";");
    const changed = key !== previous, edgesChanged = edgeKey !== previousEdges;
    if (changed) { previous = key; reconcileCells(input, boxes, cells, rows); }
    if (edgesChanged) { previousEdges = edgeKey; input.edgeHost.replaceChildren(...input.drawEdges(visibleEdges)); }
    return changed || edgesChanged;
  } };
}
