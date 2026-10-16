// @vitest-environment node
import { readFileSync } from "node:fs";
import fontkit from "@pdf-lib/fontkit";
import { describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFPage } from "pdf-lib";
import { createFontBytesMeasurer } from "../font-measurer";
import { renderPlanToPdf } from "../render-pdf";
import type { RenderPlan } from "../../schema/render-plan";

const bytes = readFileSync(new URL("./fixtures/cjk-outline.ttf", import.meta.url));

describe("font byte metrics", () => {
  it("reuses parsed faces and avoids embedding the same font bytes for four face slots", async () => {
    const copy = Uint8Array.from(bytes);
    const parse = vi.spyOn(fontkit, "create");
    const embed = vi.spyOn(PDFDocument.prototype, "embedFont");
    try {
      createFontBytesMeasurer({ regular: copy, bold: copy, italic: copy, boldItalic: copy });
      createFontBytesMeasurer({ regular: copy });
      expect(parse).toHaveBeenCalledOnce();
      await renderPlanToPdf({ schemaVersion: "cache", pages: [] }, { customFontFaces: { regular: copy, bold: copy, italic: copy, boldItalic: copy } });
      expect(embed.mock.calls.filter(([input]) => input === copy)).toHaveLength(1);
    } finally { parse.mockRestore(); embed.mockRestore(); }
  });
  it("PDF directed lines preserve down/up endpoints and zero-size axes", async () => {
    const draw = vi.spyOn(PDFPage.prototype, "drawLine");
    try {
      const plan: RenderPlan = { schemaVersion: "line", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [
        { kind: "line", lineDirection: "down", leftMm: 10, topMm: 10, widthMm: 20, heightMm: 20 },
        { kind: "line", lineDirection: "up", leftMm: 10, topMm: 10, widthMm: 20, heightMm: 20 },
        { kind: "line", lineDirection: "down", leftMm: 10, topMm: 10, widthMm: 0, heightMm: 20 }
      ] }] };
      await renderPlanToPdf(plan);
      const [down, up, vertical] = draw.mock.calls.map(([options]) => options);
      expect(down!.start.y).toBeGreaterThan(down!.end.y);
      expect(up!.start.y).toBeLessThan(up!.end.y);
      expect(vertical!.start.x).toBe(vertical!.end.x);
      expect(vertical!.start.y).not.toBe(vertical!.end.y);
    } finally { draw.mockRestore(); }
  });
  it("matches actual font advance in Node and adds spacing only between Unicode code points", () => {
    const font = fontkit.create(bytes);
    const input = "炼钢日报";
    const advance = font.layout(input).positions.reduce((sum, position) => sum + position.xAdvance, 0);
    const measure = createFontBytesMeasurer({ regular: bytes });
    const expected = (advance / font.unitsPerEm * 12 + 3 * 2) * 25.4 / 72;
    expect(measure.measureMm(input, { fontSizePt: 12, letterSpacingPt: 2 })).toBeCloseTo(expected, 8);
    expect(measure.measureMm("", { fontSizePt: 12, letterSpacingPt: 2 })).toBe(0);
  });

  it("uses explicit family guard and handles ArrayBuffer without a browser", () => {
    const fallback = { measureMm: vi.fn(() => 123) };
    const measure = createFontBytesMeasurer({ regular: Uint8Array.from(bytes).buffer, fontFamily: "Report", fallback });
    expect(measure.measureMm("钢", { fontSizePt: 10, fontFamily: "Other" })).toBe(123);
    expect(fallback.measureMm).toHaveBeenCalledOnce();
    expect(measure.measureMm("钢", { fontSizePt: 10, fontFamily: "Report", italic: true, bold: true })).toBeGreaterThan(0);
  });

  it("PDF applies real character positions and explicit font faces without a false missing-face warning", async () => {
    const draw = vi.spyOn(PDFPage.prototype, "drawText");
    try {
      const plan: RenderPlan = { schemaVersion: "metrics", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [{
        kind: "text", leftMm: 10, topMm: 10, widthMm: 60, heightMm: 15, text: "钢报",
        style: { fontSize: 12, letterSpacing: 3, bold: true, italic: true }
      }] }] };
      const result = await renderPlanToPdf(plan, { customFontFaces: { regular: bytes, boldItalic: bytes }, measurer: createFontBytesMeasurer({ regular: bytes, boldItalic: bytes }) });
      expect(result.pageErrors).toEqual([]);
      expect(result.fidelityWarnings.some((warning) => warning.includes("字间距") || warning.includes("单个字面"))).toBe(false);
      expect(draw.mock.calls.map(([text]) => text)).toEqual(["钢", "报"]);
      expect(draw.mock.calls[1]![1]!.x! - draw.mock.calls[0]![1]!.x!).toBeCloseTo(15, 5);
    } finally { draw.mockRestore(); }
  });
});
