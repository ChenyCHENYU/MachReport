import fontkit from "@pdf-lib/fontkit";
import { heuristicMeasurer, type TextMeasureOptions, type TextMeasurer } from "../layout/textwrap";

export interface FontBytesMeasureOptions {
  regular: Uint8Array | ArrayBuffer;
  bold?: Uint8Array | ArrayBuffer;
  italic?: Uint8Array | ArrayBuffer;
  boldItalic?: Uint8Array | ArrayBuffer;
  /** Optional family guard: other font families use fallback instead of inaccurate metrics. */
  fontFamily?: string;
  fallback?: TextMeasurer;
}

interface FontMetrics {
  unitsPerEm: number;
  layout(text: string): { positions: { xAdvance: number }[] };
}

// Parsed faces are reusable across measurer instances and are released with their byte source.
const parsedFaces = new WeakMap<Uint8Array | ArrayBuffer, FontMetrics>();

function parseFont(bytes: Uint8Array | ArrayBuffer): FontMetrics {
  const cached = parsedFaces.get(bytes);
  if (cached) return cached;
  const result = fontkit.create(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)) as FontMetrics;
  if (!Number.isFinite(result.unitsPerEm) || result.unitsPerEm <= 0 || typeof result.layout !== "function") {
    throw new TypeError("Font bytes must contain a single supported OpenType/TrueType font.");
  }
  parsedFaces.set(bytes, result);
  return result;
}

function faceFor(fonts: Partial<Record<"regular" | "bold" | "italic" | "boldItalic", FontMetrics>>, options: TextMeasureOptions): FontMetrics {
  if (options.bold && options.italic) return fonts.boldItalic ?? fonts.bold ?? fonts.italic ?? fonts.regular!;
  if (options.bold) return fonts.bold ?? fonts.regular!;
  if (options.italic) return fonts.italic ?? fonts.regular!;
  return fonts.regular!;
}

/** Exact font-byte width adapter. Import from /pdf to keep fontkit outside the core bundle. */
export function createFontBytesMeasurer(options: FontBytesMeasureOptions): TextMeasurer {
  const fonts = {
    regular: parseFont(options.regular),
    bold: options.bold ? parseFont(options.bold) : undefined,
    italic: options.italic ? parseFont(options.italic) : undefined,
    boldItalic: options.boldItalic ? parseFont(options.boldItalic) : undefined
  };
  return {
    measureMm(text, request) {
      if (options.fontFamily && request.fontFamily && request.fontFamily !== options.fontFamily) {
        return (options.fallback ?? heuristicMeasurer).measureMm(text, request);
      }
      const font = faceFor(fonts, request);
      const advance = font.layout(text).positions.reduce((sum, position) => sum + position.xAdvance, 0);
      const spacing = (request.letterSpacingPt ?? 0) * Math.max(0, Array.from(text).length - 1);
      return ((advance / font.unitsPerEm) * request.fontSizePt + spacing) * 25.4 / 72;
    }
  };
}
