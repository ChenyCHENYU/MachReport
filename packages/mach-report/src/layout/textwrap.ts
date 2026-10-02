/**
 * 文本测量与折行（分页/Canvas/PDF 共用的唯一折行真相源）。
 *
 * 测量模型可注入（TextMeasurer）：
 * - 默认 createHeuristicMeasurer()：CJK/拉丁宽度启发式（零依赖、Node 可用）
 * - 浏览器端可注入 createCanvasMeasurer()（真字体 metrics，消除三端折行差异）
 */

export interface TextMeasureOptions {
  fontSizePt: number;
  bold?: boolean;
  letterSpacingPt?: number;
}

/** 宽度测量接口：返回文本在给定字号下的宽度（mm）。实现必须无副作用、可缓存。 */
export interface TextMeasurer {
  measureMm(text: string, options: TextMeasureOptions): number;
}

const CJK_RE = /[\u3000-\u9fff\uff00-\uffef]/;

/** Latin 快速分类：0=默认 0.54em，1=窄字符 0.26，2=宽字符 0.95，3=数字 0.59，4=大写 0.67，5=空格 0.3 */
const LATIN_CLASS = new Uint8Array(128);
{
  // 窄字符（i l j t f . , : ; ' ` | ! ( ) [ ]）
  for (const ch of "iljtf.,:;'`|!()[]") LATIN_CLASS[ch.charCodeAt(0)] = 1;
  // 宽字符（m w M W @）
  for (const ch of "mwMW@") LATIN_CLASS[ch.charCodeAt(0)] = 2;
  // 数字 0.59
  for (let c = 48; c <= 57; c++) LATIN_CLASS[c] = 3;
  // 大写 0.67
  for (let c = 65; c <= 90; c++) LATIN_CLASS[c] = 4;
  LATIN_CLASS[32] = 5; // 空格
}
const LATIN_WIDTH = [0.54, 0.26, 0.95, 0.59, 0.67, 0.3];

export function charWidthEm(ch: string): number {
  const code = ch.charCodeAt(0);
  // 快路径：ASCII 查表（O(1)，无正则、无分配）
  if (code < 128) return LATIN_WIDTH[LATIN_CLASS[code]!]!;
  if (CJK_RE.test(ch)) return 1;
  // 其余（带音符拉丁/西里尔等）走原启发式
  if (/[A-Z]/.test(ch)) return 0.67;
  return 0.54;
}

/** 启发式测量器：无 Canvas 时的默认宽度估算 */
export const heuristicMeasurer: TextMeasurer = {
  measureMm(text: string, options: TextMeasureOptions): number {
    const { fontSizePt, bold = false, letterSpacingPt = 0 } = options;
    const ptToMm = 25.4 / 72;
    let units = 0;
    for (const ch of text) {
      units += charWidthEm(ch);
    }
    if (bold) units *= 1.04;
    return (units * fontSizePt + letterSpacingPt * text.length) * ptToMm;
  }
};

/** 兼容旧 API：默认启发式测量 */
export function createHeuristicMeasurer(): TextMeasurer {
  return heuristicMeasurer;
}

export function measureTextMm(text: string, options: TextMeasureOptions): number {
  return heuristicMeasurer.measureMm(text, options);
}

/**
 * 浏览器 Canvas 测量器：用真实字体 metrics 校准宽度（可选注入）。
 * 无 2D 环境时自动回退启发式（Node/SSR 安全）。
 */
export function createCanvasMeasurer(
  getCtx2d: () => CanvasRenderingContext2D | null
): TextMeasurer {
  let ctx: CanvasRenderingContext2D | null | undefined;
  return {
    measureMm(text, options) {
      if (ctx === undefined) ctx = getCtx2d();
      if (!ctx) return heuristicMeasurer.measureMm(text, options);
      const px = (options.fontSizePt * 96) / 72;
      ctx.font = `${options.bold ? "bold " : ""}${px}px sans-serif`;
      // px → mm（96dpi 基准）
      return (ctx.measureText(text).width * 25.4) / 96;
    }
  };
}

interface Atom {
  text: string;
  widthMm: number;
  /** CJK 单字（任意位置可断）；false = 连续拉丁词（仅在词间断行） */
  cjk: boolean;
  space?: boolean;
  br?: boolean;
}

function tokenize(text: string, options: TextMeasureOptions, measurer: TextMeasurer): Atom[] {
  const atoms: Atom[] = [];
  let word = "";
  let wordWidth = 0;
  const flush = () => {
    if (word) {
      atoms.push({ text: word, widthMm: wordWidth, cjk: false });
      word = "";
      wordWidth = 0;
    }
  };
  for (const ch of text) {
    if (ch === "\n") {
      flush();
      atoms.push({ text: "\n", widthMm: 0, cjk: false, br: true });
      continue;
    }
    if (ch === " ") {
      flush();
      atoms.push({ text: ch, widthMm: measurer.measureMm(ch, options), cjk: false, space: true });
      continue;
    }
    if (CJK_RE.test(ch)) {
      flush();
      atoms.push({ text: ch, widthMm: measurer.measureMm(ch, options), cjk: true });
      continue;
    }
    word += ch;
    wordWidth += measurer.measureMm(ch, options);
  }
  flush();
  return atoms;
}

/**
 * 文本折行：
 * - CJK 字符任意位置可断（与既有行为一致）
 * - 连续拉丁/数字串视为一个词，仅在词间（空格/CJK 边界）断行；
 *   单词本身超宽时按字符硬拆（兜底，不无限溢出）
 * - 换行符强制断行；行首不保留折行产生的空格
 * - 可注入 TextMeasurer（默认启发式）
 */
export function wrapText(
  text: string,
  maxWidthMm: number,
  options: TextMeasureOptions,
  measurer: TextMeasurer = heuristicMeasurer
): string[] {
  if (!text) return [""];
  const lines: string[] = [];
  let current = "";
  let currentWidth = 0;
  const pushLine = () => {
    lines.push(current);
    current = "";
    currentWidth = 0;
  };
  for (const atom of tokenize(text, options, measurer)) {
    if (atom.br) {
      pushLine();
      continue;
    }
    if (currentWidth + atom.widthMm <= maxWidthMm) {
      current += atom.text;
      currentWidth += atom.widthMm;
      continue;
    }
    if (atom.space) {
      // 行尾放不下的空格直接丢弃断行（不保留到下一行行首）
      pushLine();
      continue;
    }
    if (atom.cjk) {
      if (current.length > 0) pushLine();
      current = atom.text;
      currentWidth = atom.widthMm;
      continue;
    }
    // 拉丁词放不下：先断行，词本身超宽再按字符硬拆
    if (current.length > 0) pushLine();
    if (atom.widthMm <= maxWidthMm) {
      current = atom.text;
      currentWidth = atom.widthMm;
      continue;
    }
    for (const ch of atom.text) {
      const chWidth = measurer.measureMm(ch, options);
      if (currentWidth + chWidth > maxWidthMm && current.length > 0) {
        pushLine();
      }
      current += ch;
      currentWidth += chWidth;
    }
  }
  pushLine();
  return lines;
}
