import type * as ExcelJS from "exceljs";
import type { ComponentStyle, GridCell, RichParagraph } from "../schema/render-plan";
import { mergeComponentStyles, resolveFontSize } from "../render/style";

export function excelRichText(paragraphs: RichParagraph[], base?: ComponentStyle): ExcelJS.CellRichTextValue {
  return { richText: paragraphs.flatMap((paragraph, index) => [
    ...(index ? [{ text: "\n" }] : []),
    ...paragraph.segments.map(segment => {
      const style = mergeComponentStyles(base, segment.style), color = style.color?.replace(/^#/, "");
      return { text: segment.kind === "field" ? segment.field ?? "" : segment.text ?? "", font: { name: style.fontFamily, bold: style.bold, italic: style.italic, underline: style.underline, size: resolveFontSize(style).fontSizePt, ...(/^[a-f\d]{6}$/i.test(color ?? "") ? { color: { argb: `FF${color!.toUpperCase()}` } } : {}) } };
    })
  ]) };
}
export function cellRichText(cell: GridCell, base?: ComponentStyle): ExcelJS.CellRichTextValue | undefined {
  const textChildren = cell.children?.filter(child => child.kind === "text" && !child.grid) ?? [];
  if (!cell.richParagraphs?.length && !textChildren.length) return;
  const style = mergeComponentStyles(base, cell.style);
  const paragraphs: RichParagraph[] = cell.richParagraphs?.length ? [...cell.richParagraphs] : cell.text ? [{ segments: [{ text: cell.text }] }] : [];
  for (const child of textChildren) {
    const childStyle = mergeComponentStyles(style, child.style);
    const values = child.richParagraphs?.length ? child.richParagraphs : [{ segments: [{ text: child.lines?.join("\n") ?? child.text ?? "" }] }];
    for (const paragraph of values) paragraphs.push({ ...paragraph, segments: paragraph.segments.map(segment => ({ ...segment, style: mergeComponentStyles(childStyle, segment.style) })) });
  }
  return excelRichText(paragraphs, style);
}
