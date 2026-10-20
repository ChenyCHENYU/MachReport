import { outputCheckpoint } from "../output/progress";
import type { PlanComponent, PlanPage, PlanGrid, RenderPlan } from "../schema/render-plan";
import { isImageBackedComponent, isRichText } from "../schema/render-plan";
import { OutputFidelityError, reportOutputDiagnostics, type OutputDiagnostic, type OutputDiagnosticOptions } from "../output/capabilities";
import { notifyOutputDiagnostic } from "../output/diagnostic-notification";
import { resolvePlanAssets, type AssetRenderOptions } from "../output/assets";
import { drawCanvasImage, loadCanvasImage, loadPageImages, throwIfAborted, type CanvasImageLoader } from "./canvas-images";
import { resolveGridLayout, type GridLayout } from "./grid-geometry";
import { resolveGridStrokes } from "./grid-strokes";
import { wrapText, type TextMeasurer } from "../layout/textwrap";
import { heuristicMeasurer } from "../layout/textwrap";
import { ptToPx } from "../units";
import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_TEXT_COLOR
} from "../defaults";
import {
  mergeComponentStyles,
  resolveBoxBorders,
  resolveFontSize,
  resolveLineHeight,
  resolveStroke,
  resolveTextColor
} from "./style";
import { computePageWindow } from "./window";

export interface CanvasRenderOptions extends OutputDiagnosticOptions {
  /** 设备像素比，默认取运行环境 devicePixelRatio */
  dpr?: number;
  dpi?: number;
  /** Per-page bitmap allocation guard; default 64 million pixels (about 256 MB RGBA). */
  maxCanvasPixels?: number;
  /** 文本默认字体族 */
  fontFamily?: string;
  /** 文本测量器（默认启发式） */
  measurer?: TextMeasurer;
  /** 只渲染页区间（闭区间索引；缺省全渲染——仅小报表使用，大报表请用 createCanvasPager） */
  start?: number;
  end?: number;
}

interface Ctx2D {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

const PX_PER_MM_BASE = 96 / 25.4;

export function measurePageSizePx(
  page: Pick<PlanPage, "pageWidthMm" | "pageHeightMm">,
  dpi = 96
): { widthPx: number; heightPx: number } {
  const pxPerMm = (dpi / 96) * PX_PER_MM_BASE;
  return {
    widthPx: Math.max(1, Math.round(page.pageWidthMm * pxPerMm)),
    heightPx: Math.max(1, Math.round(page.pageHeightMm * pxPerMm))
  };
}

function canvasPixelSize(page: PlanPage, dpr: number, dpi: number, maximum = 64_000_000): { width: number; height: number } {
  if (!Number.isFinite(dpr) || dpr <= 0 || !Number.isFinite(dpi) || dpi <= 0) throw new RangeError("Canvas dpr and dpi must be positive finite numbers.");
  if (!Number.isFinite(maximum) || maximum <= 0) throw new RangeError("maxCanvasPixels must be positive and finite.");
  const size = measurePageSizePx(page, dpi);
  const width = Math.round(size.widthPx * dpr);
  const height = Math.round(size.heightPx * dpr);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width * height > maximum) throw new RangeError("Canvas page exceeds maxCanvasPixels; reduce resolution or split the report.");
  return { width, height };
}

function createPageCanvas(page: PlanPage, dpr: number, dpi: number, maximum?: number): Ctx2D {
  const canvas = document.createElement("canvas");
  const { widthPx: w, heightPx: h } = measurePageSizePx(page, dpi);
  const pixels = canvasPixelSize(page, dpr, dpi, maximum);
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("当前环境不支持 Canvas 2D（测试需真浏览器，见 e2e/canvas.spec.ts）");
  }
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  return { canvas, ctx };
}

/** pt→px 换算（与 DOM 后端 units.ptToPx 同一真相源），供单测直接断言 */
export function planFontSizePx(
  style: { fontSizePx?: number; fontSize?: number } | undefined,
  dpi = 96
): number {
  return resolveFontSize(style, dpi).fontSizePx;
}

interface TextDrawSpec {
  text: string;
  fontSizePx: number;
  bold: boolean;
  italic?: boolean;
  color: string;
  align: "left" | "center" | "right" | "justify";
  lineHeight: number;
  letterSpacingPx?: number;
}

function drawTextBlock(
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
    drawSpacedLine(ctx, line, spec, x, topY + i * lineH + spec.fontSizePx * 0.8, w);
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

function drawGridBorders(
  ctx: CanvasRenderingContext2D,
  layout: GridLayout,
  comp: PlanComponent,
  x: number, y: number,
  pxPerMm: number, dpi: number
): void {
  for (const edge of resolveGridStrokes(layout, comp)) {
    ctx.strokeStyle = edge.color;
    ctx.lineWidth = ptToPx(edge.widthPt, dpi);
    ctx.beginPath();
    if (edge.kind === "v") {
      ctx.moveTo(x + edge.pos * pxPerMm, y + edge.from * pxPerMm);
      ctx.lineTo(x + edge.pos * pxPerMm, y + edge.to * pxPerMm);
    } else {
      ctx.moveTo(x + edge.from * pxPerMm, y + edge.pos * pxPerMm);
      ctx.lineTo(x + edge.to * pxPerMm, y + edge.pos * pxPerMm);
    }
    ctx.stroke();
  }
}

function drawRectangleBorder(
  ctx: CanvasRenderingContext2D,
  borders: ReturnType<typeof resolveBoxBorders>,
  x: number, y: number, w: number, h: number
): void {
  ctx.beginPath();
  if (borders.top) { ctx.moveTo(x, y); ctx.lineTo(x + w, y); }
  if (borders.right) { ctx.moveTo(x + w, y); ctx.lineTo(x + w, y + h); }
  if (borders.bottom) { ctx.moveTo(x + w, y + h); ctx.lineTo(x, y + h); }
  if (borders.left) { ctx.moveTo(x, y + h); ctx.lineTo(x, y); }
  ctx.stroke();
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  grid: PlanGrid,
  comp: PlanComponent,
  x: number, y: number, w: number, h: number,
  pxPerMm: number, dpi: number,
  fontFamily: string,
  measurer: TextMeasurer
): void {
  const layout = resolveGridLayout(grid, w / pxPerMm, h / pxPerMm);
  for (const box of layout.cells) {
    const bg = box.cell.style?.backgroundColor ?? comp.style?.backgroundColor;
    if (!bg) continue;
    ctx.fillStyle = bg;
    ctx.fillRect(x + box.xMm * pxPerMm, y + box.yMm * pxPerMm, box.widthMm * pxPerMm, box.heightMm * pxPerMm);
  }
  drawGridBorders(ctx, layout, comp, x, y, pxPerMm, dpi);
  const paddingMm = grid.paddingMm ?? 0.5;
  for (const box of layout.cells) {
    const text = box.cell.text ?? "";
    if (!text) continue;
    const style = mergeComponentStyles(comp.style, box.cell.style);
    const font = resolveFontSize(style, dpi);
    const indentMm = box.cell.indentMm ?? 0;
    const contentWidthMm = Math.max(0, box.widthMm - 2 * paddingMm - indentMm);
    const lines = wrapText(text, contentWidthMm, { fontSizePt: font.fontSizePt, bold: style.bold, italic: style.italic, fontFamily: style.fontFamily ?? fontFamily, letterSpacingPt: style.letterSpacing }, measurer).join("\n");
    drawTextBlock(ctx, {
      text: lines, fontSizePx: font.fontSizePx,
      bold: style.bold ?? false, italic: style.italic,
      color: resolveTextColor(style, DEFAULT_TEXT_COLOR),
      align: style.align ?? "left", lineHeight: resolveLineHeight(style), letterSpacingPx: ptToPx(style.letterSpacing ?? 0, dpi)
    }, x + (box.xMm + paddingMm + indentMm) * pxPerMm, y + (box.yMm + paddingMm) * pxPerMm,
    contentWidthMm * pxPerMm, Math.max(0, box.heightMm - 2 * paddingMm) * pxPerMm,
    style.fontFamily ?? fontFamily, style.verticalAlign ?? "middle");
  }
}

function drawTextComponent(
  ctx: CanvasRenderingContext2D,
  comp: PlanComponent,
  x: number, y: number, w: number, h: number,
  dpi: number, fontFamily: string, measurer: TextMeasurer
): void {
  const style = comp.style ?? {};
  const font = resolveFontSize(style, dpi);
  const text = isRichText(comp)
    ? comp.richParagraphs!.map((paragraph) => paragraph.segments.map((segment) => segment.text ?? segment.field ?? "").join("")).join("\n")
    : comp.lines?.length ? comp.lines.join("\n") : wrapText(comp.text ?? "", comp.widthMm, { fontSizePt: font.fontSizePt, bold: style.bold, italic: style.italic, fontFamily: style.fontFamily ?? fontFamily, letterSpacingPt: style.letterSpacing }, measurer).join("\n");
  drawTextBlock(ctx, {
    text, fontSizePx: font.fontSizePx, bold: style.bold ?? false, italic: style.italic,
    color: resolveTextColor(style), align: style.align ?? "left", lineHeight: resolveLineHeight(style), letterSpacingPx: ptToPx(style.letterSpacing ?? 0, dpi)
  }, x, y, w, h, style.fontFamily ?? fontFamily, style.verticalAlign);
}

function drawComponent(
  ctx: CanvasRenderingContext2D,
  comp: PlanComponent,
  pxPerMm: number,
  dpi: number,
  fontFamily: string,
  measurer: TextMeasurer,
  images?: Map<string, CanvasImageSource>
): void {
  const x = comp.leftMm * pxPerMm;
  const y = comp.topMm * pxPerMm;
  const w = comp.widthMm * pxPerMm;
  const h = comp.heightMm * pxPerMm;
  const s = comp.style ?? {};

  if (isImageBackedComponent(comp)) {
    const image = images?.get(comp.imageData!);
    if (image) drawCanvasImage(ctx, image, x, y, w, h);
    else drawMissingComponent(ctx, comp, x, y, w, h);
    return;
  }

  if (comp.grid) {
    drawGrid(ctx, comp.grid, comp, x, y, w, h, pxPerMm, dpi, fontFamily, measurer);
    return;
  }
  switch (comp.kind) {
    case "text": {
      drawTextComponent(ctx, comp, x, y, w, h, dpi, fontFamily, measurer);
      break;
    }
    case "rect": {
      const stroke = resolveStroke(s);
      const borders = resolveBoxBorders(s);
      if (s.backgroundColor) {
        ctx.fillStyle = s.backgroundColor;
        ctx.fillRect(x, y, w, h);
      }
      if (borders.inner) {
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = ptToPx(stroke.widthPt, dpi);
        drawRectangleBorder(ctx, borders, x, y, w, h);
      }
      break;
    }
    case "line": {
      const stroke = resolveStroke({ ...s, borderColor: s.lineColor ?? s.borderColor });
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = ptToPx(stroke.widthPt, dpi);
      ctx.beginPath();
      const startY = comp.lineDirection === "up" ? y + h : comp.lineDirection === "down" ? y : y + h / 2;
      const endY = comp.lineDirection === "up" ? y : comp.lineDirection === "down" ? y + h : y + h / 2;
      ctx.moveTo(x, startY);
      ctx.lineTo(x + w, endY);
      ctx.stroke();
      break;
    }
    case "ellipse": {
      const stroke = resolveStroke(s);
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = ptToPx(stroke.widthPt, dpi);
      if (s.backgroundColor) {
        ctx.fillStyle = s.backgroundColor;
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    default:
      drawMissingComponent(ctx, comp, x, y, w, h);
      break;
  }
}

function drawMissingComponent(ctx: CanvasRenderingContext2D, comp: PlanComponent, x: number, y: number, width: number, height: number): void {
  ctx.save();
  ctx.strokeStyle = "#94a3b8";
  ctx.strokeRect(x, y, width, height);
  ctx.fillStyle = "#64748b";
  ctx.font = "12px sans-serif";
  ctx.fillText(comp.fallbackText ?? `[${comp.kind}]`, x + 3, y + 14);
  ctx.restore();
}

export interface CanvasRenderResult {
  canvases: HTMLCanvasElement[];
  diagnostics: OutputDiagnostic[];
}

export interface AsyncCanvasRenderOptions extends CanvasRenderOptions, AssetRenderOptions {
  /** Optional image decoder for CORS-aware URLs or custom assets. Browser default supports image data URLs. */
  imageLoader?: CanvasImageLoader;
}

export interface ImageRenderOptions extends AsyncCanvasRenderOptions {
  /** 图片格式（默认 png；jpeg 体积更小但无透明） */
  format?: "png" | "jpeg";
  /** jpeg 质量 0-1（默认 0.92，仅 jpeg 生效） */
  quality?: number;
}

export interface ImageRenderResult {
  blobs: Blob[];
  diagnostics: OutputDiagnostic[];
}

/**
 * RenderPlan → 每页一张图片 Blob（浏览器环境）：
 * 复用位图渲染管线（区间/dpr/字体/测量器均可配），再 toBlob 编码。
 * 大报表建议配合 start/end 分批导出，避免一次性占用过多内存。
 */
export async function renderPlanToImages(
  plan: RenderPlan,
  options: ImageRenderOptions = {}
): Promise<ImageRenderResult> {
  if (typeof document === "undefined") {
    throw new Error("renderPlanToImages 需要浏览器环境（SSR/Node 请在客户端钩子中调用）");
  }
  const { format = "png", quality = 0.92, ...canvasOptions } = options;
  if (format !== "png" && format !== "jpeg") throw new TypeError("Image format must be png or jpeg.");
  if (!Number.isFinite(quality) || quality < 0 || quality > 1) throw new RangeError("Image quality must be between 0 and 1.");
  throwIfAborted(options.signal);
  const prepared = await resolvePlanAssets(plan, { ...options, format: "canvas" });
  plan = prepared.plan;
  const diagnostics = [...prepared.diagnostics, ...reportOutputDiagnostics(plan, "canvas", options)];
  const mime = format === "jpeg" ? "image/jpeg" : "image/png";
  const blobs: Blob[] = [];
  const end = Math.min(plan.pages.length - 1, options.end ?? plan.pages.length - 1);
  for (let index = Math.max(0, options.start ?? 0); index <= end; index++) {
    throwIfAborted(options.signal);
    const canvas = await drawAsyncPage(plan.pages[index]!, index, canvasOptions, diagnostics);
    try { blobs.push(await encodeCanvas(canvas, mime, quality, options.signal)); }
    finally { canvas.width = 0; canvas.height = 0; }
    await outputCheckpoint(options, blobs.length, end - Math.max(0, options.start ?? 0) + 1);
  }
  throwIfAborted(options.signal);
  return { blobs, diagnostics };
}

function encodeCanvas(canvas: HTMLCanvasElement, mime: string, quality: number, signal?: AbortSignal): Promise<Blob> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal?.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    try {
      canvas.toBlob((blob) => {
        signal?.removeEventListener("abort", abort);
        if (blob) resolve(blob);
        else reject(new Error("Canvas encoding failed; no empty image was emitted."));
      }, mime, quality);
    } catch (error) { signal?.removeEventListener("abort", abort); reject(error); }
  });
}

/**
 * RenderPlan → Canvas 位图页（顶点原点坐标系，与 DOM/PDF 一致）。
 *
 * ⚠️ 内存模型：A4 @dpr2 ≈ 14MB/页，全量渲染 100 页 ≈ 1.4GB。
 * 大报表必须使用 createCanvasPager（窗口化 + 画布池 + 分帧渲染），
 * 本函数适合页数少或已指定 start/end 区间的场景。
 */
export function renderPlanToCanvas(
  plan: RenderPlan,
  options: CanvasRenderOptions = {}
): CanvasRenderResult {
  throwIfAborted(options.signal);
  if (typeof document === "undefined") {
    throw new Error("renderPlanToCanvas 需要浏览器环境（SSR 请在客户端钩子中调用）");
  }
  const dpr = options.dpr ?? (typeof devicePixelRatio === "number" ? devicePixelRatio : 1);
  const dpi = options.dpi ?? 96;
  const pxPerMm = (dpi / 96) * PX_PER_MM_BASE;
  const fontFamily = options.fontFamily ?? DEFAULT_FONT_FAMILY;
  const measurer = options.measurer ?? heuristicMeasurer;
  const start = Math.max(0, options.start ?? 0);
  const end = Math.min(plan.pages.length - 1, options.end ?? plan.pages.length - 1);
  const canvases: HTMLCanvasElement[] = [];
  const diagnostics = reportOutputDiagnostics(plan, "canvas", options);
  // This synchronous API cannot decode images. Diagnose the selected page window
  // before allocating any bitmap, including when generic preflight supports images.
  const imageDiagnostics = syncImageDiagnostics(plan, start, end);
  for (const entry of imageDiagnostics) { notifyOutputDiagnostic(entry, options); diagnostics.push(entry); }
  if (options.fidelity === "strict" && imageDiagnostics.length) throw new OutputFidelityError(diagnostics);
  for (let i = start; i <= end; i++) {
    throwIfAborted(options.signal);
    const page = plan.pages[i]!;
    const { canvas, ctx } = createPageCanvas(page, dpr, dpi, options.maxCanvasPixels);
    for (const comp of page.components) {
      drawComponent(ctx, comp, pxPerMm, dpi, fontFamily, measurer);
    }
    canvases.push(canvas);
  }
  return { canvases, diagnostics };
}

function syncImageDiagnostics(plan: RenderPlan, start: number, end: number): OutputDiagnostic[] {
  if (end < start) return [];
  return plan.pages.slice(start, end + 1).flatMap((page, offset) => page.components.flatMap((comp, componentIndex): OutputDiagnostic[] => isImageBackedComponent(comp) ? [{
    code: "async-image-required", severity: "warning", format: "canvas", pageIndex: start + offset, componentIndex, kind: comp.kind, nid: comp.nid,
    message: "Use renderPlanToCanvasAsync or renderPlanToImages to decode and include images."
  }] : []));
}

/** Browser async raster output: waits for every image and preserves component paint order. */
export async function renderPlanToCanvasAsync(plan: RenderPlan, options: AsyncCanvasRenderOptions = {}): Promise<CanvasRenderResult> {
  if (typeof document === "undefined") throw new Error("renderPlanToCanvasAsync 需要浏览器环境（Node 请使用 PDF 或 XLSX 输出）");
  throwIfAborted(options.signal);
  const prepared = await resolvePlanAssets(plan, { ...options, format: "canvas" });
  plan = prepared.plan;
  const diagnostics = [...prepared.diagnostics, ...reportOutputDiagnostics(plan, "canvas", options)];
  const canvases: HTMLCanvasElement[] = [];
  const end = Math.min(plan.pages.length - 1, options.end ?? plan.pages.length - 1);
  for (let index = Math.max(0, options.start ?? 0); index <= end; index++) {
    canvases.push(await drawAsyncPage(plan.pages[index]!, index, options, diagnostics));
  }
  return { canvases, diagnostics };
}

async function drawAsyncPage(page: PlanPage, pageIndex: number, options: AsyncCanvasRenderOptions, diagnostics: OutputDiagnostic[]): Promise<HTMLCanvasElement> {
  const dpr = options.dpr ?? (typeof devicePixelRatio === "number" ? devicePixelRatio : 1);
  const dpi = options.dpi ?? 96;
  const fontFamily = options.fontFamily ?? DEFAULT_FONT_FAMILY;
  const images = await imagesForOutput(page, pageIndex, options, diagnostics);
  throwIfAborted(options.signal);
  const { canvas, ctx } = createPageCanvas(page, dpr, dpi, options.maxCanvasPixels);
  for (const comp of page.components) drawComponent(ctx, comp, dpi / 25.4, dpi, fontFamily, options.measurer ?? heuristicMeasurer, images);
  return canvas;
}

async function imagesForOutput(page: PlanPage, pageIndex: number, options: AsyncCanvasRenderOptions, diagnostics: OutputDiagnostic[]): Promise<Map<string, CanvasImageSource>> {
  const loader = options.imageLoader ?? loadCanvasImage;
  return loadPageImages(page, async (source, signal) => {
    try { return await loader(source, signal); }
    catch (error) {
      if (signal?.aborted) throw error;
      const componentIndex = page.components.findIndex((comp) => comp.imageData === source);
      const comp = page.components[componentIndex]!;
      const entry: OutputDiagnostic = { code: "image-decode-failed", severity: "warning", format: "canvas", pageIndex, componentIndex, kind: comp.kind, nid: comp.nid, message: "Image decoding failed; raster output was cancelled instead of omitting the image." };
      diagnostics.push(entry);
      notifyOutputDiagnostic(entry, options);
      throw error;
    }
  }, options.signal);
}

export interface CanvasPagerOptions extends AsyncCanvasRenderOptions {
  /** 预渲染页数缓冲（窗口两侧各加 N 页），默认 1 */
  overscan?: number;
  /** 页间距 px，默认 18 */
  gapPx?: number;
  /** 每帧渲染页数上限（分帧，防长任务），默认 1 */
  pagesPerFrame?: number;
}

export interface CanvasPager {
  /** 挂载到滚动容器（viewport，overflow:auto），接管其内容 */
  attach(viewport: HTMLElement): void;
  destroy(): void;
  /** 当前实际渲染的页区间 */
  window(): { start: number; end: number };
}

/**
 * Canvas 虚拟化分页器（大报表专用）：
 * - 视口窗口化：只绘制窗口内页（computePageWindow 与 DOM 后端共用）
 * - 画布池：固定数量 canvas 复用重绘，滚动零新增位图
 * - 分帧：每帧最多 pagesPerFrame 页，滚动期间不产生长任务
 *
 * 内存从 O(总页数) 降到 O(窗口+2×overscan)。
 */
export function createCanvasPager(
  plan: RenderPlan,
  options: CanvasPagerOptions = {}
): CanvasPager {
  const dpr = options.dpr ?? (typeof devicePixelRatio === "number" ? devicePixelRatio : 1);
  const dpi = options.dpi ?? 96;
  const pxPerMm = (dpi / 96) * PX_PER_MM_BASE;
  const fontFamily = options.fontFamily ?? DEFAULT_FONT_FAMILY;
  const measurer = options.measurer ?? heuristicMeasurer;
  const overscan = options.overscan ?? 1;
  const gapPx = options.gapPx ?? 18;
  const pagesPerFrame = options.pagesPerFrame ?? 1;

  const pageHeightsPx = plan.pages.map((p) => p.pageHeightMm * pxPerMm);
  const maxPageWidthPx = Math.max(1, ...plan.pages.map((p) => p.pageWidthMm * pxPerMm));
  const windowState = { start: 0, end: -1 };

  let viewport: HTMLElement | null = null;
  let contentEl: HTMLElement | null = null;
  let topSpacer: HTMLElement | null = null;
  let bottomSpacer: HTMLElement | null = null;
  /** 页槽：固定数量，与窗口内页一一对应（复用 canvas 位图） */
  let slots: HTMLElement[] = [];
  let raf = 0;
  let queued: number[] = [];
  let generation = 0;
  let imageController = new AbortController();
  const diagnostics: OutputDiagnostic[] = [];

  function ensureLayout(): void {
    const vp = viewport!;
    vp.innerHTML = "";
    contentEl = document.createElement("div");
    contentEl.style.cssText = `width:${maxPageWidthPx}px;margin:0 auto;`;
    topSpacer = document.createElement("div");
    bottomSpacer = document.createElement("div");
    contentEl.appendChild(topSpacer);
    slots = [];
    const slotCount = Math.min(plan.pages.length, 3 + overscan * 2);
    for (let i = 0; i < slotCount; i++) {
      const slot = document.createElement("div");
      slot.style.cssText = `margin:0 auto ${gapPx}px;box-shadow:0 2px 8px rgba(0,0,0,.35);background:#fff;`;
      contentEl.appendChild(slot);
      slots.push(slot);
    }
    contentEl.appendChild(bottomSpacer);
    vp.appendChild(contentEl);
  }

  async function drawPageInto(slot: HTMLElement, pageIndex: number): Promise<void> {
    const version = generation;
    const prepared = await resolvePlanAssets(plan, { ...options, signal: imageController.signal, format: "canvas", start: pageIndex, end: pageIndex });
    diagnostics.push(...prepared.diagnostics);
    const page = prepared.plan.pages[pageIndex]!;
    const images = await imagesForOutput(page, pageIndex, { ...options, signal: imageController.signal }, diagnostics);
    if (version !== generation || !viewport) return;
    const { widthPx: w, heightPx: h } = measurePageSizePx(page, dpi);
    // 画布池：槽位内已有 canvas 则复用（重设尺寸即清空位图，避免重复分配大块内存）
    let canvas = slot.firstElementChild as HTMLCanvasElement | null;
    if (!canvas || canvas.tagName !== "CANVAS") {
      canvas = document.createElement("canvas");
      slot.innerHTML = "";
      slot.appendChild(canvas);
    }
    const pixels = canvasPixelSize(page, dpr, dpi, options.maxCanvasPixels);
    canvas.width = pixels.width;
    canvas.height = pixels.height;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    for (const comp of page.components) {
      drawComponent(ctx, comp, pxPerMm, dpi, fontFamily, measurer, images);
    }
    canvas.dataset.canvasPage = String(pageIndex);
    slot.style.height = `${h}px`;
    slot.style.width = `${w}px`;
  }

  function applyWindow(win: { start: number; end: number }): void {
    generation++;
    windowState.start = win.start;
    windowState.end = win.end;
    topSpacer!.style.height = `${win.start * gapPx + pageHeightsPx.slice(0, win.start).reduce((s, h) => s + h, 0)}px`;
    const below = plan.pages.length - 1 - win.end;
    bottomSpacer!.style.height = `${below * gapPx + pageHeightsPx.slice(win.end + 1).reduce((s, h) => s + h, 0)}px`;
    // 窗口外槽位隐藏（避免空槽参与布局压矮滚动区），窗口内槽位先按页高占位
    // （画布分帧绘完前布局即稳定，滚动高度不抖动）
    const used = win.end - win.start + 1;
    slots.forEach((slot, i) => {
      if (i < used) {
        slot.style.display = "";
        const pageIndex = win.start + i;
        slot.style.height = `${pageHeightsPx[pageIndex] ?? 0}px`;
      } else {
        slot.style.display = "none";
      }
    });
    // 收集待渲染页（跳过已就位的槽位），分帧消费
    queued = [];
    for (let i = win.start; i <= win.end; i++) {
      const slot = slots[i - win.start];
      if (!slot) continue;
      const already = slot.firstElementChild as HTMLElement | null;
      if (already?.dataset?.canvasPage !== String(i)) queued.push(i);
    }
    scheduleFrame();
  }

  function scheduleFrame(): void {
    if (raf || queued.length === 0) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      let budget = Math.max(1, pagesPerFrame);
      while (queued.length > 0 && budget-- > 0) {
        const pageIndex = queued.shift()!;
        const slot = slots[pageIndex - windowState.start];
        if (slot) void drawPageInto(slot, pageIndex).catch(() => { /* imagesForOutput reports decode failures; aborts are expected on detach. */ });
      }
      if (queued.length > 0) scheduleFrame();
    });
  }

  function onScroll(): void {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const vp = viewport!;
      const win = computePageWindow({
        pageHeightsPx,
        viewportHeightPx: vp.clientHeight,
        scrollTopPx: vp.scrollTop,
        overscan,
        gapPx
      });
      // 窗口未变（仍在缓冲内）则只继续消费队列
      if (win.start !== windowState.start || win.end !== windowState.end) {
        applyWindow(win);
      } else {
        scheduleFrame();
      }
    });
  }

  let resizeObserver: ResizeObserver | null = null;

  return {
    attach(vp: HTMLElement) {
      if (typeof document === "undefined") {
        throw new Error("createCanvasPager 需要浏览器环境（SSR 请在客户端钩子中调用 attach）");
      }
      throwIfAborted(options.signal);
      imageController = new AbortController();
      options.signal?.addEventListener("abort", abortImages, { once: true });
      reportOutputDiagnostics(plan, "canvas", options);
      viewport = vp;
      ensureLayout();
      vp.addEventListener("scroll", onScroll, { passive: true });
      // 视口尺寸变化（弹窗开合/分栏拖动）时重算窗口，不只依赖滚动事件
      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => onScroll());
        resizeObserver.observe(vp);
      }
      onScroll();
    },
    destroy() {
      generation++;
      imageController.abort();
      options.signal?.removeEventListener("abort", abortImages);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      resizeObserver?.disconnect();
      resizeObserver = null;
      viewport?.removeEventListener("scroll", onScroll);
      queued = [];
      contentEl?.remove();
      viewport = null;
    },
    window() {
      return { ...windowState };
    }
  };

  function abortImages(): void { imageController.abort(options.signal?.reason); }
}
