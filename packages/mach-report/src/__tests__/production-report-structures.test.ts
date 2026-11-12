// @vitest-environment node
import { Window } from "happy-dom";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { productionSnapshot as snapshot, structureWorkbookFixture, EXACT_STRUCTURE_DECIMAL as exact } from "./fixtures/production-report-corpus";
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from "pdf-lib";
import { importExcelTemplate } from "../xlsx/import-template";
import { renderPlanToXlsx } from "../xlsx/render-xlsx";
import { renderPlanToPdf } from "../pdf/render-pdf";
import { paginateTemplate } from "../layout/paginate";
import { renderPlan } from "../render/dom";


function extractedText(document: PDFDocument): string {
  const texts: string[] = [];
  for (const page of document.getPages()) {
    const streams = page.node.Contents() as PDFArray;
    for (let index = 0; index < streams.size(); index++) {
      const stream = document.context.lookup(streams.get(index));
      if (!(stream instanceof PDFRawStream)) continue;
      const content = new TextDecoder().decode(decodePDFRawStream(stream).decode());
      for (const match of content.matchAll(/<([A-Fa-f0-9]+)>\s+Tj/g)) texts.push(Buffer.from(match[1]!, "hex").toString("latin1"));
    }
  }
  return texts.join("");
}

describe("six production report structure snapshots (synthetic values, independent of business mapping)", () => {
  it("pins all 312 daily columns and 40 morning metrics, with honest source boundaries", () => {
    expect(snapshot.provenance).toMatchObject({ originalWorkbookAvailable: false, businessMappingVerified: false, allValuesSynthetic: true });
    expect(snapshot.reports.map(report => report.columns.length)).toEqual([55, 66, 70, 82, 39, 0]);
    expect(snapshot.reports[5]!.metrics).toHaveLength(40);
    expect(snapshot.reports.flatMap(report => report.columns).every(column => column.label && column.cell)).toBe(true);
  });

  it.each(snapshot.reports)("replays $id through real XLSX import, DOM, strict PDF and XLSX readback", async report => {
    const source = await structureWorkbookFixture(report);
    const imported = await importExcelTemplate(source.bytes, { maxRowsPerPage: 8 });
    expect(imported.warnings).toEqual([]);
    const plan = paginateTemplate(imported.template, {}).plan;
    const window = new Window();
    try {
      const output = renderPlan(plan, window.document as unknown as Document);
      expect(output.querySelectorAll("td")).toHaveLength((source.rows.length + 1) * source.headers.length);
      expect(output.textContent).toContain("0000123");
      expect(output.textContent).toContain(exact);
      expect(output.textContent).not.toContain("null");
      expect([...output.querySelectorAll<HTMLElement>("td")].every(cell => cell.style.textAlign === "center")).toBe(true);
    } finally { await window.happyDOM.close(); }
    const pdf = await renderPlanToPdf(plan, { fidelity: "strict" });
    expect(pdf.diagnostics).toEqual([]);
    const document = await PDFDocument.load(pdf.bytes);
    expect(document.getPageCount()).toBe(plan.pages.length);
    const text = extractedText(document);
    expect(text).toContain("0000123");
    expect(text).toContain(exact);
    expect(text).not.toContain("null");
    const exported = await renderPlanToXlsx(plan, { fidelity: "strict", valueMode: "raw" });
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(exported.buffer);
    expect(workbook.worksheets).toHaveLength(1);
    const sheet = workbook.worksheets[0]!;
    expect(sheet.columnCount).toBe(source.headers.length);
    for (const [rowIndex, row] of source.rows.entries()) for (const [columnIndex, value] of row.entries()) expect(sheet.getCell(rowIndex + 2, columnIndex + 1).value).toBe(value);
  });
});
