export interface TextDrawSpec {
  text: string;
  fontSizePx: number;
  bold: boolean;
  italic?: boolean;
  underline?: boolean;
  color: string;
  align: "left" | "center" | "right" | "justify";
  lineHeight: number;
  letterSpacingPx?: number;
}

export function drawTextBlock(
  ctx: CanvasRenderingContext2D,
  spec: TextDrawSpec,
  x: number,
  y: number,
  w: number,
  h: number,
  fontFamily: string,
  verticalAlign: "top" | "middle" | "bottom" = "top"
): void {
  ctx.font = `${spec.italic ? "italic " : ""}${spec.bold ? "bold " : ""}${spec.fontSizePx}px ${fontFamily}`;
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  ctx.fillStyle = spec.color;
  ctx.textBaseline = "alphabetic";
  const lineH = spec.fontSizePx * spec.lineHeight;
  const lines = spec.text === "" ? [""] : spec.text.split("\n");
  const totalH = lines.length * lineH;
  let topY = y;
  if (verticalAlign === "middle") topY = y + (h - totalH) / 2;
  else if (verticalAlign === "bottom") topY = y + h - totalH;
  lines.forEach((line, i) => {
    const baseline = topY + i * lineH + spec.fontSizePx * 0.8;
    drawSpacedLine(ctx, line, spec, x, baseline, w);
    if (spec.underline && line) drawUnderline(ctx, line, spec, x, baseline, w);
  });
  ctx.textAlign = "left";
}

function drawSpacedLine(ctx: CanvasRenderingContext2D, line: string, spec: TextDrawSpec, x: number, baseline: number, width: number): void {
  const letters = Array.from(line);
  const spacing = spec.letterSpacingPx ?? 0;
  // Preserve native anchors when no spacing is requested; measurement and painting share kerning.
  if (!spacing) {
    ctx.textAlign = spec.align === "center" ? "center" : spec.align === "right" ? "right" : "left";
    const anchor = spec.align === "center" ? x + width / 2 : spec.align === "right" ? x + width : x;
    ctx.fillText(line, anchor, baseline);
    return;
  }
  const textWidth = ctx.measureText(line).width + Math.max(0, letters.length - 1) * spacing;
  const left = spec.align === "center" ? x + (width - textWidth) / 2 : spec.align === "right" ? x + width - textWidth : x;
  ctx.textAlign = "left";
  // Do not use fillText(maxWidth): it silently compresses text and differs from DOM/PDF geometry.
  let prefix = "";
  letters.forEach((letter, index) => {
    ctx.fillText(letter, left + ctx.measureText(prefix).width + index * spacing, baseline);
    prefix += letter;
  });
}

function drawUnderline(ctx: CanvasRenderingContext2D, line: string, spec: TextDrawSpec, x: number, baseline: number, width: number): void {
  const actual = ctx.measureText(line).width + Math.max(0, Array.from(line).length - 1) * (spec.letterSpacingPx ?? 0);
  const left = spec.align === "center" ? x + (width - actual) / 2 : spec.align === "right" ? x + width - actual : x;
  ctx.strokeStyle = spec.color; ctx.lineWidth = Math.max(0.5, spec.fontSizePx / 20);
  ctx.beginPath(); ctx.moveTo(left, baseline + 1); ctx.lineTo(left + actual, baseline + 1); ctx.stroke();
}
