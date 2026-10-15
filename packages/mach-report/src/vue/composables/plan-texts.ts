import type { PlanComponent, PlanGrid, RenderPlan } from "../../schema/render-plan";
import { isImageBackedComponent, isRichText } from "../../schema/render-plan";

type TextWork = string | PlanComponent;
const SHAPE_KINDS = new Set(["line", "rect", "ellipse", "chart"]);

function* gridContent(grid: PlanGrid): Generator<TextWork> {
  for (const row of grid.cells ?? []) {
    for (const cell of row ?? []) {
      yield cell?.text ?? "";
      yield* cell?.children ?? [];
    }
  }
}

function* textContent(comp: PlanComponent): Generator<string> {
  if (isRichText(comp)) {
    for (const paragraph of comp.richParagraphs!) {
      for (const segment of paragraph.segments ?? []) {
        yield (segment.kind === "field" ? segment.field : segment.text) ?? "";
      }
    }
  } else if (comp.lines?.length) {
    yield* comp.lines;
  } else {
    yield comp.text ?? "";
  }
}

/** Match renderComponent's branch order and DOM text-node order without recursive calls. */
function* componentTexts(components: PlanComponent[]): Generator<string> {
  const stack: Iterator<TextWork>[] = [components.values()];
  while (stack.length > 0) {
    const next = stack[stack.length - 1]!.next();
    if (next.done) {
      stack.pop();
      continue;
    }
    const item = next.value;
    if (typeof item === "string") {
      yield item;
      continue;
    }
    // A non-text component still consumes one unit of the incremental search budget.
    yield "";
    if (isImageBackedComponent(item)) continue;
    if (item.kind === "text") stack.push(textContent(item));
    else if (item.grid) stack.push(gridContent(item.grid));
    else if (!SHAPE_KINDS.has(item.kind)) yield item.fallbackText ?? "";
  }
}

/** The scan can yield even for empty pages, keeping sparse plans cancellable. */
export function* pageTexts(plan: RenderPlan): Generator<{ text: string; pageIndex: number }> {
  for (let pageIndex = 0; pageIndex < plan.pages.length; pageIndex++) {
    for (const text of componentTexts(plan.pages[pageIndex]!.components)) yield { text, pageIndex };
    yield { text: "", pageIndex };
  }
}
