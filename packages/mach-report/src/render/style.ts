/**
 * 组件样式解析（三后端共享的唯一样式语义真相源）。
 *
 * DOM/Canvas/PDF 各自把 ComponentStyle 翻译成绘制语义时必须经过这里，
 * 禁止后端内联写 fontSize/颜色/线宽换算——历史上三处各写一份导致
 * Canvas 字号 2.13x、网格线口径不一致等漂移 bug。
 */
import type { ComponentStyle } from "../schema/render-plan";
import { DEFAULT_BORDER_PT, DEFAULT_FONT_PT, DEFAULT_STROKE_COLOR, DEFAULT_TEXT_COLOR, LINE_HEIGHT } from "../defaults";
import { ptToPx } from "../units";

/** 解析后的字号（px 值已按 dpi 换算；pt 值供 PDF 使用） */
export interface ResolvedFontSize {
  fontSizePt: number;
  fontSizePx: number;
}

/** 字号解析：fontSizePx 直通；否则 pt→px（与 units.ptToPx 同源） */
export function resolveFontSize(
  style: Pick<ComponentStyle, "fontSizePx" | "fontSize"> | undefined,
  dpi = 96,
  defaultPt = DEFAULT_FONT_PT
): ResolvedFontSize {
  if (style?.fontSizePx != null) {
    return { fontSizePt: (style.fontSizePx * 72) / dpi, fontSizePx: style.fontSizePx };
  }
  const pt = style?.fontSize ?? defaultPt;
  return { fontSizePt: pt, fontSizePx: ptToPx(pt, dpi) };
}

/** 描边解析：颜色 + 线宽（pt） */
export function resolveStroke(
  style: Pick<ComponentStyle, "borderColor" | "lineColor" | "lineWidthPt"> | undefined,
  fallbackColor = DEFAULT_STROKE_COLOR
): { color: string; widthPt: number } {
  return {
    color: style?.borderColor ?? style?.lineColor ?? fallbackColor,
    widthPt: style?.lineWidthPt ?? DEFAULT_BORDER_PT
  };
}

/** 文本颜色解析 */
export function resolveTextColor(
  style: Pick<ComponentStyle, "color"> | undefined,
  fallback = DEFAULT_TEXT_COLOR
): string {
  return style?.color ?? fallback;
}

/** 行高解析（倍数，基线距 = 字号 × lineHeight） */
export function resolveLineHeight(style: Pick<ComponentStyle, "lineHeight"> | undefined): number {
  return style?.lineHeight ?? LINE_HEIGHT;
}

/** 盒子边框语义：四边开关 + 内部网格线（四边全关则内线不画） */
export interface BoxBorders {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
  /** 网格内线（仅当任意外边开启） */
  inner: boolean;
}

/**
 * 边框开关解析：
 * - 未声明（undefined）→ 四边全开（与既有 rect 总有边框的行为兼容）
 * - 显式 false → 对应边关闭
 * - 四边全关（如 list border:false）→ 内线也不画
 */
export function resolveBoxBorders(
  style: Pick<ComponentStyle, "borderTop" | "borderRight" | "borderBottom" | "borderLeft"> | undefined
): BoxBorders {
  const top = style?.borderTop !== false;
  const right = style?.borderRight !== false;
  const bottom = style?.borderBottom !== false;
  const left = style?.borderLeft !== false;
  return { top, right, bottom, left, inner: top || right || bottom || left };
}
