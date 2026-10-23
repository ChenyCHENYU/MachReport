// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from "pdf-lib";
import { outputDiagnostics } from "../server/runtime-output";
import { Writable } from "node:stream";
import { createImageMediaInspector } from "../output/media";
import { renderPlanToPdf } from "../pdf/render-pdf";
import { renderPlanToXlsx } from "../xlsx/render-xlsx";
import { importExcelTemplate } from "../xlsx/import-template";
import { preflightExcelEntries } from "../xlsx/import-preflight";
import { ImportWarnings, resolveImportOptions } from "../xlsx/import-types";
import { writeRowsToXlsx } from "../xlsx/node";
import { createTableTemplate } from "../builder/table-template";
import { paginateTemplate } from "../layout/paginate";
import type { PlanComponent, RenderPlan } from "../schema/render-plan";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const makePart = (extra: Partial<PlanComponent>): PlanComponent => ({ kind: "text", leftMm: 1, topMm: 1, widthMm: 50, heightMm: 15, ...extra });
const plan = (...components: PlanComponent[]): RenderPlan => ({ schemaVersion: "test", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components }] });
describe("output integrity and bounded work", () => {
  it("strict PDF rejects missing glyphs and corrupt media; warnings are structured for permissive consumers", async () => {
    const missing = plan(makePart({ text: "ASCII 和中文" }));
    await expect(renderPlanToPdf(missing, { fidelity: "strict" })).rejects.toMatchObject({ code: "output-fidelity", diagnostics: [expect.objectContaining({ code: "unsupported-text" })] });
    const oversizedPage = plan(); oversizedPage.pages[0]!.pageWidthMm = 5081;
    await expect(renderPlanToPdf(oversizedPage, { fidelity: "strict" })).rejects.toMatchObject({ code: "output-fidelity", diagnostics: [expect.objectContaining({ code: "output-degraded", kind: "page", componentIndex: -1 })] });
    const pageResult = await renderPlanToPdf(oversizedPage);
    expect(outputDiagnostics(pageResult.diagnostics)).toMatchObject([{ code: "output-degraded", path: "$.pages.0" }]);
    const diagnostic = vi.fn();
    const damaged = plan(makePart({ kind: "image", imageData: "data:image/png;base64,AAAA" }));
    await expect(renderPlanToPdf(damaged, { fidelity: "strict" })).rejects.toMatchObject({ code: "output-fidelity", diagnostics: [expect.objectContaining({ code: "invalid-image-data" })] });
    const result = await renderPlanToPdf(damaged, { onDiagnostic: diagnostic });
    expect(outputDiagnostics(result.diagnostics)).toMatchObject([{ code: "invalid-image-data", path: "$.pages.0.components.0" }]);
    expect(result.pageErrors).toHaveLength(1); expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({ code: "invalid-image-data" }));
  });
  it("normalizes MIME and applies byte/pixel limits to existing images before PDF decoding", async () => {
    const media = plan(makePart({ kind: "image", imageData: PNG }), makePart({ kind: "image", imageData: PNG.replace("image/png", "image/PNG") }));
    const result = await renderPlanToPdf(media, { fidelity: "strict", maxImages: 1, maxTotalImagePixels: 1 });
    expect(result.diagnostics).toEqual([]); expect(result.fidelityWarnings).toEqual([]);
    await expect(renderPlanToPdf(media, { maxImageBytes: 1 })).rejects.toMatchObject({ code: "image-budget-exceeded" });
    const bytes = Buffer.from(PNG.split(",")[1]!, "base64"); bytes.writeUInt32BE(100000, 16);
    const oversized = `data:image/png;base64,${bytes.toString("base64")}`;
    expect(() => createImageMediaInspector()(oversized)).toThrow(/pixel budget/);
    await expect(renderPlanToXlsx(plan(makePart({ kind: "image", imageData: oversized })))).rejects.toMatchObject({ code: "image-budget-exceeded" });
  });
  it("keeps successful streaming output when batch/final observers throw or reject", async () => {
    for (const observer of [() => { throw new Error("observer"); }, async () => { throw new Error("observer"); }]) {
      const chunks: Buffer[] = [], stream = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
      await expect(writeRowsToXlsx([{ id: "001" }, { id: "002" }], { stream, columns: [{ key: "id" }], batchSize: 1, onProgress: observer })).resolves.toMatchObject({ rowsWritten: 2 });
      const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.concat(chunks) as unknown as ExcelJS.Buffer);
      expect(workbook.worksheets[0]!.getCell("A3").value).toBe("002");
    }
  });
  it("yields before a single continuous wide sheet is fully written and honors early cancellation", async () => {
    const template = createTableTemplate({ layout: "wide", columns: Array.from({ length: 82 }, (_, index) => ({ field: `c${index}`, header: `c${index}` })) });
    const detail = Array.from({ length: 2000 }, (_, row) => Object.fromEntries(Array.from({ length: 82 }, (_, index) => [`c${index}`, row])));
    const input = paginateTemplate(template, { detail }).plan, controller = new AbortController(), progress = vi.fn();
    const timer = setTimeout(() => controller.abort(new Error("stop between chunks")), 0);
    await expect(renderPlanToXlsx(input, { signal: controller.signal, onProgress: progress })).rejects.toThrow("stop between chunks");
    clearTimeout(timer); expect(progress).not.toHaveBeenCalled();
  });
  it("preserves indexed colors beyond 15 and reports explicit system/unknown fallback", async () => {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Colors");
    for (const [index, color] of [22, 40, 63, 64, 999].entries()) {
      const cell = sheet.getCell(1, index + 1); cell.value = "Color"; cell.fill = { type: "pattern", pattern: "solid", fgColor: { indexed: color } as Partial<ExcelJS.Color> };
    }
    const imported = await importExcelTemplate(new Uint8Array(await workbook.xlsx.writeBuffer()));
    const cells = (imported.template.pages[0]!.components[0] as PlanComponent).grid!.cells[0]!;
    expect(cells.map(cell => cell?.style?.backgroundColor)).toEqual(["#C0C0C0", "#00CCFF", "#333333", "#000000", undefined]);
    expect(imported.warnings).toEqual([expect.stringContaining("Colors!D1"), expect.stringContaining("Colors!E1")]);
  });
});

describe("business template visual content", () => {
  it("imports PNG drawing geometry and reexports as an overlay without shifting data rows", async () => {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Logo");
    sheet.columns = [{ width: 25 }, { width: 25 }];
    for (let row = 1; row <= 8; row++) sheet.addRow([String(row).padStart(3, "0"), row]);
    const id = workbook.addImage({ base64: PNG, extension: "png" });
    sheet.addImage(id, { tl: { col: 0, row: 0 }, ext: { width: 32, height: 32 } });
    sheet.addImage(id, { tl: { col: 1, row: 0 }, ext: { width: 32, height: 32 } });
    const imported = await importExcelTemplate(new Uint8Array(await workbook.xlsx.writeBuffer()));
    expect(imported.warnings).toEqual([]);
    const images = imported.template.pages[0]!.components.filter((part): part is PlanComponent => part.kind === "image");
    const image = images[0]!;
    expect(new Set(images.map(part => part.nid)).size).toBe(2);
    expect(image.widthMm).toBeCloseTo(32 * 25.4 / 96); expect(image.topMm).toBe(0); expect(image.imageData).toBe(PNG);
    const result = await renderPlanToXlsx(paginateTemplate(imported.template, {}).plan, { fidelity: "strict" });
    const read = new ExcelJS.Workbook(); await read.xlsx.load(result.buffer);
    expect(read.worksheets[0]!.rowCount).toBe(8); expect(read.worksheets[0]!.getCell("A8").value).toBe("008");
    expect(read.worksheets[0]!.getImages()[0]!.range.tl).toMatchObject({ nativeCol: 0, nativeRow: 0 });
    image.leftMm += 5; image.topMm += 8;
    const moved = await renderPlanToXlsx(paginateTemplate(imported.template, {}).plan, { fidelity: "strict" });
    const movedWorkbook = new ExcelJS.Workbook(); await movedWorkbook.xlsx.load(moved.buffer);
    expect(movedWorkbook.worksheets[0]!.getImages()[0]!.range.tl).toMatchObject({ nativeCol: 0, nativeColOff: 180000, nativeRow: 1 });
    expect(movedWorkbook.worksheets[0]!.rowCount).toBe(8);
  });
  it.each([{ col: 0, row: 2 }, { col: 1, row: 0 }])("reports an image whose top-left anchor touches the excluded range boundary %j", async (tl) => {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Boundary");
    sheet.addRows([["one"], ["two"]]); sheet.getColumn(1).width = 30;
    const id = workbook.addImage({ base64: PNG, extension: "png" });
    sheet.addImage(id, { tl, ext: { width: 8, height: 8 } });
    const imported = await importExcelTemplate(new Uint8Array(await workbook.xlsx.writeBuffer()), { range: "A1:A2" });
    expect(imported.template.pages[0]!.components.some(part => part.kind === "image")).toBe(false);
    expect(imported.warnings).toEqual([expect.stringContaining("Boundary: 图片 0 不在完整选区内")]);
  });
  it("retains an image whose bottom-right anchor touches the selected range boundary", async () => {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Included");
    sheet.addRows([["one"], ["two"]]); sheet.getColumn(1).width = 30;
    const id = workbook.addImage({ base64: PNG, extension: "png" });
    sheet.addImage(id, "A1:A2");
    const imported = await importExcelTemplate(new Uint8Array(await workbook.xlsx.writeBuffer()), { range: "A1:A2" });
    expect(imported.template.pages[0]!.components.some(part => part.kind === "image")).toBe(true);
    expect(imported.warnings).toEqual([]);
  });
  it.each(["top", "middle", "bottom"] as const)("retains rich paragraph vertical alignment %s in the encoded PDF", async verticalAlign => {
    const input = plan(makePart({ heightMm: 50, style: { verticalAlign, fontSize: 10, lineHeight: 1.2 }, richParagraphs: [
      { spaceBeforeMm: 1, spaceAfterMm: 1, segments: [{ text: "First " }, { text: "LARGE", style: { fontSize: 20 } }] },
      { spaceBeforeMm: 2, spaceAfterMm: 3, lineHeight: 1.5, segments: [{ text: "Second" }] }
    ] }));
    const result = await renderPlanToPdf(input, { fidelity: "strict" });
    expect(result.diagnostics).toEqual([]);
    const document = await PDFDocument.load(result.bytes), streams = document.getPage(0).node.Contents();
    if (!(streams instanceof PDFArray)) throw new Error("Expected encoded page content streams");
    const content = Array.from({ length: streams.size() }, (_, index) => streams.lookup(index, PDFRawStream)).map(stream => new TextDecoder().decode(decodePDFRawStream(stream).decode())).join("\n");
    const baselines = [...content.matchAll(/1 0 0 1 [\d.-]+ ([\d.-]+) Tm/g)].map(match => Number(match[1]));
    const pt = 72 / 25.4, totalHeight = 24 + 15 + 7 * pt;
    const offset = verticalAlign === "middle" ? (50 * pt - totalHeight) / 2 : verticalAlign === "bottom" ? 50 * pt - totalHeight : 0;
    const first = 99 * pt - offset - pt - 20;
    expect(baselines).toHaveLength(3);
    expect(baselines[0]).toBeCloseTo(first); expect(baselines[1]).toBeCloseTo(first);
    expect(baselines[2]).toBeCloseTo(first - 14 - 3 * pt);
  });
  it("reports unsupported drawing transforms while allowing ordinary embedded logos", async () => {
    const xml = new TextEncoder().encode('<xdr:wsDr><xdr:pic><a:srcRect l="1000"/><a:xfrm rot="5400000" flipH="1"/><a:blip r:link="rId2"/></xdr:pic><xdr:sp/></xdr:wsDr>');
    const warnings = new ImportWarnings();
    await preflightExcelEntries(xml, [{ name: "xl/drawings/drawing1.xml", start: 0, compressed: xml.length, method: 0 }], resolveImportOptions({}), {}, warnings);
    expect(warnings.result()).toEqual([expect.stringContaining("裁剪"), expect.stringContaining("旋转或翻转"), expect.stringContaining("外部图片"), expect.stringContaining("连接线")]);
  });
  it("retains basic rich run fonts in Excel and draws rich PDF fonts without flattening", async () => {
    const input = plan(makePart({ heightMm: 25, richParagraphs: [{ segments: [{ text: "Sales ", style: { bold: true, color: "#123456" } }, { text: "42", style: { italic: true, underline: true, fontSize: 14 } }] }, { segments: [{ text: "Details" }] }] }));
    const xlsx = await renderPlanToXlsx(input, { fidelity: "strict" });
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(xlsx.buffer);
    expect(workbook.worksheets[0]!.getCell("A1").value).toMatchObject({ richText: [{ text: "Sales ", font: { bold: true, color: { argb: "FF123456" } } }, { text: "42", font: { italic: true, underline: true, size: 14 } }, { text: "\n" }, { text: "Details" }] });
    const pdf = await renderPlanToPdf(input, { fidelity: "strict" });
    expect(pdf.unsupportedTextCount).toBe(0); expect(pdf.diagnostics).toEqual([]); expect(pdf.bytes.length).toBeGreaterThan(800);
    const narrow = plan(makePart({ widthMm: 10, heightMm: 1, richParagraphs: [{ segments: [{ text: "Very long detail text" }] }] }));
    await expect(renderPlanToPdf(narrow, { fidelity: "strict" })).rejects.toMatchObject({ code: "output-fidelity", diagnostics: [expect.objectContaining({ code: "output-degraded" })] });
  });
});
