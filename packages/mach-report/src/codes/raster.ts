import * as bwipModule from "@bwip-js/generic";
import type { ResolvedCode } from "./options";
import { checkCodeAbort, CodeImageError } from "./types";

// Official ESM exposes raw encoding and FontLib on default; its declaration still uses export=.
const bwip = (bwipModule as unknown as { default: typeof bwipModule }).default;

interface MatrixSymbol { pixs: number[]; pixx: number; pixy: number }
interface LinearSymbol { bbs: number[]; bhs: number[]; sbs: number[] }
export interface CodeRaster { width: number; height: number; data: Uint8Array }

function fillRectangle(raster: CodeRaster, left: number, top: number, width: number, height: number): void {
  const x0 = Math.max(0, Math.round(left)), x1 = Math.min(raster.width, Math.round(left + width));
  const y0 = Math.max(0, Math.round(top)), y1 = Math.min(raster.height, Math.round(top + height));
  for (let y = y0; y < y1; y++) raster.data.fill(0, y * raster.width + x0, y * raster.width + x1);
}

function drawMatrix(code: ResolvedCode, symbol: MatrixSymbol, raster: CodeRaster, signal?: AbortSignal): void {
  const columns = symbol.pixx + code.quiet * 2;
  const scale = Math.floor(Math.min(code.width, code.height) / columns);
  if (scale < 2) throw new CodeImageError("capacity", "QR modules need at least two raster pixels; enlarge the component, raise DPI or shorten its content.", "geometry");
  const left = Math.floor((code.width - symbol.pixx * scale) / 2), top = Math.floor((code.height - symbol.pixy * scale) / 2);
  for (let row = 0; row < symbol.pixy; row++) {
    checkCodeAbort(signal);
    for (let column = 0; column < symbol.pixx; column++) if (symbol.pixs[row * symbol.pixx + column]) fillRectangle(raster, left + column * scale, top + row * scale, scale, scale);
  }
}

function textLayout(code: ResolvedCode): { height: number; gap: number; glyphSize: number } {
  if (!code.showText) return { height: 0, gap: 0, glyphSize: 0 };
  const glyphSize = Math.max(10, Math.min(64, Math.floor(code.height * 0.17))), gap = Math.max(2, Math.floor(glyphSize * 0.2));
  return { height: glyphSize + gap, gap, glyphSize };
}

function drawReadableText(code: ResolvedCode, raster: CodeRaster, glyphSize: number): void {
  const font = bwip.FontLib.lookup("OCR-B");
  const glyphs = Array.from(code.value, character => bwip.FontLib.getglyph(font, character.codePointAt(0)!, glyphSize, glyphSize));
  const total = glyphs.reduce((sum, glyph) => sum + glyph.advance, 0);
  if (total > raster.width - 4) throw new CodeImageError("capacity", "Human-readable content does not fit the symbol width; enlarge it or use a separate text component.", "code.showText");
  let x = Math.floor((raster.width - total) / 2);
  const baseline = raster.height - 2;
  for (const glyph of glyphs) {
    for (let y = 0; y < glyph.height; y++) for (let column = 0; column < glyph.width; column++) {
      const targetX = Math.round(x + glyph.left + column), targetY = Math.round(baseline - glyph.top + y);
      if (targetX >= 0 && targetX < raster.width && targetY >= 0 && targetY < raster.height) {
        const value = glyph.bytes[glyph.offset + y * glyph.width + column] ?? 0;
        raster.data[targetY * raster.width + targetX] = 255 - value;
      }
    }
    x += glyph.advance;
  }
}

function drawLinear(code: ResolvedCode, symbol: LinearSymbol, raster: CodeRaster, signal?: AbortSignal): void {
  const moduleWidth = symbol.sbs.reduce((sum, width) => sum + width, 0);
  const scale = Math.floor(code.width / (moduleWidth + code.quiet * 2));
  if (scale < 2) throw new CodeImageError("capacity", "Barcode modules need at least two raster pixels; enlarge its width, raise DPI or shorten its content.", "widthMm");
  const text = textLayout(code), top = Math.max(2, Math.floor(code.height * 0.03));
  const available = code.height - text.height - top * 2;
  if (available < 12) throw new CodeImageError("capacity", "Barcode is too short for its bars and readable text.", "heightMm");
  const maximum = Math.max(...symbol.bhs.map((height, index) => height + symbol.bbs[index]!));
  let x = Math.floor((code.width - moduleWidth * scale) / 2);
  for (let index = 0; index < symbol.sbs.length; index++) {
    checkCodeAbort(signal);
    const width = symbol.sbs[index]! * scale;
    if (index % 2 === 0) {
      const bar = index / 2, height = symbol.bhs[bar]! / maximum * available;
      fillRectangle(raster, x, top + available - height - symbol.bbs[bar]! / maximum * available, width, height);
    }
    x += width;
  }
  if (code.showText) drawReadableText(code, raster, text.glyphSize);
}

/** Encoding is delegated to BWIPP; this layer only places whole modules into a bounded raster. */
export function rasterCode(code: ResolvedCode, signal?: AbortSignal): CodeRaster {
  checkCodeAbort(signal);
  let symbol: MatrixSymbol | LinearSymbol;
  try {
    const options = { bcid: code.kind === "qrcode" ? "qrcode" : code.symbology, text: code.value, eclevel: code.errorCorrection, parse: false, parsefnc: false };
    symbol = bwip.raw(options)[0]!;
  } catch (cause) { throw new CodeImageError("encode-failed", "The encoding library rejected this symbol content.", "code.value", cause); }
  checkCodeAbort(signal);
  const raster = { width: code.width, height: code.height, data: new Uint8Array(code.width * code.height).fill(255) };
  if ("pixs" in symbol) drawMatrix(code, symbol, raster, signal);
  else drawLinear(code, symbol, raster, signal);
  return raster;
}
