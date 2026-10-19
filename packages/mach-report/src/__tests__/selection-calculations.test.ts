// @vitest-environment node
import { describe, expect, it } from "vitest";
import { calculateReportSelection, evaluateReportAggregateExpression, type ReportCalculationSelection } from "../selection-calculations";
import type { GridCell, PlanComponent, RenderPlan } from "../schema/render-plan";

const cellAddress = (rowIndex = 0, columnIndex = 0, pageIndex = 0, componentIndex = 0) => ({ pageIndex, componentIndex, rowIndex, columnIndex });
function component(cells: (GridCell | null)[][], columns = cells[0]?.length ?? 1): PlanComponent {
  return { kind: "rect", leftMm: 0, topMm: 0, widthMm: 100, heightMm: 100, grid: { cells, colWidthsMm: Array(columns).fill(10) } };
}
function planOf(...components: PlanComponent[]): RenderPlan {
  return { schemaVersion: "test", pages: [{ pageWidthMm: 200, pageHeightMm: 200, components }] };
}
function range(row = 0, col = 0): ReportCalculationSelection { return { anchor: cellAddress(), focus: cellAddress(row, col) }; }

describe("read-only selection calculations", () => {
  it("preserves zero and excludes dates, boolean, text identifiers, null and display-only text without mutation", async () => {
    const plan = planOf(component([[{ value: 0, editable: false }, { value: 1.2 }, { value: "0012", valueType: "number" }, { value: 12, valueType: "text" }, { value: true }, { value: null }, { text: "9" }, { value: 45600, numberFormat: "yyyy-mm-dd" }, { value: 0.5, numberFormat: "[h]:mm" }]]));
    const original = structuredClone(plan);
    expect(await calculateReportSelection(plan, range(0, 8))).toEqual({ value: 1.2, formatted: "1.20", numericCells: 2, excludedCells: 7, selectedCells: 9, precision: 2 });
    expect(plan).toEqual(original);
  });
  it("includes cached finite numeric formulas without executing or rewriting them", async () => {
    const plan = planOf(component([[{ value: 3, formula: "EXTERNAL()", editable: false }, { formula: "1+1", text: "2" }]]));
    expect(await calculateReportSelection(plan, range(0, 1))).toMatchObject({ value: 3, numericCells: 1, excludedCells: 1 });
    expect(plan.pages[0]!.components[0]!.grid!.cells[0]![0]!.formula).toBe("EXTERNAL()");
  });
  it("counts renderer-compatible null and sparse undefined entries as selected blanks", async () => {
    const row = new Array<GridCell | null>(3);
    row[0] = { value: 1 };
    row[1] = null;
    const plan = planOf(component([row], 3));
    const original = structuredClone(plan);
    expect(await calculateReportSelection(plan, range(0, 2))).toMatchObject({ value: 1, numericCells: 1, selectedCells: 3, excludedCells: 2 });
    expect(plan).toEqual(original);
    expect(2 in plan.pages[0]!.components[0]!.grid!.cells[0]!).toBe(false);
  });
  it.each([['sum', 15], ['average', 3], ['min', 0], ['max', 6], ['count', 5], ['median', 3]] as const)("calculates %s", async (operation, value) => {
    const plan = planOf(component([[6], [0], [2], [4], [3]].map((row) => row.map((number) => ({ value: number })))));
    expect(await calculateReportSelection(plan, range(4), { operation })).toMatchObject({ value });
  });
  it("uses compensated addition and rounds only presentation", async () => {
    const plan = planOf(component([[{ value: 0.1 }, { value: 0.2 }]]));
    expect(await calculateReportSelection(plan, range(0, 1), { precision: 4 })).toMatchObject({ formatted: "0.3000", numericCells: 2 });
  });
  it("handles even median and no numeric data without invented zeros", async () => {
    const plan = planOf(component([[{ value: 4 }, { value: 1 }, { value: 3 }, { value: 2 }]]));
    expect(await calculateReportSelection(plan, range(0, 3), { operation: "median" })).toMatchObject({ value: 2.5 });
    const blank = planOf(component([[{ value: null }]]));
    expect(await calculateReportSelection(blank, range())).toMatchObject({ value: null, formatted: "—", numericCells: 0 });
    expect(await calculateReportSelection(blank, range(), { operation: "count" })).toMatchObject({ value: 0, formatted: "0.00" });
  });
  it("counts merged cells once using renderer-compatible physical coordinates", async () => {
    const plan = planOf(component([[{ value: 10, colSpan: 2, rowSpan: 2 }, { value: 2 }], [{ value: 3 }]], 3));
    expect(await calculateReportSelection(plan, range(1, 2))).toMatchObject({ value: 15, numericCells: 3, selectedCells: 3 });
  });
  it("deduplicates repeated logical fragments, skips headers/totals and maps reordered columns across pages", async () => {
    const first = component([[{ value: 10 }, { value: "001" }]], 2);
    first.table = { id: "rows", role: "body", rowIndex: 0, columnKeys: ["amount", "id"] };
    const repeated = structuredClone(first);
    const last = component([[{ value: "002" }, { value: 20 }]], 2);
    last.table = { id: "rows", role: "body", rowIndex: 1, columnKeys: ["id", "amount"] };
    const header = structuredClone(first); header.table!.role = "header"; header.table!.rowIndex = -1;
    const total = structuredClone(first); total.table!.role = "grand-total"; total.table!.rowIndex = 2;
    const plan = planOf(header, first, total);
    plan.pages.push({ pageWidthMm: 200, pageHeightMm: 200, components: [repeated, last] });
    const selected = { anchor: cellAddress(0, 0, 0, 1), focus: cellAddress(0, 1, 1, 1) };
    expect(await calculateReportSelection(plan, selected)).toMatchObject({ value: 30, numericCells: 2, selectedCells: 2 });
  });
  it("does not scan a large grid beyond the selected final row", async () => {
    const rows = Array.from({ length: 1000 }, () => Array.from({ length: 201 }, () => ({ value: 1 })));
    const plan = planOf(component(rows, 201));
    expect(await calculateReportSelection(plan, range())).toMatchObject({ value: 1, selectedCells: 1 });
  });
  it("skips unrelated logical table fragments across pages without raising scan limits", async () => {
    const columns = Array.from({ length: 201 }, (_, index) => `field_${index}`);
    const plan: RenderPlan = { schemaVersion: "test", pages: Array.from({ length: 1000 }, (_, index) => {
      const fragment = component([columns.map(() => ({ value: index + 1 }))], columns.length);
      fragment.table = { id: "rows", role: "body", rowIndex: index, columnKeys: columns };
      return { pageWidthMm: 200, pageHeightMm: 200, components: [fragment] };
    }) };
    const address = cellAddress(0, 0, 700);
    expect(await calculateReportSelection(plan, { anchor: address, focus: address }, { maxScannedCells: 2500 })).toMatchObject({ value: 701, numericCells: 1, selectedCells: 1 });
  });
  it("retains preceding rowspan occupancy while stopping at the selected row boundary", async () => {
    const plan = planOf(component([[{ value: 10, rowSpan: 3 }, { value: 2 }], [{ value: 3 }], [{ value: 4 }], [{ value: 999 }, { value: 999 }], [{ value: 999 }, { value: 999 }]], 2));
    const selected = { anchor: cellAddress(1, 1), focus: cellAddress(2, 1) };
    expect(await calculateReportSelection(plan, selected, { maxScannedCells: 6 })).toMatchObject({ value: 7, selectedCells: 2 });
    // The required prefix is still budgeted instead of skipping its row-span work.
    await expect(calculateReportSelection(plan, selected, { maxScannedCells: 5 })).rejects.toMatchObject({ code: "limit" });
  });
  it("rejects invalid, unrelated and over-budget selections before returning partial totals", async () => {
    const plan = planOf(component([[{ value: 1 }, { value: 2 }]]), component([[{ value: 9 }]]));
    await expect(calculateReportSelection(plan, range(0, 1), { maxCells: 1 })).rejects.toMatchObject({ code: "limit" });
    await expect(calculateReportSelection(plan, range(), { maxScannedCells: 1 })).rejects.toMatchObject({ code: "limit" });
    await expect(calculateReportSelection(plan, { anchor: cellAddress(), focus: cellAddress(0, 0, 0, 1) })).rejects.toMatchObject({ code: "selection" });
    await expect(calculateReportSelection(plan, { anchor: cellAddress(-1), focus: cellAddress() })).rejects.toMatchObject({ code: "selection" });
    await expect(calculateReportSelection(plan, range(), { precision: 15 })).rejects.toMatchObject({ code: "precision" });
  });
  it("rejects unsafe integer inputs, unsafe integer totals and overflow without presenting misleading results", async () => {
    const unsafe = planOf(component([[{ value: Number.MAX_SAFE_INTEGER + 1 }]]));
    await expect(calculateReportSelection(unsafe, range())).rejects.toMatchObject({ code: "precision" });
    const unsafeTotal = planOf(component([[{ value: Number.MAX_SAFE_INTEGER }, { value: 1 }]]));
    await expect(calculateReportSelection(unsafeTotal, range(0, 1))).rejects.toMatchObject({ code: "precision" });
    expect(() => evaluateReportAggregateExpression("1e308 * 10", {})).toThrowError(expect.objectContaining({ code: "overflow" }));
  });
  it("cancels before starting and while a large region cooperatively yields", async () => {
    const plan = planOf(component(Array.from({ length: 5000 }, () => [{ value: 1 }])));
    const cancelled = new AbortController(); cancelled.abort();
    await expect(calculateReportSelection(plan, range(), { signal: cancelled.signal })).rejects.toMatchObject({ name: "AbortError" });
    const active = new AbortController(); let yields = 0;
    await expect(calculateReportSelection(plan, range(4999), { signal: active.signal, yieldToHost: async () => { yields++; active.abort(); } })).rejects.toMatchObject({ name: "AbortError" });
    expect(yields).toBe(1);
    const duringMedian = new AbortController(); let medianYields = 0;
    const medianPlan = planOf(component([Array.from({ length: 5000 }, () => ({ value: 1 }))]));
    await expect(calculateReportSelection(medianPlan, range(0, 4999), { operation: "median", signal: duringMedian.signal, yieldToHost: async () => { if (++medianYields === 3) duringMedian.abort(); } })).rejects.toMatchObject({ name: "AbortError" });
    expect(medianYields).toBe(3);
  });
});

describe("bounded aggregate expressions", () => {
  it("honors arithmetic precedence, unary operators, parentheses and named summaries", async () => {
    const plan = planOf(component([[{ value: 4 }, { value: 6 }]]));
    expect(await calculateReportSelection(plan, range(0, 1), { operation: "expression", expression: "(SUM - MIN) / COUNT + -2 * 3" })).toMatchObject({ value: -3 });
    expect(await calculateReportSelection(plan, range(0, 1), { operation: "expression", expression: "MEDIAN + AVG" })).toMatchObject({ value: 10 });
  });
  it("reports division by zero and invalid formulas", () => {
    expect(() => evaluateReportAggregateExpression("SUM / (COUNT - 2)", { SUM: 10, COUNT: 2 })).toThrowError(expect.objectContaining({ code: "division" }));
    expect(() => evaluateReportAggregateExpression("SUM +", { SUM: 10 })).toThrowError(expect.objectContaining({ code: "expression" }));
  });
  it.each(["globalThis.alert(1)", "SUM.constructor", "eval('1')", "new Function('1')", "SUM=1", "SUM(1)", "SUM;MAX", "__proto__", "2**3", "1/*x*/+2", "(".repeat(30) + "1" + ")".repeat(30)])("rejects executable/unsupported source %s", (expression) => {
    expect(() => evaluateReportAggregateExpression(expression, { SUM: 1 })).toThrow();
  });
});
