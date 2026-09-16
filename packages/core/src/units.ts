export const MM_PER_INCH = 25.4;
export const CSS_DPI = 96;

export function mmToPxFactor(dpi: number = CSS_DPI): number {
  return dpi / MM_PER_INCH;
}

export function mmToPx(value: number, dpi: number = CSS_DPI): number {
  return (value || 0) * mmToPxFactor(dpi);
}

export function pxToMm(value: number, dpi: number = CSS_DPI): number {
  return value / mmToPxFactor(dpi);
}

export function ptToPx(pt: number, dpi: number = CSS_DPI): number {
  return (pt * dpi) / 72;
}

export function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export const PAPER_SIZES: Record<string, { widthMm: number; heightMm: number }> = {
  a3: { widthMm: 297, heightMm: 420 },
  a4: { widthMm: 210, heightMm: 297 },
  a5: { widthMm: 148, heightMm: 210 },
  b4: { widthMm: 250, heightMm: 353 },
  b5: { widthMm: 176, heightMm: 250 },
};
