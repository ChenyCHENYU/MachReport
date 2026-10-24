// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from "pdf-lib";
import { renderPlan } from "../render/dom";
import { resolveGridLayout } from "../render/grid-geometry";
import { renderPlanToXlsx } from "../xlsx/render-xlsx";
import { renderPlanToPdf } from "../pdf/render-pdf";
import { inspectOutputCapabilities, OutputFidelityError } from "../output/capabilities";
import { complexAcceptanceFixture, EXACT_DECIMAL, LONG_NOTE, productionRows } from "./fixtures/complex-report";
import type { RenderPlan } from "../schema/render-plan";

type Fixture = Awaited<ReturnType<typeof complexAcceptanceFixture>>;
let fixture: Fixture;
beforeAll(async () => { fixture = await complexAcceptanceFixture(); });

function pdfText(document: PDFDocument): string {
  return document.getPages().map((page) => {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? Array.from({ length: contents.size() }, (_, index) => contents.lookup(index, PDFRawStream)) : contents ? [contents] : [];
    return streams.flatMap((stream) => {
      if (!(stream instanceof PDFRawStream)) throw new Error("Expected a serialized PDF content stream");
      const operators = Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
      return Array.from(operators.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g), (match) => Buffer.from(match[1]!, "hex").toString("latin1"));
    }).join("\n");
  }).join("\n");
}

describe("synthetic complex reports: shared data and real output acceptance", () => {
  it("preserves multi-level merged identities, independent datasets, grouping and exact display semantics in plan and DOM", () => {
    const { plan } = fixture; const components = plan.pages.flatMap((page) => page.components);
    const importedBodies = components.filter((component) => component.table?.role === "body" && component.table.source?.datasetId === "production" && component.table.columnKeys.includes("lot"));
    const groupedBodies = components.filter((component) => component.table?.role === "body" && component.table.columnKeys.includes("sequence"));
    expect(importedBodies).toHaveLength(productionRows.length); expect(groupedBodies).toHaveLength(productionRows.length);
    expect(importedBodies.map((body) => body.table?.source?.rowKey)).toEqual(productionRows.map((row) => row.id));
    expect(importedBodies[0]!.grid!.cells[0]!.map((cell) => cell?.text)).toEqual(["00000", "0.000", "", "LOT-0", EXACT_DECIMAL, LONG_NOTE]);
    const firstHeader = components.find((component) => component.table?.role === "header" && component.grid?.cells.length === 3)!;
    expect(resolveGridLayout(firstHeader.grid!, firstHeader.widthMm, firstHeader.heightMm).cells.map(({ ri, ci, cell }) => [ri, ci, cell.rowSpan ?? 1, cell.colSpan ?? 1])).toEqual(expect.arrayContaining([[0, 0, 3, 1], [0, 1, 1, 2], [0, 3, 1, 3], [1, 3, 1, 2]]));
    expect(components.filter((component) => component.table?.role === "subtotal").map((component) => component.grid!.cells[0]!.find((cell) => cell?.value !== undefined)?.value)).toEqual([25, 30]);
    expect(components.find((component) => component.table?.role === "grand-total")!.grid!.cells[0]!.find((cell) => cell?.value !== undefined)?.value).toBe(55);
    const root = renderPlan(plan, document, { fidelity: "strict" });
    expect(root.textContent).not.toContain("OLD SAMPLE MUST DISAPPEAR");
    expect(root.textContent).toContain(EXACT_DECIMAL); expect(root.textContent).toContain("EX-001"); expect(root.textContent).toContain("00042");
    const merged = Array.from(root.querySelectorAll("td")).find((cell) => cell.textContent === "Heat ID" && cell.rowSpan === 3)!;
    expect(merged.rowSpan).toBe(3);
    const decimalCells = Array.from(root.querySelectorAll("td")).filter((cell) => cell.textContent === EXACT_DECIMAL);
    expect(decimalCells).toHaveLength(productionRows.length * 2);
    const expectedStyle = document.createElement("span"); expectedStyle.style.color = "#cc0000"; expectedStyle.style.backgroundColor = "#fff0f0";
    const negative = Array.from(root.querySelectorAll("td")).find((cell) => cell.textContent === "-2.500" && cell.style.color === expectedStyle.style.color)!;
    expect(negative).toBeDefined(); expect(negative.style.backgroundColor).toBe(expectedStyle.style.backgroundColor);
    expect(groupedBodies[0]!.heightMm).toBeGreaterThan(groupedBodies[2]!.heightMm);
    const a3 = plan.pages.find((page) => page.pageWidthMm === 420)!; expect(a3.pageHeightMm).toBe(297);
    const a4 = plan.pages.at(-1)!; expect([a4.pageWidthMm, a4.pageHeightMm]).toEqual([210, 297]);
    expect(a4.components.find((component) => component.text?.startsWith("Page "))?.text).toBe("Page 1 / 1");
  });

  it("writes real XLSX preserving raw zero/null/IDs/decimal strings, merges, aggregates and conditional styles", async () => {
    const result = await renderPlanToXlsx(fixture.plan, { sheetMode: "continuous", fidelity: "strict" });
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(result.buffer);
    expect(result.diagnostics).toEqual([]); expect(workbook.worksheets).toHaveLength(4);
    const imported = workbook.worksheets[0]!;
    expect(imported.model.merges).toEqual(expect.arrayContaining(["A1:A3", "B1:C1", "D1:F1", "D2:E2", "F2:F3"]));
    expect(imported.rowCount).toBe(51); expect(imported.getCell("A4").value).toBe("00000");
    expect(imported.getCell("B4").value).toBe(0); expect(imported.getCell("B4").numFmt).toBe("0.000");
    expect(imported.getCell("C4").value).toBeNull(); expect(imported.getCell("C5").value).toBe(.125); expect(imported.getCell("C5").numFmt).toBe("0.00%");
    expect(imported.getCell("E4").value).toBe(EXACT_DECIMAL); expect(imported.getCell("E4").type).toBe(ExcelJS.ValueType.String);
    expect(imported.getCell("F4").value).toBe(LONG_NOTE); expect(imported.getCell("F4").alignment.wrapText).toBe(true);
    const grouped = workbook.worksheets[1]!; const rows: ExcelJS.Row[] = []; grouped.eachRow((row) => rows.push(row));
    expect(rows.filter((row) => typeof row.getCell(2).value === "string" && /^\d{5}$/.test(String(row.getCell(2).value))).map((row) => row.getCell(1).value)).toEqual(productionRows.map((row) => row.sequence));
    expect(rows.filter((row) => row.getCell(1).value === "Subtotal").map((row) => row.getCell(3).value)).toEqual([25, 30]);
    expect(rows.find((row) => row.getCell(1).value === "Grand Total")?.getCell(3).value).toBe(55);
    const negative = rows.find((row) => row.getCell(3).value === -2.5)!.getCell(3);
    expect(negative.font.color).toEqual({ argb: "FFCC0000" }); expect(negative.font.bold).toBe(true);
    expect(workbook.worksheets[2]!.getCell("A3").value).toBe("EX-001");
    expect(workbook.worksheets[3]!.getSheetValues().flat()).toContain("00042");
    expect(JSON.stringify(workbook.worksheets.map((sheet) => sheet.getSheetValues()))).not.toContain("OLD SAMPLE");
  });

  it("reads actual PDF bytes, verifies every page's paper geometry and retained business values", async () => {
    const result = await renderPlanToPdf(fixture.plan, { fidelity: "strict" });
    expect(result.pageErrors).toEqual([]); expect(result.unsupportedTextCount).toBe(0); expect(result.diagnostics).toEqual([]);
    const pdf = await PDFDocument.load(result.bytes); expect(pdf.getPageCount()).toBe(fixture.plan.pages.length);
    pdf.getPages().forEach((page, index) => {
      expect(page.getWidth()).toBeCloseTo(fixture.plan.pages[index]!.pageWidthMm * 72 / 25.4, 4);
      expect(page.getHeight()).toBeCloseTo(fixture.plan.pages[index]!.pageHeightMm * 72 / 25.4, 4);
    });
    const text = pdfText(pdf);
    for (const expected of ["00000", "0.000", "12.50%", EXACT_DECIMAL, "Warehouse A", "Subtotal", "Grand Total", "55.000", "EX-001", "00042", "Page 1 / 1"]) expect(text).toContain(expected);
    expect(text).not.toContain("OLD SAMPLE");
    expect(text.replace(/\s+/g, "").split(EXACT_DECIMAL)).toHaveLength(productionRows.length * 2 + 1);
    expect(text.replace(/\s+/g, " ")).toContain(LONG_NOTE);
  }, 15000);

  it("retains supported nested text and refuses missing assets before producing a misleading export", async () => {
    const unsupported: RenderPlan = { schemaVersion: "unsupported", pages: [{ pageWidthMm: 210, pageHeightMm: 297, components: [{
      kind: "rect", nid: "nested-grid", leftMm: 0, topMm: 0, widthMm: 50, heightMm: 10,
      grid: { colWidthsMm: [50], cells: [[{ text: "Parent", children: [{ kind: "text", leftMm: 0, topMm: 0, widthMm: 20, heightMm: 5, text: "Nested" }] }]] }
    }, { kind: "chart", nid: "missing-chart", leftMm: 0, topMm: 20, widthMm: 50, heightMm: 20 }] }] };
    expect(inspectOutputCapabilities(unsupported, "xlsx")).toEqual(expect.arrayContaining([expect.objectContaining({ code: "missing-image", nid: "missing-chart", pageIndex: 0, componentIndex: 1 })]));
    await expect(renderPlanToXlsx(unsupported, { fidelity: "strict" })).rejects.toBeInstanceOf(OutputFidelityError);
    await expect(renderPlanToPdf(unsupported, { fidelity: "strict" })).rejects.toMatchObject({ code: "output-fidelity", diagnostics: expect.arrayContaining([expect.objectContaining({ code: "missing-image", nid: "missing-chart" })]) });
    expect(() => renderPlan(unsupported, document, { fidelity: "strict" })).toThrow(OutputFidelityError);
  });
});
