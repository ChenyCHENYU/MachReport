import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from "pdf-lib";
import type { GridCell, PlanComponent, PlanGrid, RenderPlan } from "@mach-report/core";
import {
  heuristicMeasurer,
  isImageBackedComponent,
  isRichText,
  LINE_HEIGHT,
  resolveBoxBorders,
  resolveFontSize,
  resolveStroke,
  resolveGridLayout,
  wrapText,
  type TextMeasurer
} from "@mach-report/core";

export interface PdfRenderOptions {
  /** 嵌入字体字节（TTF，如黑体）；缺省用 Helvetica（不支持 CJK） */
  customFontBytes?: Uint8Array | ArrayBuffer;
  customFontName?: string;
  /** 文本测量器（默认启发式；与分页/Canvas 注入同一实例可消除折行差异） */
  measurer?: TextMeasurer;
}

export interface PdfRenderResult {
  pdfDoc: PDFDocument;
  bytes: Uint8Array;
  pageErrors: string[];
  unsupportedTextCount: number;
  /** 保真度降级清单（富文本转纯文本、图片格式不支持等），供上层提示 */
  fidelityWarnings: string[];
}

const MM_TO_PT = 72 / 25.4;

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

function fontSizePtOf(comp: PlanComponent): number {
  return resolveFontSize(comp.style).fontSizePt;
}

function cellFontSizePt(style: GridCell["style"]): number {
  return resolveFontSize(style).fontSizePt;
}

function encodeText(font: PDFFont, text: string): { encoded: string; supported: boolean } {
  try {
    font.encodeText(text);
    return { encoded: text, supported: true };
  } catch {
    return { encoded: "", supported: false };
  }
}

interface TextLines {
  lines: string[];
  fontSizePt: number;
}

/** 富文本降级：段落 → 纯文本行（保留段落顺序，丢内联样式；计入保真告警） */
function richTextToLines(comp: PlanComponent): string[] {
  const out: string[] = [];
  for (const para of comp.richParagraphs ?? []) {
    const line = (para.segments ?? [])
      .map((seg) => (seg.kind === "field" ? (seg.field ?? "") : (seg.text ?? "")))
      .join("");
    out.push(line);
  }
  return out;
}

export async function renderPlanToPdf(
  plan: RenderPlan,
  options: PdfRenderOptions = {}
): Promise<PdfRenderResult> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const pageErrors: string[] = [];
  const fidelityWarnings: string[] = [];
  let unsupportedTextCount = 0;
  const measurer = options.measurer ?? heuristicMeasurer;
  const fallbackFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const customFont = options.customFontBytes
    ? await pdfDoc.embedFont(options.customFontBytes as unknown as ArrayBuffer, {
        subset: true
      })
    : undefined;
  const font: PDFFont = customFont ?? fallbackFont;
  const imageCache = new Map<string, Promise<PDFImage | null>>();

  function wrapLines(text: string, widthMm: number, fontSizePt: number): string[] {
    if (!text) return [];
    return wrapText(text, widthMm, { fontSizePt }, measurer);
  }

  function embedImage(dataUrl: string): Promise<PDFImage | null> {
    const cached = imageCache.get(dataUrl);
    if (cached) return cached;
    const p = (async (): Promise<PDFImage | null> => {
      try {
        const match = /^data:image\/(png|jpe?g);base64,(.*)$/s.exec(dataUrl);
        if (!match) return null;
        const bytes = Uint8Array.from(atob(match[2]!), (c) => c.charCodeAt(0));
        if (match[1] === "png") return await pdfDoc.embedPng(bytes);
        return await pdfDoc.embedJpg(bytes);
      } catch {
        return null;
      }
    })();
    imageCache.set(dataUrl, p);
    return p;
  }

  function drawTextLines(
    page: ReturnType<PDFDocument["addPage"]>,
    spec: TextLines,
    xPt: number,
    yTopPt: number,
    widthPt: number,
    comp: PlanComponent,
    cellStyle?: { color?: string; align?: string }
  ): void {
    const align = cellStyle?.align ?? comp.style?.align;
    const lineH = spec.fontSizePt * LINE_HEIGHT;
    spec.lines.forEach((line, i) => {
      const { encoded, supported } = encodeText(font, line);
      if (line && !supported) unsupportedTextCount++;
      if (!encoded) return;
      const w = font.widthOfTextAtSize(encoded, spec.fontSizePt);
      let x = xPt;
      if (align === "center") x = xPt + (widthPt - w) / 2;
      else if (align === "right") x = xPt + widthPt - w;
      page.drawText(encoded, {
        x,
        y: yTopPt - spec.fontSizePt - i * lineH,
        size: spec.fontSizePt,
        font,
        color: colorOf(cellStyle?.color ?? comp.style?.color)
      });
    });
  }

  function drawGrid(
    page: ReturnType<PDFDocument["addPage"]>,
    grid: PlanGrid,
    comp: PlanComponent,
    originXPt: number,
    originYPt: number
  ): void {
    const layout = resolveGridLayout(grid, comp.widthMm, comp.heightMm);
    const borders = resolveBoxBorders(comp.style);
    const stroke = resolveStroke(comp.style);
    const lineColor = colorOf(stroke.color, [0.2, 0.2, 0.2]);
    const borderWidth = Math.max(0.1, stroke.widthPt);

    // 单元格底色（独立于边框开关）
    for (const box of layout.cells) {
      const bg = box.cell.style?.backgroundColor;
      if (!bg) continue;
      page.drawRectangle({
        x: originXPt + mmToPt(box.xMm),
        y: originYPt - mmToPt(box.yMm) - mmToPt(box.heightMm),
        width: mmToPt(box.widthMm),
        height: mmToPt(box.heightMm),
        color: colorOf(bg, [1, 1, 1])
      });
    }

    if (borders.inner) {
      // 内部线段（span 感知：合并单元格中间无线）+ 外框四边开关
      for (const e of layout.edges) {
        if (e.kind === "v") {
          page.drawLine({
            start: { x: originXPt + mmToPt(e.pos), y: originYPt - mmToPt(e.to) },
            end: { x: originXPt + mmToPt(e.pos), y: originYPt - mmToPt(e.from) },
            thickness: borderWidth,
            color: lineColor
          });
        } else {
          page.drawLine({
            start: { x: originXPt + mmToPt(e.from), y: originYPt - mmToPt(e.pos) },
            end: { x: originXPt + mmToPt(e.to), y: originYPt - mmToPt(e.pos) },
            thickness: borderWidth,
            color: lineColor
          });
        }
      }
      const x0 = originXPt;
      const y0 = originYPt - mmToPt(comp.heightMm);
      const x1 = originXPt + mmToPt(comp.widthMm);
      const y1 = originYPt;
      const drawEdge = (ax: number, ay: number, bx: number, by: number) =>
        page.drawLine({
          start: { x: ax, y: ay },
          end: { x: bx, y: by },
          thickness: borderWidth,
          color: lineColor
        });
      if (borders.top) drawEdge(x0, y1, x1, y1);
      if (borders.right) drawEdge(x1, y1, x1, y0);
      if (borders.bottom) drawEdge(x1, y0, x0, y0);
      if (borders.left) drawEdge(x0, y0, x0, y1);
    }

    for (const box of layout.cells) {
      const st = box.cell.style;
      const x = originXPt + mmToPt(box.xMm);
      const yTop = originYPt - mmToPt(box.yMm);
      const w = mmToPt(box.widthMm);
      const h = mmToPt(box.heightMm);
      const text = typeof box.cell.text === "string" ? box.cell.text : "";
      if (!text) continue;
      const fontSizePt = cellFontSizePt(st);
      const maxLines = Math.max(1, Math.floor(h / (fontSizePt * LINE_HEIGHT)));
      const lines = wrapLines(text, box.widthMm - 1, fontSizePt).slice(0, maxLines);
      drawTextLines(
        page,
        { lines, fontSizePt },
        x + 1,
        yTop - (h - lines.length * fontSizePt * LINE_HEIGHT) / 2,
        w - 2,
        comp,
        { color: st?.color, align: st?.align }
      );
    }
  }

  for (let pageIndex = 0; pageIndex < plan.pages.length; pageIndex++) {
    const planPage = plan.pages[pageIndex]!;
    const widthPt = mmToPt(planPage.pageWidthMm);
    const heightPt = mmToPt(planPage.pageHeightMm);
    const page = pdfDoc.addPage([widthPt, heightPt]);

    for (const comp of planPage.components) {
      const x = mmToPt(comp.leftMm);
      const yTop = heightPt - mmToPt(comp.topMm);
      const w = mmToPt(comp.widthMm);
      const h = mmToPt(comp.heightMm);
      try {
        if (isImageBackedComponent(comp)) {
          const img = await embedImage(comp.imageData!);
          if (img) {
            page.drawImage(img, { x, y: yTop - h, width: w, height: h });
          } else {
            fidelityWarnings.push(
              `page ${pageIndex + 1} ${comp.nid ?? comp.kind}: 图片仅支持 data:image/(png|jpeg) base64，已跳过`
            );
          }
          continue;
        }
        switch (comp.kind) {
          case "text": {
            const fontSizePt = fontSizePtOf(comp);
            const lines = isRichText(comp)
              ? richTextToLines(comp)
              : Array.isArray(comp.lines) && comp.lines.length > 0
                ? comp.lines
                : wrapLines(comp.text ?? "", comp.widthMm, fontSizePt);
            if (isRichText(comp)) {
              fidelityWarnings.push(
                `page ${pageIndex + 1} ${comp.nid ?? "text"}: 富文本按纯文本降级导出（内联样式丢失）`
              );
            }
            drawTextLines(page, { lines, fontSizePt }, x, yTop, w, comp);
            break;
          }
          case "rect": {
            const borders = resolveBoxBorders(comp.style);
            const stroke = resolveStroke(comp.style);
            if (comp.style?.backgroundColor) {
              page.drawRectangle({
                x,
                y: yTop - h,
                width: w,
                height: h,
                color: colorOf(comp.style.backgroundColor, [1, 1, 1])
              });
            }
            if (borders.inner) {
              page.drawRectangle({
                x,
                y: yTop - h,
                width: w,
                height: h,
                borderColor: colorOf(stroke.color, [0.2, 0.2, 0.2]),
                borderWidth: Math.max(0.1, stroke.widthPt)
              });
            }
            if (comp.grid) {
              drawGrid(page, comp.grid, comp, x, yTop);
            }
            break;
          }
          case "line": {
            const stroke = resolveStroke({ ...comp.style, borderColor: comp.style?.lineColor ?? comp.style?.borderColor });
            page.drawLine({
              start: { x, y: yTop - h / 2 },
              end: { x: x + w, y: yTop - h / 2 },
              thickness: Math.max(0.1, stroke.widthPt),
              color: colorOf(stroke.color, [0.2, 0.2, 0.2])
            });
            break;
          }
          case "ellipse": {
            const stroke = resolveStroke(comp.style);
            page.drawEllipse({
              x: x + w / 2,
              y: yTop - h / 2,
              xScale: w / 2,
              yScale: h / 2,
              borderColor: colorOf(stroke.color, [0.2, 0.2, 0.2]),
              borderWidth: Math.max(0.1, stroke.widthPt)
            });
            break;
          }
          default: {
            if (comp.grid) {
              drawGrid(page, comp.grid, comp, x, yTop);
            } else if (comp.text) {
              drawTextLines(page, { lines: [comp.text], fontSizePt: fontSizePtOf(comp) }, x, yTop, w, comp);
            }
            break;
          }
        }
      } catch (e) {
        pageErrors.push(
          `page ${pageIndex + 1} comp ${comp.nid ?? comp.kind}: ${String(e)}`
        );
      }
    }
  }

  const bytes = await pdfDoc.save();
  return { pdfDoc, bytes, pageErrors, unsupportedTextCount, fidelityWarnings };
}
