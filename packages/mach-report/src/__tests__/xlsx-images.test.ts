// @vitest-environment node
import { describe, expect, it } from "vitest";
import ExcelJSRuntime from "exceljs";
import { createTableTemplate } from "../builder/table-template";
import { paginateTemplate } from "../layout/paginate";
import { inspectOutputCapabilities } from "../output/capabilities";
import type { PlanComponent, RenderPlan } from "../schema/render-plan";
import { renderPlanToXlsx } from "../xlsx/render-xlsx";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
// One-pixel RGB JPEG generated locally with Pillow; no external network fixture.
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDmqKKK+sPnj//Z";
const image = (imageData = PNG, extra: Partial<PlanComponent> = {}): PlanComponent => ({ kind: "image", nid: "logo", leftMm: 25, topMm: 5, widthMm: 20, heightMm: 10, imageData, ...extra });
const text = (value: string): PlanComponent => ({ kind: "text", leftMm: 0, topMm: 50, widthMm: 50, heightMm: 8, text: value });
const grid = (widths = [20, 30]): PlanComponent => ({ kind: "rect", leftMm: 0, topMm: 20, widthMm: widths.reduce((a, b) => a + b), heightMm: 6, grid: { colWidthsMm: widths, rowHeightsMm: [6], cells: [[{ text: "00123", value: "00123" }, { text: "0", value: 0 }]] } });
const plan = (...components: PlanComponent[]): RenderPlan => ({ schemaVersion: "image-xlsx", pages: [{ pageWidthMm: 210, pageHeightMm: 297, components }] });
async function read(input: RenderPlan, options: Parameters<typeof renderPlanToXlsx>[1] = {}) {
  const result = await renderPlanToXlsx(input, options), workbook = new ExcelJSRuntime.Workbook();
  await workbook.xlsx.load(result.buffer); return { ...result, workbook };
}
describe("normal XLSX embedded image output", () => {
  it("round-trips PNG/JPEG and image-backed QR with exact media bytes, flow rows and native geometry", async () => {
    const input = plan(image(), grid(), image(PNG, { kind: "qrcode", leftMm: 0, heightMm: 12 }), image(JPEG, { leftMm: 0 }), text("after images"));
    expect(inspectOutputCapabilities(input, "xlsx")).toEqual([]);
    const result = await read(input, { fidelity: "strict", valueMode: "raw" });
    expect(result.warnings).toEqual([]); expect(result.diagnostics).toEqual([]);
    const sheet = result.workbook.worksheets[0]!, placed = sheet.getImages();
    expect(placed).toHaveLength(3); expect(new Set(placed.map((item) => item.imageId)).size).toBe(2);
    const png = result.workbook.getImage(Number(placed[0]!.imageId)), jpeg = result.workbook.getImage(Number(placed[2]!.imageId));
    expect(png.extension).toBe("png"); expect(Buffer.from(png.buffer!)).toEqual(Buffer.from(PNG.split(",")[1]!, "base64"));
    expect(jpeg.extension).toBe("jpeg"); expect(Buffer.from(jpeg.buffer!)).toEqual(Buffer.from(JPEG.split(",")[1]!, "base64"));
    expect(placed[0]!.range.tl).toMatchObject({ nativeCol: 1, nativeColOff: 180_000, nativeRow: 0, nativeRowOff: 0 });
    expect(placed[0]!.range).toHaveProperty("ext.width", expect.closeTo(20 * 96 / 25.4, 3));
    expect(placed[0]!.range).toHaveProperty("ext.height", expect.closeTo(10 * 96 / 25.4, 3));
    expect([1, 2, 3, 4, 5].map((row) => sheet.getRow(row).height)).toEqual([10, 6, 12, 10, 8].map((mm) => mm * 72 / 25.4));
    expect(sheet.getCell("A2").value).toBe("00123"); expect(sheet.getCell("B2").value).toBe(0);
    expect(sheet.getCell("A5").value).toBe("after images");
  });
  it("anchors against final maximum shared column widths even if wider grids occur later", async () => {
    const { workbook } = await read(plan(image(PNG, { leftMm: 35 }), grid(), grid([30, 10])));
    expect(workbook.worksheets[0]!.getImages()[0]!.range.tl).toMatchObject({ nativeCol: 1, nativeColOff: 180_000 });
  });
  it("deduplicates normalized media and budgets unique bytes/count rather than repeated placements", async () => {
    const size = Buffer.from(PNG.split(",")[1]!, "base64").byteLength;
    const same = plan(image(), image(PNG.replace("image/png", "image/PNG")), image(PNG, { kind: "qrcode" }));
    const { workbook } = await read(same, { maxImageBytes: size, maxTotalImageBytes: size, maxImages: 1 });
    const images = workbook.worksheets[0]!.getImages(); expect(images).toHaveLength(3); expect(new Set(images.map((entry) => entry.imageId)).size).toBe(1);
    const aliases = await read(plan(image(JPEG), image(JPEG.replace("image/jpeg", "image/jpg"))), { maxImages: 1 });
    expect(new Set(aliases.workbook.worksheets[0]!.getImages().map((entry) => entry.imageId)).size).toBe(1);
    await expect(renderPlanToXlsx(plan(image()), { maxImageBytes: size - 1 })).rejects.toThrow(/单张图片/);
    await expect(renderPlanToXlsx(plan(image(), image(JPEG)), { maxTotalImageBytes: size })).rejects.toThrow(/总字节/);
    await expect(renderPlanToXlsx(plan(image(), image(JPEG)), { maxImages: 1 })).rejects.toThrow(/唯一图片数量/);
    await expect(renderPlanToXlsx(plan(), { maxImages: 0 })).rejects.toThrow(/预算/);
  });
  it("reserves multiple bounded-height rows so tall images cannot cover following cell data", async () => {
    const { workbook } = await read(plan(image(PNG, { heightMm: 500 }), text("below")));
    const sheet = workbook.worksheets[0]!;
    expect([1, 2, 3].map((row) => sheet.getRow(row).height)).toEqual([409, 409, 409]);
    expect(sheet.getRow(4).height).toBeCloseTo(500 * 72 / 25.4 - 409 * 3, 6);
    expect(sheet.getCell("A5").value).toBe("below");
    await expect(renderPlanToXlsx(plan(image(PNG, { heightMm: 1e12 })))).rejects.toThrow(/行数上限/);
    await expect(renderPlanToXlsx(plan(image(PNG, { leftMm: -1 })))).rejects.toThrow(/尺寸无效/);
    await expect(renderPlanToXlsx(plan(image("data:image/png;base64,eA==")))).rejects.toThrow(/内容与 PNG\/JPEG/);
  });
  it("keeps all 82 columns and 120 rows in one continuous sheet with page anchors emitted once", async () => {
    const template = createTableTemplate({ layout: "wide", title: "Full wide table", listOptions: { rowHeightMm: 6 }, columns: Array.from({ length: 82 }, (_, n) => ({ header: `c${n}`, field: `c${n}`, widthMm: 24 })) });
    const rows = Array.from({ length: 120 }, (_, row) => Object.fromEntries(Array.from({ length: 82 }, (_, col) => [`c${col}`, col ? row * 100 + col : String(row).padStart(5, "0")])));
    const input = paginateTemplate(template, { detail: rows }).plan; expect(input.pages.length).toBeGreaterThan(1);
    for (const page of input.pages) {
      page.components.unshift(image(PNG, { pageAnchor: "header", heightMm: 8 }));
      page.components.push({ ...text("120 rows total"), pageAnchor: "footer" }, image(JPEG, { kind: "qrcode", pageAnchor: "footer", heightMm: 8 }));
    }
    const result = await read(input, { fidelity: "strict" }); expect(result.warnings).toEqual([]);
    expect(result.workbook.worksheets).toHaveLength(1);
    const sheet = result.workbook.worksheets[0]!;
    expect(sheet.rowCount).toBe(125); expect(sheet.columnCount).toBe(82); expect(sheet.getImages()).toHaveLength(2);
    expect(sheet.getCell("A2").value).toBe("Full wide table"); expect(sheet.getCell("A3").value).toBe("c0");
    expect(sheet.getCell("A4").value).toBe("00000"); expect(sheet.getCell("CD123").value).toBe(11981); expect(sheet.getCell("A124").value).toBe("120 rows total");
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 3 });
    const ids: string[] = []; sheet.eachRow((row) => { const value = row.getCell(1).value; if (typeof value === "string" && /^\d{5}$/.test(value)) ids.push(value); });
    expect(ids).toHaveLength(120); expect(new Set(ids).size).toBe(120);
    expect(sheet.getImages()[1]!.range.tl.nativeRow).toBe(124);
  });
  it("reports SVG and blocks strict export before claiming it is supported", async () => {
    const input = plan(image("data:image/svg+xml,%3Csvg/%3E"));
    expect(inspectOutputCapabilities(input, "xlsx")).toEqual([expect.objectContaining({ code: "unsupported-image-format", nid: "logo" })]);
    const fallback = await read(input); expect(fallback.warnings).toEqual([expect.stringContaining("仅支持 PNG/JPEG")]); expect(fallback.workbook.worksheets[0]!.getImages()).toHaveLength(0);
    await expect(renderPlanToXlsx(input, { fidelity: "strict" })).rejects.toMatchObject({ code: "output-fidelity", diagnostics: [expect.objectContaining({ code: "unsupported-image-format" })] });
  });
});
