// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { reactive, ref } from "vue";
import * as geometry from "../../render/grid-geometry";
import type { ListComponent } from "../../layout/paginate";
import type { PlanComponent } from "../../schema/render-plan";
import { createCanvasGridLayouts } from "../canvas-grid-layouts";

describe("cached design grid geometry", () => {
  it("resolves a large grid once across selection/zoom reads and keeps the DOM cell budget", () => {
    const component = reactive<PlanComponent>({ kind: "rect", leftMm: 0, topMm: 0, widthMm: 820, heightMm: 2928,
      grid: { colWidthsMm: Array(82).fill(10), rowHeightsMm: Array(732).fill(4), cells: Array.from({ length: 732 }, () => Array.from({ length: 82 }, () => ({ text: "1" }))) } });
    const layouts = createCanvasGridLayouts(), selected = ref(false), zoom = ref(1);
    const resolve = vi.spyOn(geometry, "resolveGridLayout");
    try {
      const first = layouts.read(component);
      for (let index = 0; index < 100; index++) {
        selected.value = !selected.value; zoom.value += .01;
        expect(layouts.read(component)).toBe(first);
      }
      expect(resolve).toHaveBeenCalledTimes(1);
      expect(first.cells).toHaveLength(2000);
      expect(first.limited).toBe(true);
    } finally { resolve.mockRestore(); }
  });

  it("tracks in-place size, span, axis and grid replacement while retaining live cell text/style", () => {
    const component = reactive<PlanComponent>({ kind: "rect", leftMm: 0, topMm: 0, widthMm: 100, heightMm: 20,
      grid: { colWidthsMm: [1, 1], cells: [[{ text: "A" }, { text: "B" }]] } });
    const layouts = createCanvasGridLayouts(), first = layouts.read(component);
    component.grid!.cells[0]![0]!.text = "Updated";
    component.grid!.cells[0]![0]!.style = { color: "#123456" };
    expect(layouts.read(component)).toBe(first);
    expect(first.cells[0]!.cell).toMatchObject({ text: "Updated", style: { color: "#123456" } });
    component.widthMm = 200;
    expect(layouts.read(component).cells[0]!.widthMm).toBe(100);
    component.grid!.colWidthsMm![0] = 3;
    expect(layouts.read(component).cells[0]!.widthMm).toBe(150);
    component.grid!.cells[0]![0]!.colSpan = 2;
    expect(layouts.read(component).cells).toHaveLength(1);
    expect(layouts.read(component).cells[0]!.widthMm).toBe(200);
    component.grid = { cells: [[{ text: "Replacement" }]] };
    component.heightMm = 30;
    expect(layouts.read(component).cells[0]).toMatchObject({ heightMm: 30, cell: { text: "Replacement" } });
  });

  it("invalidates header geometry for changed rows and keeps components independent", () => {
    const list = reactive<ListComponent>({ kind: "list", leftMm: 0, topMm: 0, widthMm: 100, dataset: "detail", columns: [{ header: "A", field: "a", widthMm: 100 }], headerGrid: { rowHeightsMm: [8], cells: [[{ text: "Header" }]] } });
    const other = reactive<PlanComponent>({ kind: "rect", leftMm: 0, topMm: 0, widthMm: 10, heightMm: 10, grid: { cells: [[{ text: "Other" }]] } });
    const layouts = createCanvasGridLayouts(), initialOther = layouts.read(other);
    expect(layouts.read(list).cells[0]!.heightMm).toBe(8);
    list.headerGrid!.rowHeightsMm![0] = 12;
    expect(layouts.read(list).cells[0]!.heightMm).toBe(12);
    expect(layouts.read(other)).toBe(initialOther);
    delete list.headerGrid;
    expect(layouts.read(list)).toEqual({ cells: [], limited: false });
  });
});
