export interface TextMeasureOptions {
  fontSizePt: number;
  bold?: boolean;
  letterSpacingPt?: number;
}

const CJK_RE = /[\u3000-\u9fff\uff00-\uffef]/;

export function charWidthEm(ch: string): number {
  if (ch === " ") return 0.28;
  if (CJK_RE.test(ch)) return 1;
  if (/[iljtf.,:;'`|!()[\]]/.test(ch)) return 0.32;
  if (/[mwMW@]/.test(ch)) return 0.85;
  return 0.55;
}

export function measureTextMm(text: string, options: TextMeasureOptions): number {
  const { fontSizePt, bold = false, letterSpacingPt = 0 } = options;
  const ptToMm = 25.4 / 72;
  let units = 0;
  for (const ch of text) units += charWidthEm(ch);
  if (bold) units *= 1.04;
  return (units * fontSizePt + letterSpacingPt * text.length) * ptToMm;
}

export function wrapText(
  text: string,
  maxWidthMm: number,
  options: TextMeasureOptions
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
  for (const ch of text) {
    if (ch === "\n") {
      pushLine();
      continue;
    }
    const chWidth = measureTextMm(ch, options);
    if (currentWidth + chWidth > maxWidthMm && current.length > 0) {
      if (ch === " ") {
        pushLine();
        continue;
      }
      pushLine();
      current = ch;
      currentWidth = chWidth;
    } else {
      current += ch;
      currentWidth += chWidth;
    }
  }
  pushLine();
  return lines;
}
