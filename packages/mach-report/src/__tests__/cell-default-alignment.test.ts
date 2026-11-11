import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFPage } from "pdf-lib";
import ExcelJS from "exceljs";
import { renderPlan } from "../render/dom";
import { renderPlanToPdf } from "../pdf/render-pdf";
import { renderPlanToXlsx } from "../xlsx";
import type { ComponentStyle, RenderPlan } from "../schema/render-plan";

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });
function source(style?: ComponentStyle): RenderPlan {
  return { schemaVersion: "cell-alignment", pages: [{ pageWidthMm: 100, pageHeightMm: 80, components: [{
    kind: "rect", leftMm: 10, topMm: 10, widthMm: 80, heightMm: 10, style: { fontSize: 10, ...style },
    grid: { colWidthsMm: [20, 20, 20, 20], rowHeightsMm: [10], paddingMm: 1, cells: [[
      { text: "0", value: 0 }, { text: "-1.250", value: -1.25, numberFormat: "0.000" },
      { text: "001", value: "001", numberFormat: "000" }, { text: "", value: null, valueType: "number", numberFormat: "#,##0.00" }
    ]] }
  }] }] };
}

describe("default data-cell alignment across output backends", () => {
  it("centers raw numeric grids in DOM, real PDF coordinates and reread XLSX without changing source values", async () => {
    const plan = source(), baseline = JSON.stringify(plan);
    const root = renderPlan(plan, document); document.body.append(root);
    expect([...root.querySelectorAll("td")].map(cell => cell.style.textAlign)).toEqual(["center", "center", "left", "center"]);
    expect([...root.querySelectorAll("td")].map(cell => cell.textContent)).toEqual(["0", "-1.250", "001", ""]);
    const draw = vi.spyOn(PDFPage.prototype, "drawText");
    const pdf = await renderPlanToPdf(plan);
    expect(pdf.pageErrors).toEqual([]); expect((await PDFDocument.load(pdf.bytes)).getPageCount()).toBe(1);
    const zero = draw.mock.calls.find(([text]) => text === "0")![1]!;
    expect(zero.x).toBeCloseTo(20 * 72 / 25.4 - zero.font!.widthOfTextAtSize("0", zero.size!) / 2, 4);
    const decimal = draw.mock.calls.find(([text]) => text === "-1.250")![1]!;
    expect(decimal.x).toBeCloseTo(40 * 72 / 25.4 - decimal.font!.widthOfTextAtSize("-1.250", decimal.size!) / 2, 4);
    const code = draw.mock.calls.find(([text]) => text === "001")![1]!;
    expect(code.x).toBeCloseTo(51 * 72 / 25.4, 4);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await renderPlanToXlsx(plan, { valueMode: "raw" })).buffer);
    const row = workbook.worksheets[0]!.getRow(1);
    expect([1, 2, 3, 4].map(index => row.getCell(index).alignment.horizontal)).toEqual(["center", "center", "left", "center"]);
    expect([1, 2, 3].map(index => row.getCell(index).value)).toEqual([0, -1.25, "001"]);
    expect(row.getCell(2).numFmt).toBe("0.000");
    expect(JSON.stringify(plan)).toBe(baseline);
  });
  it("keeps explicit component and cell alignment authoritative in each output", async () => {
    const plan = source({ align: "right" });
    plan.pages[0]!.components[0]!.grid!.cells[0]![1]!.style = { align: "left" };
    const root = renderPlan(plan, document);
    expect([...root.querySelectorAll("td")].map(cell => cell.style.textAlign)).toEqual(["right", "left", "right", "right"]);
    const draw = vi.spyOn(PDFPage.prototype, "drawText");
    expect((await renderPlanToPdf(plan)).pageErrors).toEqual([]);
    const zero = draw.mock.calls.find(([text]) => text === "0")![1]!;
    expect(zero.x).toBeCloseTo(29 * 72 / 25.4 - zero.font!.widthOfTextAtSize("0", zero.size!), 4);
    expect(draw.mock.calls.find(([text]) => text === "-1.250")![1]!.x).toBeCloseTo(31 * 72 / 25.4, 4);
    const output = await renderPlanToXlsx(plan, { valueMode: "raw" });
    expect([1, 2, 3, 4].map(index => output.workbook.worksheets[0]!.getCell(1, index).alignment.horizontal)).toEqual(["right", "left", "right", "right"]);
  });
});
