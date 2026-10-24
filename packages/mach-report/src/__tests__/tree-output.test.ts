import { afterEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { PDFDocument, PDFPage } from "pdf-lib";
import { paginateTemplate, type ReportTemplate } from "../layout/paginate";
import { renderPlan } from "../render/dom";
import { renderPlanToCanvas } from "../render/canvas";
import { renderPlanToPdf } from "../pdf/render-pdf";
import { renderPlanToXlsx } from "../xlsx/render-xlsx";
import { validateRenderPlan } from "../schema/validate";

function fixture() {
  const template: ReportTemplate = { pages: [{ widthMm: 105, heightMm: 30, components: [{ kind: "list", dataset: "cost", leftMm: 2, topMm: 2, widthMm: 100, rowHeightMm: 7, columns: [{ field: "name", header: "Item", widthMm: 60, align: "center" }, { field: "amount", header: "Amount", widthMm: 40 }], tree: { input: "nested", idField: "id", labelField: "name", parentValues: "leaf-aggregate", indentMm: 3, aggregates: [{ field: "amount", op: "sum", numeric: "decimal", digits: 2 }] }, grandTotal: { aggregates: [{ field: "amount", op: "sum", numeric: "decimal", digits: 2 }] } }] }] };
  const datasets = { cost: [{ id: "P", name: "Root", amount: "999", children: [{ id: "M", name: "Middle", amount: "888", children: [{ id: "A", name: "Leaf A", amount: "0.10" }, { id: "B", name: "Leaf B", amount: "0.20" }] }] }] };
  return paginateTemplate(template, datasets).plan;
}
afterEach(() => vi.restoreAllMocks());
describe("hierarchy fidelity through real outputs", () => {
  it("keeps raw labels unchanged while DOM left insets follow depth across pages", () => {
    const plan = fixture(), root = renderPlan(plan, document);
    const cells = [...root.querySelectorAll<HTMLElement>('[role="cell"]')];
    const leaf = cells.find(cell => cell.textContent === "Leaf A")!;
    const parent = cells.find(cell => cell.textContent === "Root")!;
    expect(parseFloat((leaf.querySelector(".mr-cell-content") as HTMLElement).style.left) - parseFloat((parent.querySelector(".mr-cell-content") as HTMLElement).style.left)).toBeCloseTo(6 * 96 / 25.4, 2);
    expect(leaf.style.textAlign).toBe("left");
    expect(validateRenderPlan(JSON.parse(JSON.stringify(plan))).ok).toBe(true);
    const invalid = JSON.parse(JSON.stringify(plan)); invalid.pages[0].components[1].grid.cells[0][0].indentMm = -1;
    expect(validateRenderPlan(invalid).ok).toBe(false);
  });
  it("reads back a continuous workbook with all nodes once, exact decimals and native indentation", async () => {
    const plan = fixture(); expect(plan.pages.length).toBeGreaterThan(1);
    const result = await renderPlanToXlsx(plan, { valueMode: "raw", sheetMode: "continuous" });
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(result.buffer);
    expect(result.warnings).toEqual([]); expect(workbook.worksheets).toHaveLength(1);
    const sheet = workbook.worksheets[0]!;
    const values: unknown[][] = [];
    sheet.eachRow(row => { if (["Root", "Middle", "Leaf A", "Leaf B", "合计"].includes(String(row.getCell(1).value))) values.push([row.getCell(1).value, row.getCell(2).value, row.getCell(1).alignment.indent ?? 0]); });
    expect(values).toEqual([["Root", "0.30", 0], ["Middle", "0.30", 1], ["Leaf A", "0.10", 2], ["Leaf B", "0.20", 2], ["合计", "0.30", 0]]);
  });
  it("encodes a real PDF with physical text offsets matching the planned tree indentation", async () => {
    const drawText = vi.spyOn(PDFPage.prototype, "drawText");
    const plan = fixture(), result = await renderPlanToPdf(plan);
    const bytes = result.bytes, pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(plan.pages.length);
    const root = drawText.mock.calls.find(call => call[0] === "Root")!, leaf = drawText.mock.calls.find(call => call[0] === "Leaf A")!;
    expect(root).toBeDefined(); expect(leaf).toBeDefined();
    expect(leaf[1]!.x! - root[1]!.x!).toBeCloseTo(6 * 72 / 25.4, 3);
    expect(result.fidelityWarnings).toEqual([]);
  });
  it("passes identical physical indentation to the Canvas text drawing backend", () => {
    const calls: Array<{ text: string; x: number }> = [];
    const context = { font: "", fillStyle: "", textAlign: "", textBaseline: "", scale() {}, fillRect() {}, beginPath() {}, rect() {}, clip() {}, moveTo() {}, lineTo() {}, stroke() {}, setLineDash() {}, save() {}, restore() {}, fillText(text: string, x: number) { calls.push({ text, x }); } };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
    renderPlanToCanvas(fixture(), { dpr: 1 });
    expect(calls.find(call => call.text === "Leaf A")!.x - calls.find(call => call.text === "Root")!.x).toBeCloseTo(6 * 96 / 25.4, 3);
  });
});
