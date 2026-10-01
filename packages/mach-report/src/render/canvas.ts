import type { PlanComponent, PlanPage, PlanGrid, RenderPlan } from "../schema/render-plan";
import { isRichText } from "../schema/render-plan";
import { resolveGridLayout } from "./grid-geometry";
import { wrapText, type TextMeasurer } from "../layout/textwrap";
import { heuristicMeasurer } from "../layout/textwrap";
import { ptToPx } from "../units";
import {
  DEFAULT_FONT_PT,
  DEFAULT_TEXT_COLOR,
  LINE_HEIGHT
} from "../defaults";
import {
  resolveBoxBorders,
  resolveFontSize,
  resolveLineHeight,
  resolveStroke,
  resolveTextColor
} from "./style";
import { computePageWindow } from "./window";

export interface CanvasRenderOptions {
  /** 设备像素比，默认取运行环境 devicePixelRatio */
  dpr?: number;
  dpi?: number;
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

function createPageCanvas(page: PlanPage, dpr: number, dpi: number): Ctx2D {
  const canvas = document.createElement("canvas");
  const { widthPx: w, heightPx: h } = measurePageSizePx(page, dpi);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
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
  color: string;
  align: "left" | "center" | "right" | "justify";
  lineHeight: number;
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
  ctx.font = `${spec.bold ? "bold " : ""}${spec.fontSizePx}px ${fontFamily}`;
  ctx.fillStyle = spec.color;
  ctx.textBaseline = "alphabetic";
  const lineH = spec.fontSizePx * spec.lineHeight;
  const lines = spec.text === "" ? [""] : spec.text.split("\n");
  const totalH = lines.length * lineH;
  let topY = y;
  if (verticalAlign === "middle") topY = y + (h - totalH) / 2;
  else if (verticalAlign === "bottom") topY = y + h - totalH;
  lines.forEach((line, i) => {
    ctx.textAlign = spec.align === "center" ? "center" : spec.align === "right" ? "right" : "left";
    const tx =
      spec.align === "center" ? x + w / 2 : spec.align === "right" ? x + w : x;
    ctx.fillText(line, tx, topY + i * lineH + spec.fontSizePx * 0.8, w);
  });
  ctx.textAlign = "left";
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  grid: PlanGrid,
  comp: PlanComponent,
  x: number,
  y: number,
  w: number,
  h: number,
  pxPerMm: number,
  dpi: number,
  fontFamily: string,
  measurer: TextMeasurer
): void {
  const layout = resolveGridLayout(grid, w / pxPerMm, h / pxPerMm);
  const borders = resolveBoxBorders(comp.style);
  const stroke = resolveStroke(comp.style);

  // 单元格底色（独立于边框开关）
  for (const box of layout.cells) {
    const bg = box.cell.style?.backgroundColor;
    if (bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(
        x + box.xMm * pxPerMm,
        y + box.yMm * pxPerMm,
        box.widthMm * pxPerMm,
        box.heightMm * pxPerMm
      );
    }
  }

  if (borders.inner) {
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = ptToPx(stroke.widthPt, dpi);
    // 内部线段（span 感知：合并单元格中间无线）
    for (const e of layout.edges) {
      ctx.beginPath();
      if (e.kind === "v") {
        ctx.moveTo(x + e.pos * pxPerMm, y + e.from * pxPerMm);
        ctx.lineTo(x + e.pos * pxPerMm, y + e.to * pxPerMm);
      } else {
        ctx.moveTo(x + e.from * pxPerMm, y + e.pos * pxPerMm);
        ctx.lineTo(x + e.to * pxPerMm, y + e.pos * pxPerMm);
      }
      ctx.stroke();
    }
    // 外框（四边独立开关）
    ctx.beginPath();
    if (borders.top) {
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y);
    }
    if (borders.right) {
      ctx.moveTo(x + w, y);
      ctx.lineTo(x + w, y + h);
    }
    if (borders.bottom) {
      ctx.moveTo(x + w, y + h);
      ctx.lineTo(x, y + h);
    }
    if (borders.left) {
      ctx.moveTo(x, y + h);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  for (const box of layout.cells) {
    const text = typeof box.cell.text === "string" ? box.cell.text : "";
    if (!text) continue;
    const st = box.cell.style;
    const fontSizePt = st?.fontSize ?? DEFAULT_FONT_PT;
    const lines = wrapText(
      text,
      box.widthMm - 1,
      { fontSizePt },
      measurer
    ).join("\n");
    drawTextBlock(
      ctx,
      {
        text: lines,
        fontSizePx: resolveFontSize(st, dpi).fontSizePx,
        bold: st?.bold ?? false,
        color: st?.color ?? resolveTextColor(comp.style, DEFAULT_TEXT_COLOR),
        align: st?.align ?? "left",
        lineHeight: LINE_HEIGHT
      },
      x + (box.xMm + 0.5) * pxPerMm,
      y + box.yMm * pxPerMm,
      Math.max(0, (box.widthMm - 1) * pxPerMm),
      box.heightMm * pxPerMm,
      fontFamily,
      st?.verticalAlign ?? "middle"
    );
  }
}

function drawComponent(
  ctx: CanvasRenderingContext2D,
  comp: PlanComponent,
  pxPerMm: number,
  dpi: number,
  fontFamily: string,
  measurer: TextMeasurer
): void {
  const x = comp.leftMm * pxPerMm;
  const y = comp.topMm * pxPerMm;
  const w = comp.widthMm * pxPerMm;
  const h = comp.heightMm * pxPerMm;
  const s = comp.style ?? {};

  if (comp.grid) {
    drawGrid(ctx, comp.grid, comp, x, y, w, h, pxPerMm, dpi, fontFamily, measurer);
    return;
  }
  switch (comp.kind) {
    case "text": {
      const fontSizePt = s.fontSize ?? DEFAULT_FONT_PT;
      const text = isRichText(comp)
        ? comp.richParagraphs!
            .map((p) => (p.segments ?? []).map((seg) => seg.text ?? seg.field ?? "").join(""))
            .join("\n")
        : Array.isArray(comp.lines) && comp.lines.length > 0
          ? comp.lines.join("\n")
          : wrapText(comp.text ?? "", comp.widthMm, { fontSizePt }, measurer).join("\n");
      drawTextBlock(
        ctx,
        {
          text,
          fontSizePx: resolveFontSize(s, dpi).fontSizePx,
          bold: s.bold ?? false,
          color: resolveTextColor(s),
          align: s.align ?? "left",
          lineHeight: resolveLineHeight(s)
        },
        x,
        y,
        w,
        h,
        fontFamily,
        s.verticalAlign
      );
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
        ctx.beginPath();
        if (borders.top) {
          ctx.moveTo(x, y);
          ctx.lineTo(x + w, y);
        }
        if (borders.right) {
          ctx.moveTo(x + w, y);
          ctx.lineTo(x + w, y + h);
        }
        if (borders.bottom) {
          ctx.moveTo(x + w, y + h);
          ctx.lineTo(x, y + h);
        }
        if (borders.left) {
          ctx.moveTo(x, y + h);
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      break;
    }
    case "line": {
      const stroke = resolveStroke({ ...s, borderColor: s.lineColor ?? s.borderColor });
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = ptToPx(stroke.widthPt, dpi);
      ctx.beginPath();
      ctx.moveTo(x, y + h / 2);
      ctx.lineTo(x + w, y + h / 2);
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
      break;
  }
}

export interface CanvasRenderResult {
  canvases: HTMLCanvasElement[];
}

export interface ImageRenderOptions extends CanvasRenderOptions {
  /** 图片格式（默认 png；jpeg 体积更小但无透明） */
  format?: "png" | "jpeg";
  /** jpeg 质量 0-1（默认 0.92，仅 jpeg 生效） */
  quality?: number;
}

export interface ImageRenderResult {
  blobs: Blob[];
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
  const { canvases } = renderPlanToCanvas(plan, canvasOptions);
  const mime = format === "jpeg" ? "image/jpeg" : "image/png";
  const blobs: Blob[] = [];
  for (const canvas of canvases) {
    blobs.push(
      await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), mime, quality)
      ) ?? new Blob([], { type: mime })
    );
  }
  return { blobs };
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
  if (typeof document === "undefined") {
    throw new Error("renderPlanToCanvas 需要浏览器环境（SSR 请在客户端钩子中调用）");
  }
  const dpr = options.dpr ?? (typeof devicePixelRatio === "number" ? devicePixelRatio : 1);
  const dpi = options.dpi ?? 96;
  const pxPerMm = (dpi / 96) * PX_PER_MM_BASE;
  const fontFamily = options.fontFamily ?? '"Microsoft YaHei", sans-serif';
  const measurer = options.measurer ?? heuristicMeasurer;
  const start = Math.max(0, options.start ?? 0);
  const end = Math.min(plan.pages.length - 1, options.end ?? plan.pages.length - 1);
  const canvases: HTMLCanvasElement[] = [];
  for (let i = start; i <= end; i++) {
    const page = plan.pages[i]!;
    const { canvas, ctx } = createPageCanvas(page, dpr, dpi);
    for (const comp of page.components) {
      drawComponent(ctx, comp, pxPerMm, dpi, fontFamily, measurer);
    }
    canvases.push(canvas);
  }
  return { canvases };
}

export interface CanvasPagerOptions extends CanvasRenderOptions {
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
  const fontFamily = options.fontFamily ?? '"Microsoft YaHei", sans-serif';
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

  function drawPageInto(slot: HTMLElement, pageIndex: number): void {
    const page = plan.pages[pageIndex]!;
    const { widthPx: w, heightPx: h } = measurePageSizePx(page, dpi);
    // 画布池：槽位内已有 canvas 则复用（重设尺寸即清空位图，避免重复分配大块内存）
    let canvas = slot.firstElementChild as HTMLCanvasElement | null;
    if (!canvas || canvas.tagName !== "CANVAS") {
      canvas = document.createElement("canvas");
      slot.innerHTML = "";
      slot.appendChild(canvas);
    }
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    for (const comp of page.components) {
      drawComponent(ctx, comp, pxPerMm, dpi, fontFamily, measurer);
    }
    canvas.dataset.canvasPage = String(pageIndex);
    slot.style.height = `${h}px`;
    slot.style.width = `${w}px`;
  }

  function applyWindow(win: { start: number; end: number }): void {
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
        if (slot) drawPageInto(slot, pageIndex);
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
}
