import type { GridCell, PlanComponent, PlanGrid, RenderPlan } from "../../schema/render-plan";
import { isImageBackedComponent, isRichText } from "../../schema/render-plan";

export interface PlanTextTarget { componentIndex: number; rowIndex?: number; columnIndex?: number }
interface TextWork { value: string | PlanComponent; target: PlanTextTarget }
const SHAPE_KINDS = new Set(["line", "rect", "ellipse", "chart"]);

/** Stream physical anchors without constructing an entire grid layout during a search slice. */
function* gridCells(grid: PlanGrid): Generator<{ cell: GridCell | null | undefined; rowIndex: number; columnIndex: number }> {
  const columns = grid.colWidthsMm?.length ?? grid.cells.reduce((count, row) => Math.max(count, row?.length ?? 0), 1);
  const occupiedUntil = new Map<number, number>();
  for (const [rowIndex, row] of grid.cells.entries()) {
    let columnIndex = 0;
    for (const cell of row ?? []) {
      while (columnIndex < columns && (occupiedUntil.get(columnIndex) ?? 0) > rowIndex) columnIndex++;
      if (columnIndex >= columns) break;
      const span = Math.max(1, Math.min(cell?.colSpan ?? 1, columns - columnIndex));
      if ((cell?.rowSpan ?? 1) > 1) for (let column = columnIndex; column < columnIndex + span; column++) occupiedUntil.set(column, Math.max(occupiedUntil.get(column) ?? 0, rowIndex + cell!.rowSpan!));
      yield { cell, rowIndex, columnIndex };
      columnIndex += span;
    }
  }
}
function* richTextContent(paragraphs: NonNullable<PlanComponent["richParagraphs"]>): Generator<string> {
  for (const paragraph of paragraphs) for (const segment of paragraph.segments ?? []) yield (segment.kind === "field" ? segment.field : segment.text) ?? "";
}
function* gridContent(grid: PlanGrid, parent: PlanTextTarget): Generator<TextWork> {
  for (const { cell, rowIndex, columnIndex } of gridCells(grid)) {
    const target = parent.rowIndex === undefined ? { ...parent, rowIndex, columnIndex } : parent;
    const texts = cell?.richParagraphs?.length ? richTextContent(cell.richParagraphs) : [cell?.text ?? ""];
    for (const value of texts) yield { value, target };
    for (const value of cell?.children ?? []) yield { value, target };
  }
}
function* textContent(comp: PlanComponent): Generator<string> {
  if (isRichText(comp)) yield* richTextContent(comp.richParagraphs!);
  else if (comp.lines?.length) yield* comp.lines;
  else yield comp.text ?? "";
}
function* componentWork(components: PlanComponent[]): Generator<TextWork> {
  for (const [componentIndex, value] of components.entries()) yield { value, target: { componentIndex } };
}
function* textWork(comp: PlanComponent, target: PlanTextTarget): Generator<TextWork> {
  for (const value of textContent(comp)) yield { value, target };
}

/** Match the DOM branch/text-node order, retaining a real cell anchor for clipped search results. */
function* componentTexts(components: PlanComponent[]): Generator<{ text: string; target: PlanTextTarget }> {
  const stack: Iterator<TextWork>[] = [componentWork(components)];
  while (stack.length > 0) {
    const next = stack[stack.length - 1]!.next();
    if (next.done) { stack.pop(); continue; }
    const { value, target } = next.value;
    if (typeof value === "string") { yield { text: value, target }; continue; }
    yield { text: "", target };
    if (isImageBackedComponent(value)) continue;
    if (value.kind === "text") stack.push(textWork(value, target));
    else if (value.grid) stack.push(gridContent(value.grid, target));
    else if (!SHAPE_KINDS.has(value.kind)) yield { text: value.fallbackText ?? "", target };
  }
}

/** The scan also yields sparse pages, preserving cancellation with bounded search slices. */
export function* pageTexts(plan: RenderPlan, start = 0, end = plan.pages.length): Generator<{ text: string; pageIndex: number; target?: PlanTextTarget }> {
  for (let pageIndex = start; pageIndex < end; pageIndex++) {
    for (const item of componentTexts(plan.pages[pageIndex]!.components)) yield { ...item, pageIndex };
    yield { text: "", pageIndex };
  }
}
