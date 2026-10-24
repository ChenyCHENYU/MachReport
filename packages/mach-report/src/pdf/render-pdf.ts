import { outputCheckpoint, createOutputScheduler, type OutputTaskOptions } from "../output/progress";
import { PDFDocument, StandardFonts, rgb, pushGraphicsState, popGraphicsState, rectangle, clip, endPath, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { drawPdfRichText } from "./rich-text";
import { createPdfFontEmbedding, type PdfFontEmbedding } from "./font-embedding";
import type { ComponentStyle, PlanComponent, RenderPlan } from "../schema/render-plan";
import { reportOutputDiagnostics, OutputFidelityError, type OutputDiagnostic } from "../output/capabilities";
import { createImageMediaInspector, ImageMediaError, type ImageMediaOptions } from "../output/media";
import { notifyOutputDiagnostic } from "../output/diagnostic-notification";
import { resolvePlanAssets, type AssetRenderOptions } from "../output/assets";
import { resolveGridStrokes } from "../render/grid-strokes";
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

export interface PdfRenderOptions extends AssetRenderOptions, OutputTaskOptions, ImageMediaOptions {
  /** 嵌入字体字节（TTF，如黑体）；缺省用 Helvetica（不支持 CJK） */
  customFontBytes?: Uint8Array | ArrayBuffer;
  customFontName?: string;
  /** Explicit faces preserve bold/italic; missing faces fall back to regular and emit a fidelity warning. */
  customFontFaces?: {
    regular: Uint8Array | ArrayBuffer;
    bold?: Uint8Array | ArrayBuffer;
    italic?: Uint8Array | ArrayBuffer;
    boldItalic?: Uint8Array | ArrayBuffer;
  };
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
  diagnostics: OutputDiagnostic[];
}

const MM_TO_PT = 72 / 25.4;
/** 分页 mm→PDF pt 的浮点往返误差；小于可见排版差异，不能吞掉真实高度不足。 */
const TEXT_HEIGHT_EPSILON_PT = 0.01;

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
  signal?: AbortSignal;
  schedule: ReturnType<typeof createOutputScheduler>;
  document: PDFDocument;
  fonts: { regular: PDFFont; bold: PDFFont; italic: PDFFont; boldItalic: PDFFont };
  customFont?: PDFFont;
  customFontFaces?: PdfRenderOptions["customFontFaces"];
  embedding: PdfFontEmbedding;
  measurer: TextMeasurer;
  imageCache: Map<string, Promise<PDFImage | null>>;
  inspectImage: ReturnType<typeof createImageMediaInspector>;
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

function fontForStyle(renderer: PdfRenderer, style: ComponentStyle): PDFFont {
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
  const faces = renderer.customFontFaces;
  const missingFace = style.bold && style.italic ? !faces?.boldItalic : style.bold ? !faces?.bold : style.italic ? !faces?.italic : false;
  if (renderer.customFont && missingFace) {
    warnStyle(renderer, "custom-font-weight", "自定义 PDF 字体只提供单个字面，粗体/斜体按该字体自身字形导出", location);
  }
  if (style.align === "justify") warnStyle(renderer, "justify", "PDF 两端对齐暂按左对齐导出", location);
  if (style.fontFamily && style.fontFamily.trim().toLowerCase() !== "helvetica" && !renderer.customFont) warnStyle(renderer, "font-family", "PDF 字体族需提供 customFontBytes；当前使用内置 Helvetica", location);
  if (style.rotateDeg) warnStyle(renderer, "rotate", "PDF 文字旋转暂未应用", location);
  if (style.opacity !== undefined && style.opacity !== 1) warnStyle(renderer, "opacity", "PDF 透明度暂未应用", location);
}

function drawTextLine(renderer: PdfRenderer, page: PDFPage, line: string, style: ComponentStyle, box: TextBox, baseline: number): void {
  const font = fontForStyle(renderer, style);
  const { encoded, supported } = encodeText(font, line);
  if (line && !supported) renderer.unsupportedTextCount++;
  if (!encoded) return;
  const size = resolveFontSize(style).fontSizePt;
  const characters = Array.from(encoded);
  const spacing = style.letterSpacing ?? 0;
  const width = font.widthOfTextAtSize(encoded, size) + Math.max(0, characters.length - 1) * spacing;
  let x = box.x;
  if (style.align === "center") x += (box.width - width) / 2;
  else if (style.align === "right") x += box.width - width;
  const color = colorOf(style.color);
  if (spacing) {
    let prefix = "";
    characters.forEach((character, index) => {
      page.drawText(character, { x: x + font.widthOfTextAtSize(prefix, size) + index * spacing, y: baseline, size, font, color });
      prefix += character;
    });
  } else page.drawText(encoded, { x, y: baseline, size, font, color });
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
    bold: style.bold,
    italic: style.italic,
    fontFamily: style.fontFamily,
    letterSpacingPt: style.letterSpacing
  }, renderer.measurer);
}

function textComponentLines(renderer: PdfRenderer, comp: PlanComponent): string[] {
  if (Array.isArray(comp.lines) && comp.lines.length) return comp.lines;
  return wrappedLines(renderer, comp.text ?? "", comp.widthMm, comp.style ?? {});
}

function drawTextComponent(renderer: PdfRenderer, page: PDFPage, comp: PlanComponent, box: TextBox, location: string): void {
  const style = comp.style ?? {};
  checkTextStyle(renderer, style, location);
  if (isRichText(comp)) {
    const overflow = drawPdfRichText(comp, box, {
      measure(text, runStyle) {
        const font = fontForStyle(renderer, runStyle), size = resolveFontSize(runStyle).fontSizePt;
        try { return font.widthOfTextAtSize(text, size) + (runStyle.letterSpacing ?? 0); } catch { return size; }
      },
      draw(text, runStyle, x, baseline, width) {
        checkTextStyle(renderer, runStyle, location);
        const size = resolveFontSize(runStyle).fontSizePt;
        drawBackground(page, { x, yTop: baseline + size, width, height: size * resolveLineHeight(runStyle) }, runStyle.backgroundColor);
        drawTextLine(renderer, page, text, runStyle, { ...box, x, width }, baseline);
      }
    });
    if (overflow) renderer.fidelityWarnings.push(`${location}: 富文本超出组件高度，请增加高度`);
    return;
  }
  const lines = textComponentLines(renderer, comp);
  const count = lines.reduce((sum, line) => sum + line.split(/\r\n|\r|\n/).length, 0);
  if (count * resolveFontSize(style).fontSizePt * resolveLineHeight(style) > box.height + TEXT_HEIGHT_EPSILON_PT) {
    renderer.fidelityWarnings.push(`${location}: 文本行高超出组件高度，文字已保留，可能超出版面`);
  }
  drawTextLines(renderer, page, lines, style, box);
}

function embedImage(renderer: PdfRenderer, dataUrl: string): Promise<PDFImage | null> {
  if (!/^data:image\/(png|jpe?g);base64,/i.test(dataUrl)) return Promise.resolve(null);
  const image = renderer.inspectImage(dataUrl);
  const cached = renderer.imageCache.get(image.dataUrl);
  if (cached) return cached;
  const promise = image.extension === "png" ? renderer.document.embedPng(image.bytes) : renderer.document.embedJpg(image.bytes);
  renderer.imageCache.set(image.dataUrl, promise);
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
  for (const edge of resolveGridStrokes(layout, comp)) {
    const style = { borderColor: edge.color, lineWidthPt: edge.widthPt };
    if (edge.kind === "v") {
      drawBorderLine(page, style,
        { x: box.x + mmToPt(edge.pos), y: box.yTop - mmToPt(edge.to) },
        { x: box.x + mmToPt(edge.pos), y: box.yTop - mmToPt(edge.from) });
    } else {
      drawBorderLine(page, style,
        { x: box.x + mmToPt(edge.from), y: box.yTop - mmToPt(edge.pos) },
        { x: box.x + mmToPt(edge.to), y: box.yTop - mmToPt(edge.pos) });
    }
  }
}

async function drawGridCell(
  renderer: PdfRenderer, page: PDFPage, comp: PlanComponent,
  cell: ReturnType<typeof resolveGridLayout>["cells"][number], origin: TextBox, location: string
): Promise<void> {
  const style = mergeComponentStyles(comp.style, cell.cell.style);
  const box = {
    x: origin.x + mmToPt(cell.xMm), yTop: origin.yTop - mmToPt(cell.yMm),
    width: mmToPt(cell.widthMm), height: mmToPt(cell.heightMm)
  };
  drawBackground(page, box, style.backgroundColor);

  checkTextStyle(renderer, style, location);
  const paddingMm = comp.grid?.paddingMm ?? 0.5;
  const padding = mmToPt(paddingMm);
  const indentMm = cell.cell.indentMm ?? 0, indent = mmToPt(indentMm);
  const content = {
    x: box.x + padding + indent, yTop: box.yTop - padding,
    width: Math.max(0, box.width - 2 * padding - indent), height: Math.max(0, box.height - 2 * padding)
  };
  page.pushOperators(pushGraphicsState(), rectangle(content.x, content.yTop - content.height, content.width, content.height), clip(), endPath());
  try {
    drawCellText(renderer, page, cell.cell, style, content, location);
    for (const child of cell.cell.children ?? []) {
      const positioned = { ...child, leftMm: content.x * 25.4 / 72 + child.leftMm, topMm: -content.yTop * 25.4 / 72 + child.topMm };
      await drawComponent(renderer, page, positioned, 0, location);
    }
  } finally { page.pushOperators(popGraphicsState()); }
}

function drawCellText(renderer: PdfRenderer, page: PDFPage, cell: import("../schema/render-plan").GridCell, style: ComponentStyle, content: TextBox, location: string): void {
  if (cell.richParagraphs?.length) {
    drawTextComponent(renderer, page, { kind: "text", leftMm: 0, topMm: 0, widthMm: content.width * 25.4 / 72, heightMm: content.height * 25.4 / 72, richParagraphs: cell.richParagraphs, style: { verticalAlign: "middle", ...style } }, content, location);
    return;
  }
  if (!cell.text) return;
  const lines = wrappedLines(renderer, cell.text, content.width * 25.4 / 72, style);
  const lineHeight = resolveFontSize(style).fontSizePt * resolveLineHeight(style);
  const capacity = Math.floor((content.height + TEXT_HEIGHT_EPSILON_PT) / lineHeight);
  if (lines.length > capacity) renderer.fidelityWarnings.push(`${location}: 单元格文本超出可用高度，PDF 文本裁切；请增加行高或减少字号（${lines.length} 行，可容纳 ${capacity} 行）`);
  drawTextLines(renderer, page, lines.slice(0, Math.max(1, capacity)), { verticalAlign: "middle", ...style }, content);
}

async function drawGrid(renderer: PdfRenderer, page: PDFPage, comp: PlanComponent, box: TextBox, location: string): Promise<void> {
  const layout = resolveGridLayout(comp.grid!, comp.widthMm, comp.heightMm);
  drawBackground(page, box, comp.style?.backgroundColor);
  // 底色先绘制，边框最后一次绘制，避免重复外框与覆盖内部网格线。
  for (const cell of layout.cells) {
    await drawGridCell(renderer, page, comp, cell, box, `${location} cell ${cell.ri + 1}:${cell.ci + 1}`);
    const pause = renderer.schedule(); if (pause) await pause;
  }
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
    const startY = comp.lineDirection === "up" ? box.yTop - box.height : comp.lineDirection === "down" ? box.yTop : box.yTop - box.height / 2;
    const endY = comp.lineDirection === "up" ? box.yTop : comp.lineDirection === "down" ? box.yTop - box.height : box.yTop - box.height / 2;
    drawBorderLine(page, style,
      { x: box.x, y: startY },
      { x: box.x + box.width, y: endY });
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
  checkCancelled(renderer.signal);
  const box = componentBox(comp, pageHeightPt);
  if (isImageBackedComponent(comp)) {
    const image = await embedImage(renderer, comp.imageData!);
    if (image) {
      const ratio = Math.min(box.width / image.width, box.height / image.height), width = image.width * ratio, height = image.height * ratio;
      page.drawImage(image, { x: box.x + (box.width - width) / 2, y: box.yTop - (box.height + height) / 2, width, height });
    }
    else renderer.fidelityWarnings.push(`${location}: 图片仅支持 data:image/(png|jpeg) base64，已跳过`);
  } else if (comp.grid) {
    await drawGrid(renderer, page, comp, box, location);
  } else if (comp.kind === "text") {
    drawTextComponent(renderer, page, comp, box, location);
  } else if (!drawShape(page, comp, box)) {
    if (comp.text) drawTextComponent(renderer, page, comp, box, location);
    else renderer.fidelityWarnings.push(`${location}: 组件类型 ${comp.kind} 缺少可导出的图片或文本，已跳过`);
  }
}

async function createRenderer(document: PDFDocument, options: PdfRenderOptions): Promise<PdfRenderer> {
  const embedding = createPdfFontEmbedding(document);
  const regularBytes = options.customFontFaces?.regular ?? options.customFontBytes;
  const fontCache = new Map<Uint8Array | ArrayBuffer, Promise<PDFFont>>();
  const customFont = regularBytes
    // fontkit 的子集重写可能损坏 CJK 轮廓：字符可提取却在阅读器中不可见。
    // 完整嵌入优先保证输出可见性；宿主仍可提供预先验证的字体子集来控制体积。
    ? await embedFontBytes(embedding, regularBytes, fontCache)
    : undefined;
  const [regular, bold, italic, boldItalic] = await Promise.all([
    document.embedFont(StandardFonts.Helvetica), document.embedFont(StandardFonts.HelveticaBold),
    document.embedFont(StandardFonts.HelveticaOblique), document.embedFont(StandardFonts.HelveticaBoldOblique)
  ]);
  const fonts = customFont ? {
    regular: customFont,
    bold: await embedFace(embedding, options.customFontFaces?.bold, customFont, fontCache),
    italic: await embedFace(embedding, options.customFontFaces?.italic, customFont, fontCache),
    boldItalic: await embedFace(embedding, options.customFontFaces?.boldItalic, customFont, fontCache)
  } : { regular, bold, italic, boldItalic };
  return {
    signal: options.signal, schedule: createOutputScheduler(options), document, fonts, customFont, customFontFaces: options.customFontFaces, embedding,
    measurer: options.measurer ?? heuristicMeasurer,
    imageCache: new Map(), inspectImage: createImageMediaInspector(options), fidelityWarnings: [], styleWarnings: new Set(), unsupportedTextCount: 0
  };
}

async function embedFace(embedding: PdfFontEmbedding, bytes: Uint8Array | ArrayBuffer | undefined, fallback: PDFFont, cache: Map<Uint8Array | ArrayBuffer, Promise<PDFFont>>): Promise<PDFFont> {
  return bytes ? embedFontBytes(embedding, bytes, cache) : fallback;
}

function embedFontBytes(embedding: PdfFontEmbedding, bytes: Uint8Array | ArrayBuffer, cache: Map<Uint8Array | ArrayBuffer, Promise<PDFFont>>): Promise<PDFFont> {
  let font = cache.get(bytes);
  if (!font) { font = embedding.embed(bytes); cache.set(bytes, font); }
  return font;
}

export async function renderPlanToPdf(plan: RenderPlan, options: PdfRenderOptions = {}): Promise<PdfRenderResult> {
  const prepared = await resolvePlanAssets(plan, { ...options, format: "pdf" });
  plan = prepared.plan;
  const diagnostics = [...prepared.diagnostics, ...reportOutputDiagnostics(plan, "pdf", options)];
  const initialDiagnosticCount = diagnostics.length;
  const pdfDoc = await PDFDocument.create();
  const renderer = await createRenderer(pdfDoc, options);
  const pageErrors: string[] = [];
  for (const [pageIndex, planPage] of plan.pages.entries()) {
    checkCancelled(options.signal);
    const widthPt = mmToPt(planPage.pageWidthMm);
    const heightPt = mmToPt(planPage.pageHeightMm);
    if (widthPt > 14_400 || heightPt > 14_400) {
      const message = `page ${pageIndex + 1}: PDF 页面超过常规阅读器的 200 英寸尺寸范围，阅读器可能裁切；建议选择标准纸型或分拆宽表`;
      renderer.fidelityWarnings.push(message);
      diagnostics.push({ code: "output-degraded", severity: "warning", format: "pdf", pageIndex, componentIndex: -1, kind: "page", message });
    }
    const page = pdfDoc.addPage([widthPt, heightPt]);
    for (const [componentIndex, comp] of planPage.components.entries()) {
      checkCancelled(options.signal);
      const location = `page ${pageIndex + 1} ${comp.nid ?? comp.kind}`;
      const previousWarnings = renderer.fidelityWarnings.length, previousUnsupported = renderer.unsupportedTextCount;
      try {
        await drawComponent(renderer, page, comp, heightPt, location);
      } catch (error) {
        if (error instanceof ImageMediaError && error.code === "image-budget-exceeded") throw error;
        pageErrors.push(`page ${pageIndex + 1} comp ${comp.nid ?? comp.kind}: ${String(error)}`);
        diagnostics.push({ code: error instanceof ImageMediaError ? error.code : "component-render-failed", severity: "warning", format: "pdf", pageIndex, componentIndex, kind: comp.kind, nid: comp.nid, message: String(error) });
      }
      const locationDiagnostic = { severity: "warning" as const, format: "pdf" as const, pageIndex, componentIndex, kind: comp.kind, nid: comp.nid };
      if (renderer.unsupportedTextCount > previousUnsupported) diagnostics.push({ ...locationDiagnostic, code: "unsupported-text", message: "Text contains characters missing from the output font." });
      for (const message of renderer.fidelityWarnings.slice(previousWarnings)) diagnostics.push({ ...locationDiagnostic, code: "output-degraded", message });
    }
    await outputCheckpoint(options, pageIndex + 1, plan.pages.length);
  }
  checkCancelled(options.signal);
  diagnostics.slice(initialDiagnosticCount).forEach(entry => notifyOutputDiagnostic(entry, options));
  if (options.fidelity === "strict" && diagnostics.length) throw new OutputFidelityError(diagnostics);
  await renderer.embedding.finalize();
  const bytes = await pdfDoc.save();
  checkCancelled(options.signal);
  return {
    pdfDoc, bytes, pageErrors,
    unsupportedTextCount: renderer.unsupportedTextCount,
    fidelityWarnings: renderer.fidelityWarnings,
    diagnostics
  };
}

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}
