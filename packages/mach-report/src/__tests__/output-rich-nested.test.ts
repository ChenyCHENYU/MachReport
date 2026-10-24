// @vitest-environment node
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { renderPlanToPdf } from "../pdf/render-pdf";
import { renderPlanToXlsx } from "../xlsx/render-xlsx";
import { importExcelTemplate } from "../xlsx/import-template";
import { paginateTemplate } from "../layout/paginate";
import { inspectOutputCapabilities } from "../output/capabilities";
import { validateRenderPlan } from "../schema/validate";
import type { PlanComponent, RenderPlan } from "../schema/render-plan";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const text: PlanComponent = { kind: "text", leftMm: 0, topMm: 0, widthMm: 30, heightMm: 12, text: "Nested", style: { bold: true, color: "#123456" } };
const image: PlanComponent = { kind: "image", leftMm: 12, topMm: 6, widthMm: 5, heightMm: 5, imageData: PNG };
function plan(children: PlanComponent[] = [text, image]): RenderPlan { return { schemaVersion: "nested", pages: [{ pageWidthMm: 210, pageHeightMm: 297, components: [{ kind: "rect", leftMm: 10, topMm: 20, widthMm: 60, heightMm: 30, grid: { paddingMm: 2, cells: [[{ children }]], colWidthsMm: [60], rowHeightsMm: [30] } }] }] }; }
async function content(bytes: Uint8Array): Promise<string> {
 const document = await PDFDocument.load(bytes), streams = document.getPage(0).node.Contents();
 if (!(streams instanceof PDFArray)) throw new Error("Expected page content");
 return Array.from({ length: streams.size() }, (_, index) => streams.lookup(index, PDFRawStream)).map(stream => new TextDecoder().decode(decodePDFRawStream(stream).decode())).join("\n");
}
describe("native rich cells and nested output", () => {
 it("encodes nested text/images in PDF with cell clipping and absolute child coordinates", async () => {
  const result = await renderPlanToPdf(plan(), { fidelity: "strict" });
  expect(result.diagnostics).toEqual([]);
  const stream = await content(result.bytes);
  expect(stream).toContain("<4E6573746564> Tj"); expect(stream).toMatch(/re\s+W\s+n/); expect(stream).toMatch(/\/Image-[^ ]+ Do/);
  const matrix = /1 0 0 1 ([\d.]+) ([\d.]+) Tm/.exec(stream)!;
  expect(Number(matrix[1])).toBeCloseTo(12 * 72 / 25.4);
  expect(Number(matrix[2])).toBeCloseTo((297 - 22) * 72 / 25.4 - 10.5);
 });
 it("keeps native Excel rich child text and image anchors without extra rows", async () => {
  const result = await renderPlanToXlsx(plan(), { fidelity: "strict" });
  const read = new ExcelJS.Workbook(); await read.xlsx.load(result.buffer);
  const sheet = read.worksheets[0]!;
  expect(sheet.rowCount).toBe(1); expect(sheet.getCell("A1").value).toMatchObject({ richText: [{ text: "Nested", font: { bold: true, color: { argb: "FF123456" } } }] });
  expect(sheet.getImages()[0]!.range.tl).toMatchObject({ nativeCol: 0, nativeRow: 0, nativeColOff: 14 * 36000, nativeRowOff: 8 * 36000 });
 });
 it("preserves mixed Excel font runs through import, readonly rendering and real workbook reexport", async () => {
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Rich"); sheet.getColumn(1).width = 40; sheet.getRow(1).height = 45;
  sheet.getCell("A1").font = { name: "Helvetica", size: 10 };
  sheet.getCell("A1").value = { richText: [{ text: "Value ", font: { bold: true, name: "Helvetica", size: 12, color: { argb: "FF123456" } } }, { text: "42", font: { italic: true, underline: true, name: "Helvetica", size: 14 } }] };
  const imported = await importExcelTemplate(new Uint8Array(await workbook.xlsx.writeBuffer()));
  const input = paginateTemplate(imported.template, {}).plan, cell = input.pages[0]!.components[0]!.grid!.cells[0]![0]!;
  expect(imported.warnings).toEqual([]); expect(cell).toMatchObject({ text: "Value 42", value: "Value 42", editable: false, richParagraphs: [{ segments: [{ text: "Value ", style: { bold: true, color: "#123456" } }, { text: "42", style: { italic: true, underline: true } }] }] });
  const exported = await renderPlanToXlsx(input, { fidelity: "strict" }), read = new ExcelJS.Workbook(); await read.xlsx.load(exported.buffer);
  const original = sheet.getCell("A1").value;
  if (!original || typeof original !== "object" || !("richText" in original)) throw new Error("Expected rich fixture");
  expect(read.worksheets[0]!.getCell("A1").value).toMatchObject(original);
  const pdf = await renderPlanToPdf(input, { fidelity: "strict" }); expect(pdf.diagnostics).toEqual([]); expect(await content(pdf.bytes)).toContain("<3432> Tj");
 });
 it("retains exact diagnostics for unrepresentable nested XLSX grids, offsets and image clipping", async () => {
  const input = plan([{ ...text, topMm: 3 }, { ...image, widthMm: 100 }, plan().pages[0]!.components[0]!]);
  const diagnostics = inspectOutputCapabilities(input, "xlsx");
  expect(diagnostics.map(entry => entry.code)).toEqual(["unsupported-style", "unsupported-style", "nested-components-omitted"]);
  expect(diagnostics.map(entry => entry.componentPath)).toEqual([[0, 0, 0], [0, 0, 1], [0, 0, 2]]);
  await expect(renderPlanToXlsx(input, { fidelity: "strict" })).rejects.toMatchObject({ code: "output-fidelity" });
 });
 it("retains nested cell and child paths for unsupported rich styles", () => {
  const input = plan([{ ...text, richParagraphs: [{ segments: [{ text: "Child", style: { opacity: 0.5 } }] }] }]);
  input.pages[0]!.components[0]!.grid!.cells[0]![0]!.richParagraphs = [{ segments: [{ text: "Cell", style: { rotateDeg: 20 } }] }];
  const diagnostics = inspectOutputCapabilities(input, "pdf");
  expect(diagnostics.map(entry => ({ code: entry.code, path: entry.componentPath }))).toEqual([
   { code: "unsupported-style", path: [0, 0] }, { code: "unsupported-style", path: [0, 0, 0] }
  ]);
 });
 it("rejects malformed rich segments, text scalars and styles during plan validation", () => {
  const values = [null, "text", { text: 42 }, { field: {} }, { kind: "unknown" }, { style: null }, { style: [] }, { style: { fontSize: NaN } }, { style: { color: 1 } }, { style: { bold: "yes" } }];
  for (const segment of values) {
   const input = plan([]);
   const cell = input.pages[0]!.components[0]!.grid!.cells[0]![0]!;
   Object.assign(cell, { richParagraphs: [{ segments: [segment] }] });
   const result = validateRenderPlan(input);
   expect(result.ok).toBe(false);
   expect(result.errors[0]!.path).toContain("grid.cells.0.0.richParagraphs.0.segments.0");
  }
  const input = plan([]); Object.assign(input.pages[0]!.components[0]!, { richParagraphs: [{ align: "invalid", segments: [] }] });
  expect(validateRenderPlan(input)).toMatchObject({ ok: false });
 });
 it("rejects XLSX child backgrounds and independent alignment instead of silently flattening them", async () => {
  const input = plan([{ ...text, style: { align: "right", backgroundColor: "#FF0000" } }]);
  const diagnostics = inspectOutputCapabilities(input, "xlsx");
  expect(diagnostics).toEqual([expect.objectContaining({ code: "unsupported-style", componentPath: [0, 0, 0], message: expect.stringContaining("backgroundColor, align") })]);
  await expect(renderPlanToXlsx(input, { fidelity: "strict" })).rejects.toMatchObject({ code: "output-fidelity" });
  const rich = plan([]); rich.pages[0]!.components[0]!.grid!.cells[0]![0]!.richParagraphs = [{ segments: [{ text: "Rich", style: { backgroundColor: "#FF0000", align: "right" } }] }];
  expect(inspectOutputCapabilities(rich, "xlsx")).toEqual([expect.objectContaining({ code: "unsupported-style", componentPath: [0, 0] })]);
  await expect(renderPlanToXlsx(rich, { fidelity: "strict" })).rejects.toMatchObject({ code: "output-fidelity" });
 });
 it("rejects cyclic/deep structures before recursive rendering or image allocation", async () => {
  const cyclic = plan(), root = cyclic.pages[0]!.components[0]!; root.grid!.cells[0]![0]!.children = [root];
  expect(validateRenderPlan(cyclic)).toMatchObject({ ok: false, errors: [expect.objectContaining({ message: expect.stringContaining("循环") })] });
  await expect(renderPlanToPdf(cyclic)).rejects.toThrow(/循环/); await expect(renderPlanToXlsx(cyclic)).rejects.toThrow(/循环/);
  const deep = plan([]); let current = deep.pages[0]!.components[0]!;
  for (let i = 0; i < 66; i++) { const child = plan([]).pages[0]!.components[0]!; current.grid!.cells[0]![0]!.children = [child]; current = child; }
  expect(validateRenderPlan(deep)).toMatchObject({ ok: false, errors: [expect.objectContaining({ message: expect.stringContaining("64") })] });
  await expect(renderPlanToPdf(deep)).rejects.toThrow(/64/);
 });
 it("enforces nested image budgets and aborts before child rendering", async () => {
  await expect(renderPlanToPdf(plan(), { maxImageBytes: 1 })).rejects.toMatchObject({ code: "image-budget-exceeded" });
  const controller = new AbortController(); controller.abort();
  await expect(renderPlanToPdf(plan(), { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
 });
});
