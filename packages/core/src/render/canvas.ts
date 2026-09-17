import type { PlanComponent, PlanGrid, PlanPage, RenderPlan } from "@mach-report/core";

export interface CanvasRenderOptions {
  /** 设备像素比，默认取运行环境 devicePixelRatio */
  dpr?: number;
  dpi?: number;
  /** 文本默认字体族 */
  fontFamily?: string;
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

function parseColor(value: string | undefined, fallback: string): string {
  return value || fallback;
}

function fontSizePxOf(comp: PlanComponent, pxPerMm: number): number {
  const s = comp.style || {};
  if (s.fontSizePx != null) return s.fontSizePx;
  if (s.fontSize != null) return (s.fontSize * 72 * pxPerMm) / 96;
  return 10.5 * ((72 * pxPerMm) / 96);
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
  fontFamily: string
): void {
  const rows = grid.cells.length;
  const cols = Math.max(1, ...grid.cells.map((r) => (r || []).length));
  const rowH = h / Math.max(1, rows);
  const colW = w / cols;
  ctx.strokeStyle = parseColor(comp.style?.borderColor ?? comp.style?.lineColor, "#333333");
  ctx.lineWidth = 0.75;
  ctx.strokeRect(x, y, w, h);
  for (let i = 1; i < rows; i++) {
    ctx.beginPath();
    ctx.moveTo(x, y + i * rowH);
    ctx.lineTo(x + w, y + i * rowH);
    ctx.stroke();
  }
  for (let j = 1; j < cols; j++) {
    ctx.beginPath();
    ctx.moveTo(x + j * colW, y);
    ctx.lineTo(x + j * colW, y + h);
    ctx.stroke();
  }
  ctx.fillStyle = parseColor(comp.style?.color, "#000000");
  const fontSize = 9 * ((72 * pxPerMm) / 96);
  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.textBaseline = "middle";
  grid.cells.forEach((row, ri) => {
    (row || []).forEach((cell, ci) => {
      const text = typeof cell?.text === "string" ? cell.text : "";
      if (!text) return;
      ctx.fillText(
        text,
        x + ci * colW + 2,
        y + ri * rowH + rowH / 2,
        colW - 4
      );
    });
  });
}

function drawComponent(
  ctx: CanvasRenderingContext2D,
  comp: PlanComponent,
  pageHeightPx: number,
  pxPerMm: number,
  fontFamily: string
): void {
  const x = comp.leftMm * pxPerMm;
  const w = comp.widthMm * pxPerMm;
  const h = comp.heightMm * pxPerMm;
  const y = pageHeightPx - comp.topMm * pxPerMm - h;

  if (comp.grid) {
    drawGrid(ctx, comp.grid, comp, x, y, w, h, pxPerMm, fontFamily);
    return;
  }
  switch (comp.kind) {
    case "text": {
      const size = fontSizePxOf(comp, pxPerMm);
      ctx.fillStyle = parseColor(comp.style?.color, "#000000");
      const weight = comp.style?.bold ? "bold " : "";
      ctx.font = `${weight}${size}px ${fontFamily}`;
      ctx.textBaseline = "top";
      const lines =
        Array.isArray(comp.lines) && comp.lines.length > 0 ? comp.lines : [comp.text ?? ""];
      const align = comp.style?.align ?? "left";
      ctx.textAlign = align === "center" ? "center" : align === "right" ? "right" : "left";
      const tx = align === "center" ? x + w / 2 : align === "right" ? x + w : x;
      lines.forEach((line, i) => {
        ctx.fillText(line, tx, y + i * size * 1.35, w);
      });
      ctx.textAlign = "left";
      break;
    }
    case "rect": {
      ctx.strokeStyle = parseColor(comp.style?.borderColor ?? comp.style?.lineColor, "#333333");
      ctx.lineWidth = 0.75;
      ctx.strokeRect(x, y, w, h);
      break;
    }
    case "line": {
      ctx.strokeStyle = parseColor(comp.style?.lineColor ?? comp.style?.borderColor, "#333333");
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.moveTo(x, y + h / 2);
      ctx.lineTo(x + w, y + h / 2);
      ctx.stroke();
      break;
    }
    case "ellipse": {
      ctx.strokeStyle = parseColor(comp.style?.borderColor ?? comp.style?.lineColor, "#333333");
      ctx.lineWidth = 0.75;
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

/** RenderPlan → 每页一张 Canvas（位图渲染，缩放=CSS transform 零重排） */
export function renderPlanToCanvas(
  plan: RenderPlan,
  options: CanvasRenderOptions = {}
): CanvasRenderResult {
  const dpr = options.dpr ?? (typeof devicePixelRatio === "number" ? devicePixelRatio : 1);
  const dpi = options.dpi ?? 96;
  const pxPerMm = (dpi / 96) * PX_PER_MM_BASE;
  const fontFamily = options.fontFamily ?? '"Microsoft YaHei", sans-serif';
  const canvases: HTMLCanvasElement[] = [];
  for (const page of plan.pages) {
    const { canvas, ctx } = createPageCanvas(page, dpr, dpi);
    const pageHeightPx = page.pageHeightMm * pxPerMm;
    for (const comp of page.components) {
      drawComponent(ctx, comp, pageHeightPx, pxPerMm, fontFamily);
    }
    canvases.push(canvas);
  }
  return { canvases };
}
