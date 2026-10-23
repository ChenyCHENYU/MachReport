import fontkit from "@pdf-lib/fontkit";
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, type PDFFont } from "pdf-lib";

interface LayoutGlyph { id: number; advanceWidth: number; codePoints: number[] }
interface LayoutFont { unitsPerEm: number; layout(text: string): { glyphs: LayoutGlyph[] } }
interface UsedGlyph { width: number; unicode: string }
interface RegisteredFont { face: LayoutFont; used: Map<number, UsedGlyph> }

function isOpenType(bytes: Uint8Array): boolean { return bytes[0] === 0x4f && bytes[1] === 0x54 && bytes[2] === 0x54 && bytes[3] === 0x4f; }
function unicodeHex(points: readonly number[]): string {
  const text = String.fromCodePoint(...points);
  let hex = "";
  for (let index = 0; index < text.length; index++) hex += text.charCodeAt(index).toString(16).padStart(4, "0");
  return hex.toUpperCase();
}
function rememberGlyphs(entry: RegisteredFont, glyphs: readonly LayoutGlyph[]): void {
  for (const glyph of glyphs) if (!entry.used.has(glyph.id)) entry.used.set(glyph.id, { width: glyph.advanceWidth * 1000 / entry.face.unitsPerEm, unicode: unicodeHex(glyph.codePoints) });
}
function fontWidths(widths: PDFArray): Map<number, number> {
  const result = new Map<number, number>();
  let index = 0;
  while (index < widths.size()) {
    const first = widths.lookup(index++, PDFNumber).asNumber(), next = widths.lookup(index++);
    if (next instanceof PDFArray) {
      for (let offset = 0; offset < next.size(); offset++) result.set(first + offset, next.lookup(offset, PDFNumber).asNumber());
    } else if (next instanceof PDFNumber) {
      const width = widths.lookup(index++, PDFNumber).asNumber();
      for (let id = first; id <= next.asNumber(); id++) result.set(id, width);
    }
  }
  return result;
}
function widthSections(widths: ReadonlyMap<number, number>): Array<number | number[]> {
  const sections: Array<number | number[]> = [];
  let previous = -2, values: number[] = [];
  for (const [id, width] of [...widths].sort(([left], [right]) => left - right)) {
    if (id !== previous + 1) { values = []; sections.push(id, values); }
    values.push(width); previous = id;
  }
  return sections;
}
function addUnicodeMappings(document: PDFDocument, dictionary: PDFDict, glyphs: ReadonlyMap<number, UsedGlyph>): void {
  const ref = dictionary.get(PDFName.of("ToUnicode"));
  if (!(ref instanceof PDFRef)) return;
  const stream = document.context.lookup(ref);
  if (!(stream instanceof PDFRawStream)) return;
  const text = new TextDecoder().decode(decodePDFRawStream(stream).decode()), mappings = new Map<number, string>();
  // This stream is created by pdf-lib's bfchar-only CMap encoder, not an imported arbitrary PDF.
  for (const match of text.matchAll(/^<([0-9a-f]{4})>\s+<([0-9a-f]+)>$/gim)) mappings.set(parseInt(match[1]!, 16), match[2]!);
  let changed = false;
  for (const [id, glyph] of glyphs) if (glyph.unicode && !mappings.has(id)) { mappings.set(id, glyph.unicode); changed = true; }
  if (!changed) return;
  const entries = [...mappings].sort(([left], [right]) => left - right).map(([id, value]) => `<${id.toString(16).padStart(4, "0")}> <${value}>`);
  // PDF readers support at most 100 entries per bfchar block.
  const blocks: string[] = [];
  for (let start = 0; start < entries.length; start += 100) { const batch = entries.slice(start, start + 100); blocks.push(`${batch.length} beginbfchar\n${batch.join("\n")}\nendbfchar`); }
  const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000><ffff>\nendcodespacerange\n${blocks.join("\n")}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
  document.context.assign(ref, document.context.flateStream(cmap));
}
function completeGlyphWidths(document: PDFDocument, font: PDFFont, registered: RegisteredFont): void {
  const dictionary = document.context.lookup(font.ref, PDFDict);
  const descendant = dictionary.lookup(PDFName.of("DescendantFonts"), PDFArray).lookup(0, PDFDict);
  const widths = fontWidths(descendant.lookup(PDFName.of("W"), PDFArray));
  let changed = false;
  for (const [id, glyph] of registered.used) if (!widths.has(id)) { widths.set(id, glyph.width); changed = true; }
  if (changed) descendant.set(PDFName.of("W"), document.context.obj(widthSections(widths)));
  addUnicodeMappings(document, dictionary, registered.used);
}

/** Full-font embedding retains shaped GSUB glyph metrics and Unicode mapping, without subsetting. */
export function createPdfFontEmbedding(document: PDFDocument) {
  const parsed = new WeakMap<Uint8Array, RegisteredFont>(), registered = new Map<PDFFont, RegisteredFont>();
  document.registerFontkit({
    create(bytes: Uint8Array, postscriptName?: string) {
      const face = fontkit.create(bytes, postscriptName);
      if (isOpenType(bytes)) face.cff = true;
      const entry: RegisteredFont = { face, used: new Map() }, original = face.layout;
      // Observe the shaping already performed by pdf-lib: no extra per-line shaping pass.
      face.layout = function (this: typeof face, ...args: Parameters<typeof original>) {
        const run = original.apply(this, args);
        rememberGlyphs(entry, run.glyphs);
        return run;
      };
      parsed.set(bytes, entry);
      return face;
    }
  });
  return {
    async embed(bytes: Uint8Array | ArrayBuffer): Promise<PDFFont> {
      const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const font = await document.embedFont(input, { subset: false });
      const entry = parsed.get(input);
      if (!entry) throw new Error("Embedded font metrics were not registered.");
      registered.set(font, entry);
      return font;
    },
    async finalize(): Promise<void> {
      await document.flush();
      for (const [font, entry] of registered) completeGlyphWidths(document, font, entry);
      // A complete OTTO container is OpenType, not a bare CIDFontType0C stream.
      for (const [, object] of document.context.enumerateIndirectObjects()) if (object instanceof PDFRawStream && object.dict.get(PDFName.of("Subtype")) === PDFName.of("CIDFontType0C")) object.dict.set(PDFName.of("Subtype"), PDFName.of("OpenType"));
    }
  };
}
export type PdfFontEmbedding = ReturnType<typeof createPdfFontEmbedding>;
