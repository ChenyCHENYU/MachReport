// @vitest-environment node
import { readFileSync, writeFileSync } from "node:fs";
import fontkit from "@pdf-lib/fontkit";
import { describe, expect, it } from "vitest";
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream } from "pdf-lib";
import { renderPlanToPdf } from "../render-pdf";
import type { RenderPlan } from "../../schema/render-plan";

const font = readFileSync(new URL("../../../../../examples/minimal/public/fonts/mach-report-demo.otf", import.meta.url));
const ttf = readFileSync(new URL("./fixtures/cjk-outline.ttf", import.meta.url));
const lines = ["材料追溯 MATERIAL TRACE", "S316LS", "MR26010002", "MR-3D-TS-02-01-2024"];
function plan(): RenderPlan {
  return { schemaVersion: "shaped-glyph-regression", pages: [{ pageWidthMm: 80, pageHeightMm: 55, components: lines.map((text, index) => ({ kind: "text", leftMm: 4, topMm: 4 + index * 10, widthMm: 72, heightMm: 8, text, style: { fontSize: index === 1 ? 14 : 8, align: index === 3 ? "right" : "left" } })) }] };
}
function widths(fontDictionary: PDFDict): Map<number, number> {
  const array = fontDictionary.lookup(PDFName.of("DescendantFonts"), PDFArray).lookup(0, PDFDict).lookup(PDFName.of("W"), PDFArray), result = new Map<number, number>();
  for (let index = 0; index < array.size();) {
    const start = array.lookup(index++, PDFNumber).asNumber(), item = array.lookup(index++);
    if (item instanceof PDFArray) for (let offset = 0; offset < item.size(); offset++) result.set(start + offset, item.lookup(offset, PDFNumber).asNumber());
    else if (item instanceof PDFNumber) { const width = array.lookup(index++, PDFNumber).asNumber(); for (let id = start; id <= item.asNumber(); id++) result.set(id, width); }
  }
  return result;
}
function unicode(document: PDFDocument, dictionary: PDFDict): Map<number, string> {
  const stream = document.context.lookup(dictionary.get(PDFName.of("ToUnicode")));
  expect(stream).toBeInstanceOf(PDFRawStream);
  const cmap = new TextDecoder().decode(decodePDFRawStream(stream as PDFRawStream).decode()), result = new Map<number, string>();
  for (const match of cmap.matchAll(/^<([0-9a-f]{4})>\s+<([0-9a-f]+)>$/gim)) result.set(parseInt(match[1]!, 16), match[2]!.match(/.{4}/g)!.map(value => String.fromCharCode(parseInt(value, 16))).join(""));
  return result;
}
function content(document: PDFDocument): string {
  const streams = document.getPage(0).node.Contents();
  expect(streams).toBeInstanceOf(PDFArray);
  const array = streams as PDFArray;
  return Array.from({ length: array.size() }, (_, index) => document.context.lookup(array.get(index))).filter((stream): stream is PDFRawStream => stream instanceof PDFRawStream).map(stream => new TextDecoder().decode(decodePDFRawStream(stream).decode())).join("\n");
}
describe("embedded shaped glyph widths and Unicode", () => {
  it("includes substituted digits in W and ToUnicode, keeping right aligned text inside its box", async () => {
    const face = fontkit.create(font), unicodeIds = new Set(face.characterSet.map(point => face.glyphForCodePoint(point).id));
    const alternateDigits = face.layout("S316LS").glyphs.filter(glyph => !unicodeIds.has(glyph.id));
    expect(alternateDigits).toHaveLength(3);
    expect(alternateDigits.every(glyph => glyph.advanceWidth === 555)).toBe(true);
    const result = await renderPlanToPdf(plan(), { customFontBytes: font });
    expect(result.pageErrors).toEqual([]);
    expect(result.fidelityWarnings).toEqual([]);
    expect(result.unsupportedTextCount).toBe(0);
    const pdf = await PDFDocument.load(result.bytes), dictionaries = pdf.getPage(0).node.Resources()!.lookup(PDFName.of("Font"), PDFDict);
    const dictionary = dictionaries.lookup(dictionaries.keys()[0]!, PDFDict), advances = widths(dictionary), mapping = unicode(pdf, dictionary);
    for (const glyph of alternateDigits) { expect(advances.get(glyph.id)).toBe(555); expect(mapping.get(glyph.id)).toBe(String.fromCodePoint(...glyph.codePoints)); }
    const rendered: string[] = [];
    for (const block of content(pdf).matchAll(/BT\s+([\s\S]*?)ET/g)) {
      const hex = /<([0-9a-f]+)>\s+Tj/i.exec(block[1]!)?.[1]; if (!hex) continue;
      const ids = hex.match(/.{4}/g)!.map(value => parseInt(value, 16));
      const text = ids.map(id => mapping.get(id) ?? "?").join(""); rendered.push(text);
      if (text !== lines[3]) continue;
      const size = Number(/\S+\s+([\d.]+)\s+Tf/.exec(block[1]!)![1]);
      const x = Number(/1 0 0 1 ([\d.-]+) [\d.-]+ Tm/.exec(block[1]!)![1]);
      const actualAdvance = ids.reduce((sum, id) => sum + (advances.get(id) ?? 1000), 0) * size / 1000;
      expect(x + actualAdvance).toBeCloseTo(76 * 72 / 25.4, 7);
    }
    expect(rendered).toEqual(lines);
    if (process.env.MACH_REPORT_PDF_DEBUG_OUTPUT) writeFileSync(process.env.MACH_REPORT_PDF_DEBUG_OUTPUT, result.bytes);
  });

  it("associates used glyphs with each actual font face, including TrueType alternatives", async () => {
    const input = plan();
    input.pages[0]!.components = [input.pages[0]!.components[1]!, { kind: "text", text: "S316S", leftMm: 4, topMm: 25, widthMm: 72, heightMm: 8, style: { fontSize: 14, bold: true } }];
    const result = await renderPlanToPdf(input, { customFontFaces: { regular: font, bold: ttf } });
    expect(result.pageErrors).toEqual([]); expect(result.unsupportedTextCount).toBe(0);
    const pdf = await PDFDocument.load(result.bytes), dictionaries = pdf.getPage(0).node.Resources()!.lookup(PDFName.of("Font"), PDFDict);
    expect(dictionaries.keys()).toHaveLength(2);
    const runs = [fontkit.create(font).layout("S316LS"), fontkit.create(ttf).layout("S316S")];
    for (const [index, key] of dictionaries.keys().entries()) {
      const dictionary = dictionaries.lookup(key, PDFDict), advances = widths(dictionary), mapping = unicode(pdf, dictionary);
      for (const glyph of runs[index]!.glyphs) { expect(advances.get(glyph.id)).toBe(glyph.advanceWidth); expect(mapping.get(glyph.id)).toBe(String.fromCodePoint(...glyph.codePoints)); }
    }
  });
});
