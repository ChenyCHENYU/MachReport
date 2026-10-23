// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { decode } from "fast-png";
import { BarcodeFormat, BinaryBitmap, DecodeHintType, HybridBinarizer, MultiFormatReader, RGBLuminanceSource } from "@zxing/library";
import { createLabelTemplate } from "../builder/label-template";
import { createCodeAssetRenderers } from "../codes";
import { paginateTemplate } from "../layout/paginate";
import { resolvePlanAssets } from "../output/assets";
import { renderPlanToPdf } from "../pdf";
import { renderPlanToXlsx } from "../xlsx";
import { createReportRuntime } from "../server/runtime";

const labelRows = [{ id: "000001", grade: "S304H3", trace: "MR:000001:S304H3" }, { id: "000002", grade: "S316LS", trace: "MR:000002:S316LS" }];
const labelDocument = { template: createLabelTemplate({ dataset: "materials", rowKey: "id", pages: [
  { components: [{ kind: "text", leftMm: 4, topMm: 4, widthMm: 50, heightMm: 6, binding: { field: "grade" }, style: { fontSize: 10 } }, { kind: "qrcode", leftMm: 55, topMm: 19, widthMm: 21, heightMm: 21, binding: { field: "trace" } }] },
  { components: [{ kind: "text", leftMm: 4, topMm: 4, widthMm: 60, heightMm: 6, binding: { field: "id" } }, { kind: "barcode", leftMm: 7, topMm: 20, widthMm: 66, heightMm: 15, binding: { field: "id" }, code: { showText: true } }] }
] }) };

function scan(url: string, format: BarcodeFormat): string {
  const png = decode(Uint8Array.from(atob(url.split(",")[1]!), char => char.charCodeAt(0)));
  const source = new RGBLuminanceSource(new Uint8ClampedArray(png.data), png.width, png.height);
  return new MultiFormatReader().decode(new BinaryBitmap(new HybridBinarizer(source)), new Map([[DecodeHintType.POSSIBLE_FORMATS, [format]]])).getText();
}
describe("industrial label end-to-end output", () => {
  it("prints real example records as adjacent faces, scans distinct symbols and preserves 80×55mm PDF pages", async () => {
    const source = JSON.stringify(labelDocument);
    const plan = paginateTemplate(labelDocument.template, { materials: labelRows }).plan;
    expect(plan.pages).toHaveLength(4);
    const assets = { assetRenderers: createCodeAssetRenderers({ dpi: 203 }) };
    const encoded = await resolvePlanAssets(plan, assets);
    expect(encoded.diagnostics).toEqual([]);
    for (const [index, row] of labelRows.entries()) {
      const qr = encoded.plan.pages[index * 2]!.components.find(item => item.kind === "qrcode")!;
      const barcode = encoded.plan.pages[index * 2 + 1]!.components.find(item => item.kind === "barcode")!;
      expect(scan(qr.imageData!, BarcodeFormat.QR_CODE)).toBe(row.trace);
      expect(scan(barcode.imageData!, BarcodeFormat.CODE_128)).toBe(row.id);
    }
    const customFontBytes = readFileSync(new URL("../../../../examples/minimal/public/fonts/mach-report-demo.otf", import.meta.url));
    const result = await renderPlanToPdf(encoded.plan, { customFontBytes });
    expect(result.pageErrors).toEqual([]);
    expect(result.unsupportedTextCount).toBe(0);
    expect(result.diagnostics).toEqual([]);
    const pdf = await PDFDocument.load(result.bytes);
    expect(pdf.getPageCount()).toBe(4);
    for (const page of pdf.getPages()) {
      expect(page.getWidth()).toBeCloseTo(80 * 72 / 25.4, 6);
      expect(page.getHeight()).toBeCloseTo(55 * 72 / 25.4, 6);
      expect(page.node.Resources()!.lookup(PDFName.of("XObject"), PDFDict).keys()).toHaveLength(1);
    }
    expect(JSON.stringify(labelDocument)).toBe(source);
    expect(plan.pages.flatMap(page => page.components).some(item => item.imageData)).toBe(false);
  });

  it("shares label resources and real files with Node Runtime, reports rows and respects asset failures", async () => {
    const assets = { assetRenderers: createCodeAssetRenderers({ dpi: 203 }) };
    const runtime = createReportRuntime({ reports: { labels: { template: labelDocument.template, datasets: { materials: labelRows } } }, assets });
    const events: string[] = [];
    const prepared = await runtime.prepare({ reportIds: ["labels"], onEvent: event => { events.push(event.stage); } });
    expect(prepared.stats).toMatchObject({ rows: 2, pages: 4 });
    expect(events).toContain("assets");
    expect(prepared.plan.pages[0]!.components.find(item => item.kind === "qrcode")!.imageData).toMatch(/^data:image\/png/);
    const xlsx = await renderPlanToXlsx(prepared.plan, { sheetMode: "pages" });
    expect(xlsx.workbook.worksheets).toHaveLength(4);
    expect(xlsx.workbook.worksheets.every(sheet => sheet.getImages().length === 1)).toBe(true);
    const failing = createReportRuntime({ reports: { labels: { template: labelDocument.template, datasets: { materials: labelRows } } }, assets: { assetRenderers: { qrcode: () => { throw new Error("offline encoder"); } } } });
    await expect(failing.prepare({ reportIds: ["labels"] })).rejects.toMatchObject({ name: "OutputAssetError" });
  });
});
