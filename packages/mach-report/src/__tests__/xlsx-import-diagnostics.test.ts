// @vitest-environment node
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { importExcelTemplate } from "../xlsx/import-template";
import { openExcelWorkbook } from "../xlsx/workbook-session";
import { ImportWarnings } from "../xlsx/import-types";
import { validDiagnosticSummary } from "../output/diagnostic-collector";

describe("structured Excel import diagnostics", () => {
  it("counts every occurrence while bounding details and preserving source cell locations", async () => {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Production");
    for (let row = 1; row <= 210; row++) sheet.getCell(row, 1).value = { formula: "1+1", result: 2 };
    sheet.getCell("B210").value = new Date("2026-10-15T00:00:00Z");
    sheet.getCell("B210").numFmt = "yyyy-mm-dd";
    const result = await importExcelTemplate(new Uint8Array(await workbook.xlsx.writeBuffer()));
    expect(result.warnings.some(message => message.includes("公式"))).toBe(true);
    expect(result.diagnosticSummary?.counts["formula-cached"]).toBe(210);
    expect(result.diagnosticSummary?.counts["date-readonly"]).toBe(1);
    expect(result.diagnosticSummary?.total).toBe(211);
    expect(result.diagnostics).toHaveLength(200);
    expect(result.diagnosticSummary?.omitted).toBe(11);
    expect(validDiagnosticSummary(result.diagnosticSummary)).toBe(true);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "date-readonly", sheet: "Production", cell: "B210", row: 210, column: 2 }));
  });

  it("preserves bounded legacy messages and exact structured counts when forking preflight results", () => {
    const warnings = new ImportWarnings();
    for (let index = 0; index < 205; index++) warnings.add(`Chart ${index}`, "chart", { part: `xl/charts/chart${index}.xml` });
    const copy = warnings.fork();
    expect(copy.result()).toHaveLength(201);
    expect(copy.structured().diagnosticSummary).toEqual(warnings.structured().diagnosticSummary);
    copy.add("A new category", "external-link", { part: "xl/externalLinks/externalLink1.xml" });
    expect(copy.structured().diagnosticSummary.counts).toEqual({ chart: 205, "external-link": 1 });
    expect(copy.structured().diagnostics).toContainEqual(expect.objectContaining({ code: "external-link" }));
    expect(warnings.structured().diagnosticSummary.total).toBe(205);
  });

  it("locates hidden rows/columns and validation ranges without counting repeated geometry reads", async () => {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Locations");
    sheet.getCell("B2").value = "Value";
    sheet.getRow(2).hidden = true; sheet.getColumn(2).hidden = true;
    sheet.getCell("B2").dataValidation = { type: "whole", operator: "between", formulae: [1, 10] };
    const result = await importExcelTemplate(new Uint8Array(await workbook.xlsx.writeBuffer()));
    expect(result.diagnosticSummary?.counts).toMatchObject({ "hidden-row": 1, "hidden-column": 1, "data-validation": 1 });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "hidden-row", sheet: "Locations", row: 2, cell: "B2", column: 2, range: "B2:B2" }));
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "data-validation", sheet: "Locations", row: 2, column: 2, cell: "B2", range: "B2" }));
  });

  it("replays cached style diagnostics per cell and does not accumulate session imports", async () => {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Styles");
    for (const address of ["B2", "B3"]) {
      sheet.getCell(address).value = "Value";
      sheet.getCell(address).font = { strike: true };
    }
    const session = await openExcelWorkbook(new Uint8Array(await workbook.xlsx.writeBuffer()));
    try {
      const first = await session.importTemplate({ range: "B2:B3" });
      const second = await session.importTemplate({ range: "B2:B3" });
      expect(first.diagnosticSummary?.counts["font-decoration"]).toBe(2);
      expect(first.diagnostics?.map(entry => entry.cell)).toEqual(["B2", "B3"]);
      expect(second.diagnosticSummary).toEqual(first.diagnosticSummary);
    } finally { session.dispose(); }
  });
});
