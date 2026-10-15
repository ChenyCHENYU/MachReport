import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFName, PDFRawStream, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { ComponentStyle, PlanComponent, RenderPlan } from "../schema/render-plan";
import {
  heuristicMeasurer,
  isImageBackedComponent,
  isRichText,
  mergeComponentStyles,
  resolveBoxBorders,
  resolveFontSize,
  resolveLineHeight,
  resolveStroke,
  resolveGridLayout,
  wrapText,
  type TextMeasurer
} from "../index";

export interface PdfRenderOptions {
  /** 嵌入字体字节（TTF，如黑体）；缺省用 Helvetica（不支持 CJK） */
  customFontBytes?: Uint8Array | ArrayBuffer;
  customFontName?: string;
  /** 文本测量器（默认启发式；与分页/Canvas 注入同一实例可消除折行差异） */
  measurer?: TextMeasurer;
}

/**
 * PDF 文档句柄（不透明最小面）：结构化仅暴露 save()，
 * 避免在公共类型面泄漏 pdf-lib 类型（引擎保持零运行时依赖声明）。
 */
export type PdfDocumentHandle = {
  save(): Promise<Uint8Array>;
};

export interface PdfRenderResult {
  pdfDoc: PdfDocumentHandle;
  bytes: Uint8Array;
  pageErrors: string[];
  unsupportedTextCount: number;
  /** 保真度降级清单（富文本转纯文本、图片格式不支持等），供上层提示 */
  fidelityWarnings: string[];
}

const MM_TO_PT = 72 / 25.4;
/** 分页 mm→PDF pt 的浮点往返误差；小于可见排版差异，不能吞掉真实高度不足。 */
const TEXT_HEIGHT_EPSILON_PT = 0.01;

function isOpenTypeContainer(input: Uint8Array | ArrayBuffer | undefined): boolean {
  if (!input) return false;
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  return bytes[0] === 0x4f && bytes[1] === 0x54 && bytes[2] === 0x54 && bytes[3] === 0x4f;
}

// pdf-lib 依赖 font.cff，fontkit 当前只暴露 CFF 表；补齐标识，避免把 OTF 当作 TrueType。
const compatibleFontkit = {
  create(bytes: Uint8Array, postscriptName?: string) {
    const font = fontkit.create(bytes, postscriptName);
    if (isOpenTypeContainer(bytes)) font.cff = true;
    return font;
  }
};

async function preserveOpenTypeContainer(document: PDFDocument): Promise<void> {
  await document.flush();
  // 完整 OTF 包含 OTTO 容器，不是裸 CFF 数据；FontFile3 必须声明 OpenType。
  for (const [, object] of document.context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream && object.dict.get(PDFName.of("Subtype")) === PDFName.of("CIDFontType0C")) {
      object.dict.set(PDFName.of("Subtype"), PDFName.of("OpenType"));
    }
  }
}

function mmToPt(mm: number): number {
  return (mm || 0) * MM_TO_PT;
}

function colorOf(value: string | undefined, fallback: [number, number, number] = [0, 0, 0]) {
  if (!value) return rgb(fallback[0], fallback[1], fallback[2]);
  const hex = value.replace("#", "");
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return rgb(
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255
    );
  }
  return rgb(fallback[0], fallback[1], fallback[2]);
}

const fontCharacterSets = new WeakMap<PDFFont, ReadonlySet<number>>();

function encodeText(font: PDFFont, text: string): { encoded: string; supported: boolean } {
  try {
    let characterSet = fontCharacterSets.get(font);
    if (!characterSet) {
      characterSet = new Set(font.getCharacterSet());
      fontCharacterSets.set(font, characterSet);
    }
    // fontkit 可把缺失字符编码为 .notdef 而不抛错；必须显式检查 Unicode 码点。
    for (const character of text) {
      if (!characterSet.has(character.codePointAt(0)!)) return { encoded: "", supported: false };
    }
    font.encodeText(text);
    return { encoded: text, supported: true };
  } catch {
    return { encoded: "", supported: false };
  }
}

interface PdfRenderer {
  document: PDFDocument;
  fonts: { regular: PDFFont; bold: PDFFont; italic: PDFFont; boldItalic: PDFFont };
  customFont?: PDFFont;
  measurer: TextMeasurer;
  imageCache: Map<string, Promise<PDFImage | null>>;
  fidelityWarnings: string[];
  styleWarnings: Set<string>;
  unsupportedTextCount: number;
}

interface TextBox {
  x: number;
  yTop: number;
  width: number;
  height: number;
}

function componentBox(comp: PlanComponent, pageHeightPt: number): TextBox {
  return {
    x: mmToPt(comp.leftMm),
    yTop: pageHeightPt - mmToPt(comp.topMm),
    width: mmToPt(comp.widthMm),
    height: mmToPt(comp.heightMm)
  };
}

/** 富文本降级：保留段落顺序；内联样式通过保真告警明确说明。 */
function richTextToLines(comp: PlanComponent): string[] {
  return (comp.richParagraphs ?? []).map((para) => (para.segments ?? [])
    .map((seg) => (seg.kind === "field" ? (seg.field ?? "") : (seg.text ?? ""))).join(""));
}

function fontForStyle(renderer: PdfRenderer, style: ComponentStyle): PDFFont {
  if (renderer.customFont) return renderer.customFont;
  if (style.bold && style.italic) return renderer.fonts.boldItalic;
  if (style.bold) return renderer.fonts.bold;
  if (style.italic) return renderer.fonts.italic;
  return renderer.fonts.regular;
}

function warnStyle(renderer: PdfRenderer, key: string, message: string, location: string): void {
  if (renderer.styleWarnings.has(key)) return;
  renderer.styleWarnings.add(key);
  renderer.fidelityWarnings.push(`${location}: ${message}`);
}

function checkTextStyle(renderer: PdfRenderer, style: ComponentStyle, location: string): void {
  if (renderer.customFont && (style.bold || style.italic)) {
    warnStyle(renderer, "custom-font-weight", "自定义 PDF 字体只提供单个字面，粗体/斜体按该字体自身字形导出", location);
  }
  if (style.align === "justify") warnStyle(renderer, "justify", "PDF 两端对齐暂按左对齐导出", location);
  if (style.fontFamily && !renderer.customFont) warnStyle(renderer, "font-family", "PDF 字体族需提供 customFontBytes；当前使用内置 Helvetica", location);
  if (style.letterSpacing) warnStyle(renderer, "letter-spacing", "PDF 字间距暂未应用", location);
  if (style.rotateDeg) warnStyle(renderer, "rotate", "PDF 文字旋转暂未应用", location);
  if (style.opacity !== undefined && style.opacity !== 1) warnStyle(renderer, "opacity", "PDF 透明度暂未应用", location);
}

function drawTextLine(renderer: PdfRenderer, page: PDFPage, line: string, style: ComponentStyle, box: TextBox, baseline: number): void {
  const font = fontForStyle(renderer, style);
  const { encoded, supported } = encodeText(font, line);
  if (line && !supported) renderer.unsupportedTextCount++;
  if (!encoded) return;
  const size = resolveFontSize(style).fontSizePt;
  const width = font.widthOfTextAtSize(encoded, size);
  let x = box.x;
  if (style.align === "center") x += (box.width - width) / 2;
  else if (style.align === "right") x += box.width - width;
  const color = colorOf(style.color);
  page.drawText(encoded, { x, y: baseline, size, font, color });
  if (style.underline) {
    page.drawLine({ start: { x, y: baseline - 1 }, end: { x: x + width, y: baseline - 1 }, thickness: Math.max(0.4, size / 20), color });
  }
}

function drawTextLines(renderer: PdfRenderer, page: PDFPage, lines: string[], style: ComponentStyle, box: TextBox): void {
  const allLines = lines.flatMap((line) => line.split(/\r\n|\r|\n/));
  const fontSize = resolveFontSize(style).fontSizePt;
  const lineHeight = fontSize * resolveLineHeight(style);
  const textHeight = allLines.length * lineHeight;
  let top = box.yTop;
  if (style.verticalAlign === "middle") top -= (box.height - textHeight) / 2;
  else if (style.verticalAlign === "bottom") top -= box.height - textHeight;
  allLines.forEach((line, index) => drawTextLine(renderer, page, line, style, box, top - fontSize - index * lineHeight));
}

function wrappedLines(renderer: PdfRenderer, text: string, widthMm: number, style: ComponentStyle): string[] {
  if (!text) return [];
  return wrapText(text, Math.max(0, widthMm), {
    fontSizePt: resolveFontSize(style).fontSizePt,
    bold: style.bold
  }, renderer.measurer);
}

function textComponentLines(renderer: PdfRenderer, comp: PlanComponent, location: string): string[] {
  if (isRichText(comp)) {
    renderer.fidelityWarnings.push(`${location}: 富文本按纯文本降级导出（内联样式丢失）`);
    return richTextToLines(comp);
  }
  if (Array.isArray(comp.lines) && comp.lines.length) return comp.lines;
  return wrappedLines(renderer, comp.text ?? "", comp.widthMm, comp.style ?? {});
}

function drawTextComponent(renderer: PdfRenderer, page: PDFPage, comp: PlanComponent, box: TextBox, location: string): void {
  const style = comp.style ?? {};
  checkTextStyle(renderer, style, location);
  const lines = textComponentLines(renderer, comp, location);
  const count = lines.reduce((sum, line) => sum + line.split(/\r\n|\r|\n/).length, 0);
  if (count * resolveFontSize(style).fontSizePt * resolveLineHeight(style) > box.height + TEXT_HEIGHT_EPSILON_PT) {
    renderer.fidelityWarnings.push(`${location}: 文本行高超出组件高度，文字已保留，可能超出版面`);
  }
  drawTextLines(renderer, page, lines, style, box);
}

function embedImage(renderer: PdfRenderer, dataUrl: string): Promise<PDFImage | null> {
  const cached = renderer.imageCache.get(dataUrl);
  if (cached) return cached;
  const promise = (async (): Promise<PDFImage | null> => {
    try {
      const match = /^data:image\/(png|jpe?g);base64,(.*)$/s.exec(dataUrl);
      if (!match) return null;
      const bytes = Uint8Array.from(atob(match[2]!), (character) => character.charCodeAt(0));
      return match[1] === "png" ? await renderer.document.embedPng(bytes) : await renderer.document.embedJpg(bytes);
    } catch { return null; }
  })();
  renderer.imageCache.set(dataUrl, promise);
  return promise;
}

function drawBackground(page: PDFPage, box: TextBox, background: string | undefined): void {
  if (!background) return;
  page.drawRectangle({
    x: box.x, y: box.yTop - box.height,
    width: box.width, height: box.height,
    color: colorOf(background, [1, 1, 1])
  });
}

function drawBorderLine(page: PDFPage, style: ComponentStyle | undefined, start: { x: number; y: number }, end: { x: number; y: number }): void {
  const stroke = resolveStroke(style);
  page.drawLine({ start, end, thickness: Math.max(0.1, stroke.widthPt), color: colorOf(stroke.color, [0.2, 0.2, 0.2]) });
}

function drawBoxBorders(page: PDFPage, style: ComponentStyle | undefined, box: TextBox): void {
  const borders = resolveBoxBorders(style);
  const right = box.x + box.width;
  const bottom = box.yTop - box.height;
  if (borders.top) drawBorderLine(page, style, { x: box.x, y: box.yTop }, { x: right, y: box.yTop });
  if (borders.right) drawBorderLine(page, style, { x: right, y: box.yTop }, { x: right, y: bottom });
  if (borders.bottom) drawBorderLine(page, style, { x: right, y: bottom }, { x: box.x, y: bottom });
  if (borders.left) drawBorderLine(page, style, { x: box.x, y: bottom }, { x: box.x, y: box.yTop });
}

function drawGridEdges(page: PDFPage, comp: PlanComponent, box: TextBox, layout: ReturnType<typeof resolveGridLayout>): void {
  if (!resolveBoxBorders(comp.style).inner) return;
  for (const edge of layout.edges) {
    if (edge.kind === "v") {
      drawBorderLine(page, comp.style,
        { x: box.x + mmToPt(edge.pos), y: box.yTop - mmToPt(edge.to) },
        { x: box.x + mmToPt(edge.pos), y: box.yTop - mmToPt(edge.from) });
    } else {
      drawBorderLine(page, comp.style,
        { x: box.x + mmToPt(edge.from), y: box.yTop - mmToPt(edge.pos) },
        { x: box.x + mmToPt(edge.to), y: box.yTop - mmToPt(edge.pos) });
    }
  }
  drawBoxBorders(page, comp.style, box);
}

function drawGridCell(
  renderer: PdfRenderer, page: PDFPage, comp: PlanComponent,
  cell: ReturnType<typeof resolveGridLayout>["cells"][number], origin: TextBox, location: string
): void {
  const style = mergeComponentStyles(comp.style, cell.cell.style);
  const box = {
    x: origin.x + mmToPt(cell.xMm), yTop: origin.yTop - mmToPt(cell.yMm),
    width: mmToPt(cell.widthMm), height: mmToPt(cell.heightMm)
  };
  drawBackground(page, box, style.backgroundColor);
  if (cell.cell.children?.length) renderer.fidelityWarnings.push(`${location}: 嵌套组件暂不支持 PDF 导出，已跳过；单元格文本保留`);
  if (!cell.cell.text) return;
  checkTextStyle(renderer, style, location);
  const paddingMm = comp.grid?.paddingMm ?? 0.5;
  const padding = mmToPt(paddingMm);
  const content = {
    x: box.x + padding, yTop: box.yTop - padding,
    width: Math.max(0, box.width - 2 * padding), height: Math.max(0, box.height - 2 * padding)
  };
  const lines = wrappedLines(renderer, cell.cell.text, cell.widthMm - 2 * paddingMm, style);
  const lineHeight = resolveFontSize(style).fontSizePt * resolveLineHeight(style);
  const capacity = Math.floor((content.height + TEXT_HEIGHT_EPSILON_PT) / lineHeight);
  const maxLines = Math.max(1, capacity);
  if (lines.length > capacity) {
    renderer.fidelityWarnings.push(`${location}: 单元格文本超出可用高度，PDF 文本裁切；请增加行高或减少字号（${lines.length} 行，可容纳 ${capacity} 行）`);
  }
  drawTextLines(renderer, page, lines.slice(0, maxLines), { verticalAlign: "middle", ...style }, content);
}

function drawGrid(renderer: PdfRenderer, page: PDFPage, comp: PlanComponent, box: TextBox, location: string): void {
  const layout = resolveGridLayout(comp.grid!, comp.widthMm, comp.heightMm);
  drawBackground(page, box, comp.style?.backgroundColor);
  // 底色先绘制，边框最后一次绘制，避免重复外框与覆盖内部网格线。
  for (const cell of layout.cells) drawGridCell(renderer, page, comp, cell, box, `${location} cell ${cell.ri + 1}:${cell.ci + 1}`);
  drawGridEdges(page, comp, box, layout);
}

function drawShape(page: PDFPage, comp: PlanComponent, box: TextBox): boolean {
  if (comp.kind === "rect") {
    drawBackground(page, box, comp.style?.backgroundColor);
    drawBoxBorders(page, comp.style, box);
    return true;
  }
  if (comp.kind === "line") {
    const style = { ...comp.style, borderColor: comp.style?.lineColor ?? comp.style?.borderColor };
    drawBorderLine(page, style,
      { x: box.x, y: box.yTop - box.height / 2 },
      { x: box.x + box.width, y: box.yTop - box.height / 2 });
    return true;
  }
  if (comp.kind === "ellipse") {
    const stroke = resolveStroke(comp.style);
    page.drawEllipse({
      x: box.x + box.width / 2, y: box.yTop - box.height / 2,
      xScale: box.width / 2, yScale: box.height / 2,
      color: comp.style?.backgroundColor ? colorOf(comp.style.backgroundColor, [1, 1, 1]) : undefined,
      borderColor: colorOf(stroke.color, [0.2, 0.2, 0.2]),
      borderWidth: Math.max(0.1, stroke.widthPt)
    });
    return true;
  }
  return false;
}

async function drawComponent(renderer: PdfRenderer, page: PDFPage, comp: PlanComponent, pageHeightPt: number, location: string): Promise<void> {
  const box = componentBox(comp, pageHeightPt);
  if (isImageBackedComponent(comp)) {
    const image = await embedImage(renderer, comp.imageData!);
    if (image) page.drawImage(image, { x: box.x, y: box.yTop - box.height, width: box.width, height: box.height });
    else renderer.fidelityWarnings.push(`${location}: 图片仅支持 data:image/(png|jpeg) base64，已跳过`);
  } else if (comp.grid) {
    drawGrid(renderer, page, comp, box, location);
  } else if (comp.kind === "text") {
    drawTextComponent(renderer, page, comp, box, location);
  } else if (!drawShape(page, comp, box)) {
    if (comp.text) drawTextComponent(renderer, page, comp, box, location);
    else renderer.fidelityWarnings.push(`${location}: 组件类型 ${comp.kind} 缺少可导出的图片或文本，已跳过`);
  }
}

async function createRenderer(document: PDFDocument, options: PdfRenderOptions): Promise<PdfRenderer> {
  const customFont = options.customFontBytes
    // fontkit 的子集重写可能损坏 CJK 轮廓：字符可提取却在阅读器中不可见。
    // 完整嵌入优先保证输出可见性；宿主仍可提供预先验证的字体子集来控制体积。
    ? await document.embedFont(options.customFontBytes as unknown as ArrayBuffer, { subset: false })
    : undefined;
  const [regular, bold, italic, boldItalic] = await Promise.all([
    document.embedFont(StandardFonts.Helvetica), document.embedFont(StandardFonts.HelveticaBold),
    document.embedFont(StandardFonts.HelveticaOblique), document.embedFont(StandardFonts.HelveticaBoldOblique)
  ]);
  return {
    document, fonts: { regular, bold, italic, boldItalic }, customFont,
    measurer: options.measurer ?? heuristicMeasurer,
    imageCache: new Map(), fidelityWarnings: [], styleWarnings: new Set(), unsupportedTextCount: 0
  };
}

export async function renderPlanToPdf(plan: RenderPlan, options: PdfRenderOptions = {}): Promise<PdfRenderResult> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(compatibleFontkit);
  const renderer = await createRenderer(pdfDoc, options);
  const pageErrors: string[] = [];
  for (const [pageIndex, planPage] of plan.pages.entries()) {
    const widthPt = mmToPt(planPage.pageWidthMm);
    const heightPt = mmToPt(planPage.pageHeightMm);
    if (widthPt > 14_400 || heightPt > 14_400) {
      renderer.fidelityWarnings.push(`page ${pageIndex + 1}: PDF 页面超过常规阅读器的 200 英寸尺寸范围，阅读器可能裁切；建议选择标准纸型或分拆宽表`);
    }
    const page = pdfDoc.addPage([widthPt, heightPt]);
    for (const comp of planPage.components) {
      const location = `page ${pageIndex + 1} ${comp.nid ?? comp.kind}`;
      try {
        await drawComponent(renderer, page, comp, heightPt, location);
      } catch (error) {
        pageErrors.push(`page ${pageIndex + 1} comp ${comp.nid ?? comp.kind}: ${String(error)}`);
      }
    }
  }
  if (isOpenTypeContainer(options.customFontBytes)) await preserveOpenTypeContainer(pdfDoc);
  const bytes = await pdfDoc.save();
  return {
    pdfDoc, bytes, pageErrors,
    unsupportedTextCount: renderer.unsupportedTextCount,
    fidelityWarnings: renderer.fidelityWarnings
  };
}
