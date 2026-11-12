import { describe, expect, it } from "vitest";
import type { RenderPlan } from "../../schema/render-plan";
import { importedDiagnosticAddress, importedDiagnosticPage } from "../import-diagnostic-location";
import type { ExcelImportDiagnostic } from "../../xlsx/import-types";
const plan: RenderPlan = { schemaVersion: "test", pages: [{ pageWidthMm: 210, pageHeightMm: 297, components: [
  { kind: "rect", leftMm: 1, topMm: 1, widthMm: 50, heightMm: 20, meta: { xlsxSheet: "Sheet", xlsxRange: "B10:D11" }, grid: { colWidthsMm: [10, 20, 20], cells: [[{ text: "Merged", colSpan: 2 }, { text: "End" }], [{ text: "Next", rowSpan: 1 }, {}, {}]] } }
] }] };
const entry: ExcelImportDiagnostic = { code: "formula-cached", severity: "warning", message: "Cached", sheet: "Sheet", row: 10, column: 3 };
describe("Excel source diagnostic addresses", () => {
  it("locates merged master cells and original Excel coordinates after segmentation", () => {
    expect(importedDiagnosticAddress(plan, entry)).toEqual({ pageIndex: 0, componentIndex: 0, rowIndex: 0, columnIndex: 0 });
    expect(importedDiagnosticAddress(plan, { ...entry, column: 4 })?.columnIndex).toBe(2);
    expect(importedDiagnosticAddress(plan, { ...entry, row: 11, column: 2 })?.rowIndex).toBe(1);
  });
  it("rejects unavailable coordinates/invalid metadata and falls back to the source sheet", () => {
    expect(importedDiagnosticAddress(plan, { ...entry, sheet: "Other" })).toBeUndefined();
    expect(importedDiagnosticAddress(plan, { ...entry, row: undefined })).toBeUndefined();
    expect(importedDiagnosticAddress(plan, { ...entry, row: 9 })).toBeUndefined();
    const invalid = structuredClone(plan); invalid.pages[0]!.components[0]!.meta!.xlsxRange = "invalid";
    expect(importedDiagnosticAddress(invalid, entry)).toBeUndefined();
    expect(importedDiagnosticPage([{ name: "Sheet", index: 1, range: "B10:D11", rowCount: 2, columnCount: 3, pageStart: 4, pageCount: 2 }], entry)).toBe(4);
    expect(importedDiagnosticPage([], entry)).toBeUndefined();
  });
});
