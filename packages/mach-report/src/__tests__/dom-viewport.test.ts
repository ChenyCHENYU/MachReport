import { describe, expect, it } from "vitest";
import { createPageViewportRenderer, renderPage } from "../render/dom";
import { resolveGridLayout } from "../render/grid-geometry";
import { createGridViewportIndex, checkedViewport } from "../render/viewport-index";
import type { PlanPage } from "../schema/render-plan";
function page(): PlanPage {
  return { layout: "wide", pageWidthMm: 2000, pageHeightMm: 1000, components: [{ kind: "rect", leftMm: 10, topMm: 10, widthMm: 2000, heightMm: 1000,
    grid: { colWidthsMm: Array(200).fill(10), rowHeightsMm: Array(100).fill(10), cells: Array.from({ length: 100 }, (_, row) => Array.from({ length: 200 }, (_, column) => ({ text: `${row}:${column}` }))) } }] };
}
describe("two-dimensional preview window", () => {
  it("renders only nearby cells and edges without changing complete output or source geometry", () => {
    const input = page(), before = JSON.stringify(input), view = createPageViewportRenderer(input, 96, {}, document);
    expect(view.update({ leftMm: 0, topMm: 0, widthMm: 60, heightMm: 60 })).toBe(true);
    expect(view.element.querySelectorAll("td").length).toBeLessThan(100);
    expect(view.element.querySelectorAll(".mr-grid-edge").length).toBeLessThan(40);
    expect(view.element.querySelector("table")?.getAttribute("aria-colcount")).toBe("200");
    expect(view.element.textContent).toContain("0:0"); expect(view.element.textContent).not.toContain("99:199");
    view.update({ leftMm: 1940, topMm: 940, widthMm: 60, heightMm: 60 });
    expect(view.element.textContent).toContain("99:199"); expect(view.element.querySelectorAll("td").length).toBeLessThan(150);
    expect(JSON.stringify(input)).toBe(before);
    expect(renderPage(input, 96, {}, document).querySelectorAll("td")).toHaveLength(20000);
  });
  it("keeps visible cells and a pinned offscreen editor while maintaining logical DOM order", () => {
    const view = createPageViewportRenderer(page(), 96, {}, document);
    document.body.append(view.element);
    try {
      const window = { leftMm: 100, topMm: 100, widthMm: 60, heightMm: 60 };
      view.update(window);
      const cell = view.element.querySelector<HTMLElement>('td[data-mr-row-index="10"][data-mr-column-index="10"]')!;
      const input = document.createElement("input"); cell.append(input); input.focus();
      expect(view.update(window)).toBe(false);
      view.update({ ...window, leftMm: 105 });
      expect(document.activeElement).toBe(input);
      view.update({ ...window, leftMm: 1500 }, { componentIndex: 0, rowIndex: 10, columnIndex: 10 });
      expect(document.activeElement).toBe(input); expect(cell.isConnected).toBe(true);
      const columns = [...cell.parentElement!.children].map(element => Number((element as HTMLElement).dataset.mrColumnIndex));
      expect(columns).toEqual([...columns].sort((a, b) => a - b));
    } finally { view.element.remove(); }
  });

  it("updates edge visibility when a giant merged cell remains the same and uses complete geometry for rotated grids", () => {
    const merged: PlanPage = { pageWidthMm: 1000, pageHeightMm: 1000, components: [{ kind: "rect", leftMm: 0, topMm: 0, widthMm: 1000, heightMm: 1000, grid: { cells: [[{ text: "merged", style: { borderTop: true, borderLeft: true } }]] } }] };
    const view = createPageViewportRenderer(merged, 96, {}, document);
    view.update({ leftMm: 400, topMm: 400, widthMm: 20, heightMm: 20 });
    expect(view.element.querySelectorAll(".mr-grid-edge")).toHaveLength(0);
    expect(view.update({ leftMm: 0, topMm: 0, widthMm: 20, heightMm: 20 })).toBe(true);
    expect(view.element.querySelectorAll(".mr-grid-edge").length).toBeGreaterThan(0);
    const rotated = page(); rotated.components[0]!.style = { rotateDeg: 30 };
    const complete = createPageViewportRenderer(rotated, 96, {}, document);
    complete.update({ leftMm: 0, topMm: 0, widthMm: 20, heightMm: 20 });
    expect(complete.element.querySelectorAll("td")).toHaveLength(20000);
  });
  it("includes merged anchors outside both window axes and rejects invalid windows", () => {
    const layout = resolveGridLayout({ cells: [[{ text: "merged", colSpan: 3, rowSpan: 3 }], [], [], [{ text: "end" }]], colWidthsMm: [10, 10, 10], rowHeightsMm: [10, 10, 10, 10] }, 30, 40);
    const index = createGridViewportIndex(layout);
    expect(index.cells({ leftMm: 24, topMm: 24, widthMm: 1, heightMm: 1 }).map(box => box.cell.text)).toEqual(["merged"]);
    expect(index.cells({ leftMm: 100, topMm: 100, widthMm: 1, heightMm: 1 })).toEqual([]);
    expect(() => checkedViewport({ leftMm: NaN, topMm: 0, widthMm: 10, heightMm: 10 })).toThrow(RangeError);
    expect(() => checkedViewport({ leftMm: 0, topMm: 0, widthMm: -1, heightMm: 10 })).toThrow(RangeError);
  });
});
