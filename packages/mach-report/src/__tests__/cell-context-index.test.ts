import { afterEach, expect, it, vi } from "vitest";
import { createReportCellIndex, getReportCellContext } from "../editing/context";
import * as geometry from "../render/grid-geometry";
import type { PlanComponent, RenderPlan } from "../schema/render-plan";
afterEach(() => vi.restoreAllMocks());
it("reuses one owned geometry for merged physical anchors, context lookup and mirrored page addresses", () => {
  const component: PlanComponent = { kind: "rect", leftMm: 0, topMm: 0, widthMm: 40, heightMm: 20, grid: { colWidthsMm: [10, 10, 10, 10], cells: [[{ text: "merged", colSpan: 2, rowSpan: 2 }, { text: "first" }, { text: "last" }], [{ text: "lower" }, { text: "end" }]] } };
  const plan: RenderPlan = { schemaVersion: "owned-index", pages: [0, 1].map(() => ({ pageWidthMm: 40, pageHeightMm: 20, components: [component] })) };
  const spy = vi.spyOn(geometry, "resolveGridLayout"), index = createReportCellIndex(plan);
  expect(index.resolve({ pageIndex: 0, componentIndex: 0, rowIndex: 1, columnIndex: 2 })?.value).toBe("lower");
  expect(index.layout(component)?.cells).toHaveLength(5);
  expect([...index.entries(1, 0)][0]?.address.pageIndex).toBe(1);
  expect(index.resolve({ pageIndex: 1, componentIndex: 0, rowIndex: 1, columnIndex: 1 })).toBeNull();
  expect(spy).toHaveBeenCalledTimes(1);
  for (const context of index.entries(1, 0)) expect(context).toEqual(getReportCellContext(plan, context.address));
});
it("keeps null slots and crossing row spans on the shared physical anchor rules", () => {
  const component: PlanComponent = { kind: "rect", leftMm: 0, topMm: 0, widthMm: 40, heightMm: 40,
    grid: { colWidthsMm: [10, 10, 10, 10], cells: [[{ text: "long", rowSpan: 4 }, null, { text: "edge" }], [{ text: "cross", colSpan: 2, rowSpan: 2 }, null], [{ text: "tail" }], [null, { text: "last" }]] } };
  const plan: RenderPlan = { schemaVersion: "anchors", pages: [{ pageWidthMm: 40, pageHeightMm: 40, components: [component] }] }, index = createReportCellIndex(plan);
  for (let rowIndex = 0; rowIndex < 4; rowIndex++) for (let columnIndex = 0; columnIndex < 4; columnIndex++) {
    const address = { pageIndex: 0, componentIndex: 0, rowIndex, columnIndex };
    expect(index.resolve(address)).toEqual(getReportCellContext(plan, address));
  }
  expect([...index.entries(0, 0)].map(context => context.value)).not.toContain(null);
});
