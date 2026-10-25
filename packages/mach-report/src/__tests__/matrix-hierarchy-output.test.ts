// @vitest-environment node
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { paginateTemplate, paginateTemplatePages, type ListComponent, type ReportTemplate } from "../layout/paginate";
import { renderPlanToPdf } from "../pdf/render-pdf";
import { renderPlanToXlsx } from "../xlsx";
import { validateRenderPlan } from "../schema/validate";

function matrix(): ListComponent {
  return { kind: "list", id: "matrix", dataset: "rows", layout: "wide", leftMm: 5, topMm: 5, widthMm: 150, rowHeightMm: 7,
    columns: [{ field: "plant", header: "Plant", widthMm: 30 }], headerAlign: "center",
    matrix: { rowFields: ["plant", "grade"], columnFields: ["year", "month"], measures: [{ field: "value", label: "Value", op: "sum" }],
      hierarchy: { row: { labels: ["Plant", "Grade"], sort: ["asc", "asc"], subtotals: [1] }, column: { sort: ["asc", "asc"], subtotals: [1] }, subtotalLabel: "Subtotal" } } };
}
const rows = [
  { plant: "A", grade: "G1", year: 2026, month: 1, value: 0 },
  { plant: "A", grade: "G2", year: 2026, month: 2, value: 10 },
  { plant: "B", grade: "G1", year: 2026, month: 2, value: 20 },
];
function source(): ReportTemplate { return { pages: [{ widthMm: 160, heightMm: 55, layout: "wide", components: [matrix()] }] }; }
async function pdfText(plan: ReturnType<typeof paginateTemplate>["plan"]): Promise<string> {
  const exported = await renderPlanToPdf(plan); expect(exported.pageErrors).toEqual([]);
  const document = await PDFDocument.load(exported.bytes); expect(document.getPageCount()).toBe(plan.pages.length);
  expect(document.getPage(0).getWidth()).toBeCloseTo(plan.pages[0]!.pageWidthMm * 72 / 25.4);
  const streams: string[] = [];
  document.context.enumerateIndirectObjects().forEach(([, object]) => { if (object instanceof PDFRawStream) streams.push(Buffer.from(decodePDFRawStream(object).decode()).toString("latin1")); });
  return streams.join(" ").toUpperCase();
}
describe("hierarchical matrix actual delivery", () => {
  it("preserves merged row/column headers, repeated-header deduplication, zero and subtotals in an actual XLSX", async () => {
    const plan = paginateTemplate(source(), { rows }).plan;
    expect(plan.pages.length).toBeGreaterThan(1); expect(validateRenderPlan(plan).ok).toBe(true);
    const exported = await renderPlanToXlsx(plan, { sheetMode: "continuous", valueMode: "raw" });
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(exported.buffer);
    const sheet = workbook.worksheets[0]!;
    expect(workbook.worksheets).toHaveLength(1); expect(sheet.rowCount).toBe(8);
    expect(sheet.model.merges).toEqual(expect.arrayContaining(["A1:A3", "B1:B3", "C1:E1"]));
    expect(sheet.getCell("C2").value).toBe("1"); expect(sheet.getCell("E2").value).toBe("Subtotal");
    expect(sheet.getCell("C3").value).toBe("Value"); expect(sheet.getCell("C4").value).toBe(0);
    expect(sheet.getCell("D6").value).toBe(10); expect(sheet.getCell("E6").value).toBe(10);
    expect(sheet.getCell("E8").value).toBe(20); expect(sheet.getCell("B8").value).toBe("Subtotal");
  });
  it("encodes physical hierarchical headers and subtotal values into parseable PDF pages", async () => {
    const document = source(), component = document.pages[0]!.components[0] as ListComponent;
    component.matrix!.totals = true; component.matrix!.hierarchy!.totalLabel = "Total";
    const plan = paginateTemplate(document, { rows }).plan;
    const text = await pdfText(plan);
    for (const label of ["2026", "Plant", "Grade", "Value", "Subtotal", "Total", "10", "20", "30", "0"]) expect(text).toContain(Buffer.from(label).toString("hex").toUpperCase());
  });
  it("composes a matrix, grouped detail region and page footer using the existing flow model", async () => {
    const pivot = matrix(); pivot.layout = undefined; pivot.widthMm = 150;
    const detail: ListComponent = { kind: "list", id: "detail", dataset: "detail", leftMm: 5, topMm: 25, widthMm: 150, rowHeightMm: 7,
      columns: [{ field: "item", header: "Item", widthMm: 100 }, { field: "amount", header: "Amount", widthMm: 50 }],
      groups: [{ field: "group", headerTemplate: "Group {value}", repeatHeader: true, aggregates: [{ field: "amount", op: "sum" }], subtotalLabel: "Group total" }],
      grandTotal: { label: "All", aggregates: [{ field: "amount", op: "sum" }] } };
    const template: ReportTemplate = { pages: [{ widthMm: 160, heightMm: 80, marginTopMm: 5, marginBottomMm: 5,
      components: [pivot, detail, { kind: "text", nid: "end", leftMm: 5, topMm: 35, widthMm: 150, heightMm: 5, text: "End" },
        { kind: "text", nid: "footer", pageAnchor: "footer", leftMm: 5, topMm: 72, widthMm: 150, heightMm: 3, text: "Page {page}" }],
      flow: { bands: [{ componentIds: ["matrix"], topMm: 5, heightMm: 7 }, { componentIds: ["detail"], topMm: 25, heightMm: 7 }, { componentIds: ["end"], topMm: 35, heightMm: 5 }] } }] };
    const data = { rows, detail: Array.from({ length: 20 }, (_, index) => ({ item: `I${index}`, amount: index, group: index < 12 ? "A" : "B" })) };
    const result = paginateTemplate(template, data);
    expect(result.warnings).toEqual([]); expect(validateRenderPlan(result.plan).ok).toBe(true);
    expect([...paginateTemplatePages(template, data)]).toEqual(result.plan.pages);
    const fragments = result.plan.pages.flatMap(page => page.components);
    expect(fragments.filter(item => item.meta?.matrix && item.table?.role === "subtotal")).toHaveLength(2);
    expect(fragments.filter(item => item.table?.role === "body" && item.table.columnKeys[0] === "item")).toHaveLength(20);
    expect(fragments.some(item => item.table?.role === "grand-total" && item.grid?.cells[0]?.some(cell => cell?.value === 190))).toBe(true);
    for (const page of result.plan.pages) {
      expect(page.components.filter(item => item.nid === "footer")).toHaveLength(1);
      for (const component of page.components.filter(item => item.table)) expect(component.topMm + component.heightMm).toBeLessThanOrEqual(72.001);
    }
    const detailHeaders = fragments.filter(item => item.table?.role === "header" && item.table.columnKeys[0] === "item");
    expect(detailHeaders.length).toBeGreaterThan(1);
    expect(fragments.filter(item => item.table?.role === "group-header" && item.grid?.cells[0]?.[0]?.text === "Group A").length).toBeGreaterThan(1);
    const endPage = result.plan.pages[result.plan.pages.length - 1]!;
    expect(endPage.components.find(item => item.nid === "end")).toBeDefined();
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load((await renderPlanToXlsx(result.plan, { sheetMode: "pages", valueMode: "raw" })).buffer);
    const values: unknown[] = []; for (const sheet of workbook.worksheets) sheet.eachRow(row => row.eachCell(cell => { values.push(cell.value); }));
    expect(values).toContain(190); expect(values).toContain("I19"); expect(values).toContain("Subtotal");
    expect(await pdfText(result.plan)).toContain(Buffer.from("I19").toString("hex").toUpperCase());
  });
});
