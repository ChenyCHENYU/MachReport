import { justificationChunks } from "./justification";
import type { ComponentStyle, PlanComponent } from "../schema/render-plan";
import { mergeComponentStyles, resolveFontSize, resolveLineHeight } from "./style";
interface Run { text: string; style: ComponentStyle; width: number }
interface RichLine { runs: Run[]; width: number; height: number; fontSize: number; justify?: boolean }
interface RichDrawing {
  measure(text: string, style: ComponentStyle): number;
  draw(text: string, style: ComponentStyle, x: number, baseline: number, width: number): void;
}
function newLine(style: ComponentStyle): RichLine {
  const size = resolveFontSize(style).fontSizePt;
  return { runs: [], width: 0, height: size * resolveLineHeight(style), fontSize: size };
}
function append(line: RichLine, text: string, style: ComponentStyle, width: number): void {
  const previous = line.runs[line.runs.length - 1];
  if (previous?.style === style) { previous.text += text; previous.width += width; }
  else line.runs.push({ text, style, width });
  const size = resolveFontSize(style).fontSizePt;
  line.width += width; line.fontSize = Math.max(line.fontSize, size); line.height = Math.max(line.height, size * resolveLineHeight(style));
}
function paragraphLines(component: PlanComponent, index: number, available: number, indent: number, drawing: RichDrawing): RichLine[] {
  const paragraph = component.richParagraphs![index]!, base = mergeComponentStyles(component.style, { ...(paragraph.lineHeight === undefined ? {} : { lineHeight: paragraph.lineHeight }) });
  const lines = [newLine(base)];
  for (const segment of paragraph.segments) {
    const style = mergeComponentStyles(base, segment.style), text = segment.kind === "field" ? segment.field ?? "" : segment.text ?? "";
    for (const character of text.replace(/\r\n|\r/g, "\n")) {
      let line = lines[lines.length - 1]!;
      if (character === "\n") { lines.push(newLine(style)); continue; }
      const width = drawing.measure(character, style);
      if (line.runs.length && line.width + width > available - (lines.length === 1 ? indent : 0)) { line.justify = true; line = newLine(style); lines.push(line); }
      append(line, character, style, width);
    }
  }
  return lines;
}
/** Bounded paragraph runs preserve basic font decoration; component layout still owns available height. */
export function drawRichText(component: PlanComponent, box: { x: number; yTop: number; width: number; height: number }, drawing: RichDrawing): boolean {
  const paragraphs = component.richParagraphs!.map((paragraph, index) => {
    const indent = (paragraph.indentMm ?? 0) * 72 / 25.4;
    const lines = paragraphLines(component, index, box.width, indent, drawing);
    const height = lines.reduce((total, line) => total + line.height, 0) + ((paragraph.spaceBeforeMm ?? 0) + (paragraph.spaceAfterMm ?? 0)) * 72 / 25.4;
    return { paragraph, indent, lines, height };
  });
  const height = paragraphs.reduce((total, paragraph) => total + paragraph.height, 0), alignment = component.style?.verticalAlign;
  let top = box.yTop - (alignment === "middle" ? (box.height - height) / 2 : alignment === "bottom" ? box.height - height : 0);
  for (const { paragraph, indent, lines } of paragraphs) {
    top -= (paragraph.spaceBeforeMm ?? 0) * 72 / 25.4;
    const available = Math.max(0, box.width - indent);
    for (const [lineIndex, line] of lines.entries()) {
      const align = paragraph.align ?? component.style?.align;
      const lineIndent = lineIndex === 0 ? indent : 0, lineWidth = lineIndex === 0 ? available : box.width;
      let x = box.x + lineIndent + (align === "center" ? (lineWidth - line.width) / 2 : align === "right" ? lineWidth - line.width : 0);
      if (align === "justify" && line.justify) drawJustifiedRichLine(line, drawing, x, top - line.fontSize, lineWidth);
      else for (const run of line.runs) { drawing.draw(run.text, { ...run.style, align: "left" }, x, top - line.fontSize, run.width); x += run.width; }
      top -= line.height;
    }
    top -= (paragraph.spaceAfterMm ?? 0) * 72 / 25.4;
  }
  return height > box.height + 0.01;
}

function drawJustifiedRichLine(line: RichLine, drawing: RichDrawing, x: number, baseline: number, available: number): void {
  line = trimJustifiedLine(line, drawing);
  const chunks = justificationChunks(line.runs.map(run => run.text).join(""));
  const extra = chunks.length > 1 ? Math.max(0, available - line.width) / (chunks.length - 1) : 0;
  const boundaries = new Set<number>();
  let total = 0;
  for (const chunk of chunks.slice(0, -1)) { total += chunk.length; boundaries.add(total); }
  let offset = 0;
  for (const run of line.runs) {
    let text = "", width = 0;
    const flush = (): void => { if (text) drawing.draw(text, { ...run.style, align: "left" }, x, baseline, width); x += width; text = ""; width = 0; };
    for (const character of run.text) {
      text += character; width += drawing.measure(character, run.style); offset += character.length;
      if (boundaries.has(offset)) { flush(); x += extra; }
    }
    flush();
  }
}

function trimJustifiedLine(line: RichLine, drawing: RichDrawing): RichLine {
  const runs = line.runs.slice();
  while (runs.length) {
    const last = runs[runs.length - 1]!, text = last.text.trimEnd();
    if (!text) { runs.pop(); continue; }
    if (text !== last.text) runs[runs.length - 1] = { ...last, text, width: Array.from(text).reduce((sum, character) => sum + drawing.measure(character, last.style), 0) };
    break;
  }
  return { ...line, runs, width: runs.reduce((sum, run) => sum + run.width, 0) };
}
