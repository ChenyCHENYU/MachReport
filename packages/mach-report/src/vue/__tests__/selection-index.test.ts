import { afterEach, expect, it, vi } from "vitest";
import type { PlanComponent, RenderPlan, ReportCellAddress } from "../../index";
import * as geometry from "../../render/grid-geometry";
import { createSelectionIndex } from "../composables/selection-index";

const origin: ReportCellAddress = { pageIndex: 0, componentIndex: 0, rowIndex: 0, columnIndex: 0 };
function plan(): RenderPlan {
  const component: PlanComponent = { kind: "rect", leftMm: 0, topMm: 0, widthMm: 600, heightMm: 1000,
    grid: { cells: Array.from({ length: 100 }, (_, row) => Array.from({ length: 60 }, (_, column) => ({ text: `${row}:${column}`, source: { datasetId: "detail", rowKey: row, field: `c${column}` } }))) } };
  return { schemaVersion: "selection-index", pages: [{ pageWidthMm: 600, pageHeightMm: 1000, components: [component] }] };
}
afterEach(() => vi.restoreAllMocks());
it("builds navigation geometry once per owned publication and reuses direct row/column positions", () => {
  const spy = vi.spyOn(geometry, "resolveGridLayout");
  const source = plan(), index = createSelectionIndex(source);
  let target = origin;
  for (let step = 0; step < 40; step++) target = index.adjacent(target, "ArrowRight", false)!;
  expect(target).toEqual({ ...origin, columnIndex: 40 });
  for (let step = 0; step < 90; step++) target = index.adjacent(target, "ArrowDown", false)!;
  expect(target).toEqual({ ...origin, rowIndex: 90, columnIndex: 40 });
  expect(index.adjacent(target, "Tab", true)).toEqual({ ...target, columnIndex: 39 });
  expect(spy).toHaveBeenCalledTimes(1);
  expect(index.addresses(origin)).toBe(index.addresses(origin));
  createSelectionIndex(source).addresses(origin); expect(spy).toHaveBeenCalledTimes(2);
});
it("caches field locations by source identity and preserves separate addresses for reused components", () => {
  const source = plan(); source.pages.push({ ...source.pages[0]!, meta: { reportScope: "second" } });
  const index = createSelectionIndex(source), target = { field: "c59", rowKey: 99, datasetId: "detail" };
  const found = index.findField(target); expect(found).toEqual({ ...origin, rowIndex: 99, columnIndex: 59 });
  const spy = vi.spyOn(geometry, "resolveGridLayout");
  expect(index.findField(target)).toBe(found); expect(spy).not.toHaveBeenCalled();
  expect(index.findField({ ...target, reportScope: "second" })).toEqual({ ...found!, pageIndex: 1 });
  expect(index.adjacent({ ...origin, pageIndex: 1 }, "ArrowRight", false)?.pageIndex).toBe(1);
  expect(index.findField({ field: "missing" })).toBeNull();
});
it("keeps merged anchors and original keyboard direction semantics", () => {
  const source = plan(); source.pages[0]!.components[0]!.grid = { colWidthsMm: [20, 20, 20], cells: [[{ text: "merged", colSpan: 2 }, { text: "right" }], [{ text: "lower" }, { text: "middle" }, { text: "end" }]] };
  const index = createSelectionIndex(source);
  expect(index.adjacent(origin, "ArrowRight", false)).toEqual({ ...origin, columnIndex: 2 });
  expect(index.adjacent({ ...origin, columnIndex: 2 }, "ArrowLeft", true)).toEqual(origin);
  expect(index.adjacent({ ...origin, rowIndex: 1 }, "ArrowUp", true)).toEqual(origin);
});
