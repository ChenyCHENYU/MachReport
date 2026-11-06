import { expect, it } from "vitest";
import type { PlanGrid, RenderPlan } from "../../schema/render-plan";
import { resolveGridLayout } from "../../render/grid-geometry";
import { pageTexts } from "../composables/plan-texts";
function source(grid: PlanGrid): RenderPlan {
  return { schemaVersion: "search-anchor", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [{ kind: "rect", leftMm: 0, topMm: 0, widthMm: 100, heightMm: 100, grid }] }] };
}
it.each([false, true])("streamed search anchors match geometry with overlapping spans, nulls and explicit widths=%s", explicit => {
  const grid = { cells: [
    [{ text: "base0" }, { text: "long", rowSpan: 4 }, { text: "base2" }, { text: "base3" }],
    [{ text: "overlap", rowSpan: 2, colSpan: 2 }, { text: "r1c2" }, { text: "r1c3" }],
    [{ text: "r2c2" }, { text: "r2c3" }],
    [null, { text: "r3c2" }, { text: "r3c3" }]
  ], ...(explicit ? { colWidthsMm: [25, 25, 25, 25] } : {}) } as PlanGrid;
  const expected = resolveGridLayout(grid, 100, 100).cells.filter(box => box.cell.text).map(box => [box.cell.text, box.ri, box.ci]);
  const actual = [...pageTexts(source(grid))].filter(item => item.text).map(item => [item.text, item.target?.rowIndex, item.target?.columnIndex]);
  expect(actual).toEqual(expected); expect(actual).toContainEqual(["r3c2", 3, 2]);
});
it("infers columns for a large sparse grid without spreading rows into the call stack", () => {
  const grid: PlanGrid = { cells: Array.from({ length: 140000 }, () => []) }; grid.cells[139999] = [{ text: "last" }];
  const matches = [...pageTexts(source(grid))].filter(item => item.text);
  expect(matches).toHaveLength(1); expect(matches[0]?.target).toMatchObject({ rowIndex: 139999, columnIndex: 0 });
});
