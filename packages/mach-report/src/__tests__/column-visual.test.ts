// @vitest-environment node
import { createReportEditSession } from "../editing/session";
import { createReportCellEditBatch } from "../editing/batch";
import { describe, expect, it } from "vitest";
import { createColumnVisualResolvers, validColumnVisual } from "../layout/column-visual";
import { createTableTemplate } from "../builder/table-template";
import { paginateTemplate } from "../layout/paginate";
import { templateRequiresRecalculation } from "../layout/template-calculations";
import { dataBarBox } from "../render/data-bar";
import type { GridCell } from "../schema/render-plan";
const rows = [{ id: "A", qty: -10 }, { id: "B", qty: 0 }, { id: "C", qty: 20 }, { id: "D", qty: null }];
describe("value-preserving column visualization", () => {
  it("uses one domain across pages, retains zero/missing values and preserves business edit identities", () => {
    const template = createTableTemplate({ dataset: "data", columns: [{ field: "id", header: "ID" }, { field: "qty", header: "QTY", visual: { kind: "dataBar" } }], listOptions: { rowKey: "id" } });
    const { plan } = paginateTemplate(template, { data: rows });
    const cells = plan.pages.flatMap(page => page.components).filter(component => component.table?.role === "body").map(component => component.grid!.cells[0]![1]!);
    expect(cells.map(cell => cell.value)).toEqual([-10, 0, 20, null]);
    expect(cells[0]!.dataBar).toEqual({ start: 0, end: 1 / 3, color: "#f3bcc3" });
    expect(cells[1]!.dataBar).toEqual({ start: 1 / 3, end: 1 / 3, color: "#bad8fa" });
    expect(cells[2]!.dataBar).toEqual({ start: 1 / 3, end: 1, color: "#bad8fa" }); expect(cells[3]!.dataBar).toBeUndefined();
    expect(cells[0]!.derived).toBeUndefined(); expect(cells[0]!.editable).not.toBe(false); expect(plan.pages.flatMap(page => page.components).find(component => component.table?.role === "body")?.table?.source?.rowKey).toBe("A");
    expect(templateRequiresRecalculation(template)).toBe(true);
  });
  it("never guesses numeric identifiers, permits explicit decimal metrics and handles constant/extreme ranges", () => {
    const column = { field: "value", header: "V", widthMm: 20, visual: { kind: "colorScale" as const, lowColor: "#000000", highColor: "#ffffff" } };
    const resolver = createColumnVisualResolvers([column], [{ value: -Number.MAX_VALUE }, { value: Number.MAX_VALUE }])[0]!;
    const middle: GridCell = { text: "0" }; resolver.apply(middle, { value: 0 }); expect(middle.style?.backgroundColor).toBe("#808080");
    const text: GridCell = { text: "0001" }; resolver.apply(text, { value: "0001" }); expect(text.style).toBeUndefined();
    const decimal = createColumnVisualResolvers([{ ...column, visual: { ...column.visual, numeric: "decimal" } }], [{ value: "1.25" }, { value: "2.5" }])[0]!;
    decimal.apply(text, { value: "1.25" }); expect(text.style?.backgroundColor).toBe("#000000");
    const constant = createColumnVisualResolvers([column], [{ value: 5 }, { value: 5 }])[0]!; const cell: GridCell = {}; constant.apply(cell, { value: 5 }); expect(cell.style?.backgroundColor).toBe("#808080");
    const bounded = createColumnVisualResolvers([{ ...column, visual: { ...column.visual, min: 100 } }], [{ value: 5 }])[0]!; bounded.apply(cell, { value: 5 }); expect(cell.style?.backgroundColor).toBe("#000000");
  });
  it.each([[0, Number.MIN_VALUE], [-Number.MIN_VALUE, 0], [-Number.MIN_VALUE, Number.MIN_VALUE], [-Number.MAX_VALUE, Number.MAX_VALUE]])("keeps finite endpoint visuals for domain %s .. %s", (minimum, maximum) => {
    const input = [{ value: minimum }, { value: maximum }];
    const color = createColumnVisualResolvers([{ field: "value", header: "V", widthMm: 20, visual: { kind: "colorScale", lowColor: "#000000", highColor: "#ffffff" } }], input)[0]!;
    const low: GridCell = {}, high: GridCell = {};
    color.apply(low, input[0]!); color.apply(high, input[1]!);
    expect(low.style?.backgroundColor).toBe("#000000"); expect(high.style?.backgroundColor).toBe("#ffffff");
    const bars = createColumnVisualResolvers([{ field: "value", header: "V", widthMm: 20, visual: { kind: "dataBar" } }], input)[0]!;
    for (const row of input) {
      const cell: GridCell = {}; bars.apply(cell, row);
      expect(Number.isFinite(cell.dataBar?.start)).toBe(true); expect(Number.isFinite(cell.dataBar?.end)).toBe(true);
      expect(cell.dataBar!.start).toBeGreaterThanOrEqual(0); expect(cell.dataBar!.end).toBeLessThanOrEqual(1);
    }
  });
  it("scans a metric once and shares resolved backgrounds instead of allocating per-cell styles", () => {
    let reads = 0; const input = Array.from({ length: 500 }, (_, index) => ({ get metric() { reads++; return index % 2; } }));
    const resolver = createColumnVisualResolvers([{ field: "label", header: "L", widthMm: 20, visual: { kind: "colorScale", field: "metric" } }], input)[0]!;
    expect(reads).toBe(500); const style = { align: "right" as const }, cells: GridCell[] = input.map(row => { const cell: GridCell = { style }; resolver.apply(cell, row); return cell; });
    expect(reads).toBe(1000); expect(cells[0]!.style).toBe(cells[2]!.style); expect(cells[1]!.style).toBe(cells[3]!.style); expect(style).toEqual({ align: "right" });
  });
  it("rebuilds every affected visual domain after atomic edits and undo", async () => {
    const template = createTableTemplate({ dataset: "data", columns: [{ field: "qty", header: "QTY", valueType: "number", visual: { kind: "dataBar" } }], listOptions: { rowKey: "id" } });
    const session = createReportEditSession({ template, datasets: { data: rows } }), initial = session.plan;
    const components = initial.pages[0]!.components, index = components.findIndex(component => component.table?.source?.rowKey === "C");
    const batch = createReportCellEditBatch(initial, [{ address: { pageIndex: 0, componentIndex: index, rowIndex: 0, columnIndex: 0 }, value: 40 }], "visual-edit");
    const prepared = await session.prepare(initial, batch);
    const firstBar = (plan: typeof initial) => plan.pages[0]!.components.find(component => component.table?.source?.rowKey === "A")!.grid!.cells[0]![0]!.dataBar!;
    expect(firstBar(initial).end).toBeCloseTo(1 / 3); expect(firstBar(prepared.plan).end).toBeCloseTo(1 / 5);
    const committed = prepared.commit();
    const undo = await session.prepareHistory(committed, batch.edits, "previousValue", "undo-visual");
    expect(firstBar(undo.prepared.commit()).end).toBeCloseTo(1 / 3); expect(rows[2]!.qty).toBe(20);
  });
  it("validates declarative ranges/colors and shares bounded geometry", () => {
    for (const visual of [{ kind: "unknown" }, { kind: "dataBar", min: 2, max: 1 }, { kind: "colorScale", lowColor: "url(evil)" }, { kind: "dataBar", field: " " }, { kind: "dataBar", numeric: "guess" }]) expect(validColumnVisual(visual)).toBe(false);
    expect(dataBarBox({ start: .25, end: .75, color: "#bad8fa" }, 42, 10, 1)).toEqual({ x: 11, y: 1, width: 20, height: 8, color: "#bad8fa" });
    expect(dataBarBox({ start: .5, end: .5, color: "#bad8fa" }, 42, 10, 1)).toBeUndefined();
    expect(dataBarBox({ start: -1, end: 2, color: "#bad8fa" }, 42, 10, 1)).toBeUndefined();
  });
});
