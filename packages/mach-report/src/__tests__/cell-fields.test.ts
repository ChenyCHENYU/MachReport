// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getReportCellContext, parseReportCellFieldInput, ReportCellFieldError, validateReportCellFieldDefinition, type GridCell, type ReportCellFieldOptions, type RenderPlan } from "../index";

function context(cell: GridCell) {
  const plan: RenderPlan = { schemaVersion: "fields", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [{ kind: "rect", leftMm: 0, topMm: 0, widthMm: 50, heightMm: 10, grid: { cells: [[cell]], colWidthsMm: [50] } }] }] };
  return getReportCellContext(plan, { pageIndex: 0, componentIndex: 0, rowIndex: 0, columnIndex: 0 })!;
}
function expectCode(action: () => unknown, code: string): void {
  try { action(); throw new Error("Expected validation failure"); }
  catch (cause) { expect(cause).toMatchObject({ code }); }
}

describe("shared field editor constraints", () => {
  const numeric = context({ value: 3, valueType: "number" });
  const text = context({ value: "001" });
  const boolean = context({ value: false });
  it("retains authoritative number parsing, zero and percentage semantics", () => {
    expect(parseReportCellFieldInput(numeric, "0", { type: "number", min: 0, max: 10, precision: 2 })).toBe(0);
    expect(parseReportCellFieldInput(numeric, "1e-2", { type: "number", precision: 2 })).toBe(.01);
    expect(parseReportCellFieldInput(context({ value: 0, numberFormat: "0.0%" }), "25%", { type: "number", min: 0, max: 1, precision: 2 })).toBe(.25);
    expectCode(() => parseReportCellFieldInput(numeric, "1.001", { type: "number", precision: 2 }), "precision");
    expectCode(() => parseReportCellFieldInput(numeric, "-1", { type: "number", min: 0 }), "min");
    expectCode(() => parseReportCellFieldInput(numeric, "11", { type: "number", max: 10 }), "max");
    expectCode(() => parseReportCellFieldInput(numeric, "Infinity", { type: "number" }), "number");
  });
  it("preserves leading zero IDs and counts Unicode code points", () => {
    expect(parseReportCellFieldInput(text, "0009", { type: "text", maxLength: 4 })).toBe("0009");
    expect(parseReportCellFieldInput(text, "😀中", { type: "text", maxLength: 2 })).toBe("😀中");
    expectCode(() => parseReportCellFieldInput(text, "😀中A", { type: "text", maxLength: 2 }), "length");
    expectCode(() => parseReportCellFieldInput(text, "", { type: "text", required: true }), "required");
    expectCode(() => parseReportCellFieldInput(text, "  ", { type: "text", required: true }), "required");
  });
  it("validates actual enum values and preserves false and numeric zero", () => {
    expect(parseReportCellFieldInput(boolean, false, { type: "enum", required: true, options: [{ value: true }, { value: false }] })).toBe(false);
    expect(parseReportCellFieldInput(numeric, "0", { type: "enum", options: [{ value: 0 }, { value: 3 }] })).toBe(0);
    expectCode(() => parseReportCellFieldInput(text, "ABC", { type: "enum", options: [{ value: "001" }] }), "choice");
    expect(parseReportCellFieldInput(text, "", { type: "enum", options: [{ value: "001" }] })).toBe("");
    expect(parseReportCellFieldInput(boolean, "", { type: "boolean" })).toBeNull();
    expectCode(() => parseReportCellFieldInput(boolean, "", { type: "boolean", required: true }), "required");
  });
  it("only accepts explicitly configured ISO business dates with real calendar validation", () => {
    const field = { type: "date", min: "2024-01-01", max: "2024-12-31" } as const;
    expect(parseReportCellFieldInput(text, "2024-02-29", field)).toBe("2024-02-29");
    expect(parseReportCellFieldInput(text, "", field)).toBe("");
    for (const value of ["2023-02-29", "2024-02-30", "2024-13-01", "2024-2-01", "2024-01-01T10:00:00Z"]) expectCode(() => parseReportCellFieldInput(text, value, field), "date");
    expectCode(() => parseReportCellFieldInput(text, "2023-12-31", field), "min");
    expectCode(() => parseReportCellFieldInput(text, "2025-01-01", field), "max");
  });
  it.each([
    { type: "number", precision: -1 }, { type: "number", precision: 16 }, { type: "number", min: 10, max: 1 },
    { type: "number", min: NaN }, { type: "text", maxLength: -1 }, { type: "date", min: "2024-02-30" },
    { type: "date", min: "2025-01-01", max: "2024-01-01" }, { type: "enum", options: [] },
    { type: "enum", options: [null] }, { type: "enum", options: [{ value: "001" }, { value: "001" }] },
    { type: "enum", options: [{ value: 1 }] }, { type: "unknown" }, { type: "text", required: "yes" },
    { type: "text", hint: 123 }, { type: "enum", options: [{ value: "001", label: 1 }] }
  ])("rejects malformed field definitions (%j) before use", (field) => {
    const target = field.type === "number" ? numeric : text;
    expectCode(() => validateReportCellFieldDefinition(target, field as ReportCellFieldOptions), "definition");
  });
  it("rejects editor type changes and never overrides cell protection", () => {
    expectCode(() => validateReportCellFieldDefinition(text, { type: "number" }), "type");
    expectCode(() => validateReportCellFieldDefinition(numeric, { type: "date" }), "type");
    expectCode(() => parseReportCellFieldInput(context({ value: "2024-01-01", editable: false }), "2024-02-01", { type: "date" }), "readonly");
    expectCode(() => parseReportCellFieldInput(context({ value: 1, formula: "A1*2" }), 2, { type: "number" }), "readonly");
    expect(() => parseReportCellFieldInput(text, "", { type: "text", label: "炉号", required: true })).toThrowError(ReportCellFieldError);
  });
});
