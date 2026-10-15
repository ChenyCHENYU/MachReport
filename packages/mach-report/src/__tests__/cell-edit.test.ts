// @vitest-environment node
import { describe, expect, it } from "vitest";
import ExcelJSRuntime from "exceljs";
import { createTableTemplate } from "../builder/table-template";
import {
  applyReportCellEdit, createReportCellEdit, getReportCellContext,
  ReportCellEditError, type ReportCellAddress
} from "../editing";
import { paginateTemplate } from "../layout/paginate";
import type { GridCell, PlanComponent, RenderPlan } from "../schema/render-plan";
import { renderPlanToXlsx } from "../xlsx";

const first: ReportCellAddress = { pageIndex: 0, componentIndex: 0, rowIndex: 0, columnIndex: 0 };

function planWithCells(cells: (GridCell | null)[][]): RenderPlan {
  return { schemaVersion: "cell-edit", pages: [{
    pageWidthMm: 210, pageHeightMm: 297, components: [{
      kind: "rect", leftMm: 10, topMm: 10, widthMm: 100, heightMm: 20,
      grid: { cells, colWidthsMm: [25, 25, 25, 25] }
    }]
  }] };
}

function firstCell(plan: RenderPlan): GridCell {
  return plan.pages[0]!.components[0]!.grid!.cells[0]![0]!;
}

function editError(plan: RenderPlan, input: string): string | undefined {
  try { createReportCellEdit(plan, first, input); } catch (error) { return (error as ReportCellEditError).code; }
}

describe("immutable cell editing", () => {
  it("keeps zero, leading-zero IDs, boolean labels and explicit blanks typed", () => {
    let plan = planWithCells([[{ value: 8, text: "8" }, { value: "00123", text: "00123" }, { value: true, text: "是" }, { value: null, text: "", valueType: "number" }]]);
    plan = applyReportCellEdit(plan, createReportCellEdit(plan, first, "0"));
    const id = { ...first, columnIndex: 1 };
    plan = applyReportCellEdit(plan, createReportCellEdit(plan, id, "00009"));
    const boolean = { ...first, columnIndex: 2 };
    plan = applyReportCellEdit(plan, createReportCellEdit(plan, boolean, "false"));
    const blank = { ...first, columnIndex: 3 };
    plan = applyReportCellEdit(plan, createReportCellEdit(plan, blank, "12.5"));
    expect(plan.pages[0]!.components[0]!.grid!.cells[0]!.map((cell) => [cell!.value, cell!.text])).toEqual([
      [0, "0"], ["00009", "00009"], [false, "否"], [12.5, "12.5"]
    ]);
    expect(createReportCellEdit(plan, blank, " ").value).toBeNull();
    expect(createReportCellEdit(plan, id, " ").value).toBe(" ");
  });

  it("copies only changed branches and never mutates input plan or styles", () => {
    const original = planWithCells([[{ value: 3, text: "3", style: { color: "blue" } }], [{ value: "unchanged", text: "unchanged" }]]);
    const untouched: PlanComponent = { kind: "text", leftMm: 0, topMm: 0, widthMm: 10, heightMm: 10, text: "title" };
    original.pages[0]!.components.push(untouched);
    original.pages.push({ pageWidthMm: 210, pageHeightMm: 297, components: [] });
    const snapshot = JSON.stringify(original);
    const updated = applyReportCellEdit(original, createReportCellEdit(original, first, "4"));
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(updated).not.toBe(original);
    expect(updated.pages[0]).not.toBe(original.pages[0]);
    expect(updated.pages[1]).toBe(original.pages[1]);
    expect(updated.pages[0]!.components[1]).toBe(untouched);
    expect(updated.pages[0]!.components[0]!.grid!.cells[1]).toBe(original.pages[0]!.components[0]!.grid!.cells[1]);
    expect(firstCell(updated).style).toBe(firstCell(original).style);
    expect(firstCell(updated)).toMatchObject({ value: 4, text: "4", rawText: "4" });
  });

  it.each(["hello", "1,23", "NaN", "Infinity", "9007199254740993", "1e999", "0x10"])("rejects invalid or unsafe numeric input %s", (input) => {
    expect(editError(planWithCells([[{ value: 1, text: "1" }]]), input)).toBe("number");
  });

  it("validates boolean values instead of treating arbitrary text as true", () => {
    const plan = planWithCells([[{ value: false, text: "FALSE" }]]);
    expect(editError(plan, "maybe")).toBe("boolean");
    expect(createReportCellEdit(plan, first, "是")).toMatchObject({ value: true, text: "TRUE" });
  });

  it("preserves declared number precision, grouping and percent raw values", () => {
    const number = planWithCells([[{ value: 0, text: "0.00", numberFormat: "#,##0.00" }]]);
    expect(createReportCellEdit(number, first, "1,234.567")).toMatchObject({ value: 1234.567, text: "1,234.57" });
    const percent = planWithCells([[{ value: 0.1, text: "10.00%", numberFormat: "0.00%" }]]);
    expect(createReportCellEdit(percent, first, "25%")).toMatchObject({ value: 0.25, text: "25.00%" });
    expect(createReportCellEdit(percent, first, "0.125")).toMatchObject({ value: 0.125, text: "12.50%" });
    const optional = planWithCells([[{ value: 0, text: "0", numberFormat: "#,##0.###############" }]]);
    expect(createReportCellEdit(optional, first, "1234.56789").text).toBe("1,234.56789");
  });

  it("keeps blank numeric list columns editable as numbers with declared precision", () => {
    const template = createTableTemplate({ columns: [
      { field: "amount", header: "重量", format: { kind: "number", digits: 3 } },
      { field: "yield", header: "产率", format: { kind: "percent", digits: 2 } }
    ] });
    const { plan } = paginateTemplate(template, { detail: [{ amount: null, yield: null }] });
    const componentIndex = plan.pages[0]!.components.findIndex((component) => component.table?.role === "body");
    const address = { ...first, componentIndex };
    expect(createReportCellEdit(plan, address, "12.3")).toMatchObject({ value: 12.3, text: "12.300" });
    expect(createReportCellEdit(plan, { ...address, columnIndex: 1 }, "25%")).toMatchObject({ value: 0.25, text: "25.00%" });
  });

  it("protects formulas, complex children, explicitly read-only cells and structural rows", () => {
    const base = { value: 4, text: "4" };
    for (const cell of [{ ...base, formula: "A1*2", editable: true }, { ...base, editable: false }, { ...base, children: [{ kind: "text" as const, leftMm: 0, topMm: 0, widthMm: 1, heightMm: 1 }] }]) {
      expect(editError(planWithCells([[cell]]), "5")).toBe("readonly");
    }
    const plan = planWithCells([[base]]);
    plan.pages[0]!.components[0]!.table = { id: "t", rowIndex: -1, role: "header", columnKeys: ["value"] };
    expect(getReportCellContext(plan, first)?.readOnlyReason).toBe("structure");
    expect(editError(plan, "5")).toBe("readonly");
    firstCell(plan).editable = true;
    expect(createReportCellEdit(plan, first, "5").value).toBe(5);
  });

  it("propagates flat column editing options without unlocking headers or summaries", () => {
    const template = createTableTemplate({ columns: [
      { field: "id", header: "编号", editable: false },
      { field: "enabled", header: "启用", valueType: "boolean", editable: true }
    ], listOptions: { groupBy: { field: "group", subtotal: ["enabled"] } } });
    const { plan } = paginateTemplate(template, { detail: [{ id: "001", enabled: null, group: "a" }] });
    const components = plan.pages[0]!.components;
    const body = components.findIndex((component) => component.table?.role === "body");
    expect(getReportCellContext(plan, { ...first, componentIndex: body })?.editable).toBe(false);
    expect(createReportCellEdit(plan, { ...first, componentIndex: body, columnIndex: 1 }, "否").value).toBe(false);
    const header = components.findIndex((component) => component.table?.role === "header");
    expect(getReportCellContext(plan, { ...first, componentIndex: header, columnIndex: 1 })?.editable).toBe(false);
    const subtotal = components.findIndex((component) => component.table?.role === "subtotal");
    expect(getReportCellContext(plan, { ...first, componentIndex: subtotal, columnIndex: 1 })?.editable).toBe(false);
  });

  it("locates compact merged-grid cells by physical coordinates and rejects covered/null positions", () => {
    const plan = planWithCells([
      [{ text: "merged", colSpan: 2, rowSpan: 2 }, { value: 1, text: "1" }, null],
      [{ value: 2, text: "2" }, { value: 3, text: "3" }]
    ]);
    const address = { ...first, rowIndex: 1, columnIndex: 2 };
    expect(getReportCellContext(plan, address)?.value).toBe(2);
    expect(getReportCellContext(plan, { ...first, columnIndex: 1 })).toBeNull();
    expect(getReportCellContext(plan, { ...first, columnIndex: 3 })).toBeNull();
    expect(getReportCellContext(plan, { ...first, rowIndex: 1, columnIndex: 0 })).toBeNull();
    const updated = applyReportCellEdit(plan, createReportCellEdit(plan, address, "7"));
    expect(updated.pages[0]!.components[0]!.grid!.cells[1]![0]?.value).toBe(7);
    expect(getReportCellContext(updated, { ...address, columnIndex: 3 })?.value).toBe(3);
  });

  it("updates repeated logical fragments while preserving other tables and row identities", () => {
    const plan = planWithCells([[{ value: 1, text: "1" }]]);
    const component = plan.pages[0]!.components[0]!;
    component.table = { id: "report/table", rowIndex: 4, role: "body", columnKeys: ["qty"] };
    plan.pages.push({ ...plan.pages[0]!, components: [structuredClone(component), { ...structuredClone(component), table: { ...component.table, rowIndex: 5 } }, { ...structuredClone(component), table: { ...component.table, id: "other/table" } }] });
    const context = getReportCellContext(plan, first)!;
    expect(context.table).toEqual({ id: "report/table", rowIndex: 4, role: "body", columnKey: "qty" });
    const updated = applyReportCellEdit(plan, createReportCellEdit(plan, first, "9"));
    expect(updated.pages[1]!.components.map((entry) => entry.grid!.cells[0]![0]!.value)).toEqual([9, 1, 1]);
    expect(plan.pages[1]!.components[0]!.grid!.cells[0]![0]!.value).toBe(1);
  });

  it("rejects stale patches and invalid/missing addresses", () => {
    const plan = planWithCells([[{ value: 1, text: "1" }]]);
    const edit = createReportCellEdit(plan, first, "2");
    const changed = applyReportCellEdit(plan, edit);
    expect(() => applyReportCellEdit(changed, edit)).toThrowError(ReportCellEditError);
    expect(getReportCellContext(plan, { ...first, rowIndex: -1 })).toBeNull();
    expect(getReportCellContext(plan, { ...first, columnIndex: 0.5 })).toBeNull();
    expect(() => createReportCellEdit(plan, { ...first, pageIndex: 9 }, "2")).toThrowError(ReportCellEditError);
  });

  it("exports edited text and raw number values consistently via a real XLSX round trip", async () => {
    const original = planWithCells([[{ value: 1.5, text: "1.50", numberFormat: "0.00" }, { value: "00123", text: "00123" }]]);
    let plan = applyReportCellEdit(original, createReportCellEdit(original, first, "0"));
    plan = applyReportCellEdit(plan, createReportCellEdit(plan, { ...first, columnIndex: 1 }, "00009"));
    const workbook = new ExcelJSRuntime.Workbook();
    const { buffer } = await renderPlanToXlsx(plan, { valueMode: "raw" });
    await workbook.xlsx.load(buffer);
    const cells = workbook.worksheets[0]!.getRow(1);
    expect(cells.getCell(1).value).toBe(0);
    expect(cells.getCell(1).numFmt).toBe("0.00");
    expect(cells.getCell(2).value).toBe("00009");
    expect(firstCell(original).value).toBe(1.5);
  });
});
