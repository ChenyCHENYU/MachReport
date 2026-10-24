import type { ComponentStyle, PlanComponent } from "../schema/render-plan";
import { drawRichText } from "./rich-text-layout";
import { drawTextBlock } from "./canvas-text";
import { resolveFontSize, resolveLineHeight, resolveTextColor } from "./style";

export function drawCanvasRichText(ctx: CanvasRenderingContext2D, component: PlanComponent, box: { x: number; y: number; width: number; height: number }, dpi: number, family: string): void {
  const factor = dpi / 72;
  const font = (style: ComponentStyle): void => {
    ctx.font = `${style.italic ? "italic " : ""}${style.bold ? "bold " : ""}${resolveFontSize(style, dpi).fontSizePx}px ${style.fontFamily ?? family}`;
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  };
  drawRichText(component, { x: box.x / factor, yTop: -box.y / factor, width: box.width / factor, height: box.height / factor }, {
    measure(text, style) { font(style); return ctx.measureText(text).width / factor + (style.letterSpacing ?? 0); },
    draw(text, style, x, baseline, width) {
      const size = resolveFontSize(style, dpi).fontSizePx, y = -baseline * factor - size * 0.8;
      if (style.backgroundColor) { ctx.fillStyle = style.backgroundColor; ctx.fillRect(x * factor, y, width * factor, size * resolveLineHeight(style)); }
      drawTextBlock(ctx, { text, fontSizePx: size, bold: !!style.bold, italic: style.italic, underline: style.underline, color: resolveTextColor(style), align: "left", lineHeight: resolveLineHeight(style), letterSpacingPx: (style.letterSpacing ?? 0) * factor }, x * factor, y, width * factor, size, style.fontFamily ?? family);
    }
  });
}
