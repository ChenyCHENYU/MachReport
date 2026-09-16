import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import type { PlanComponent, PlanGrid, RenderPlan } from "@mach-report/core";

export interface PdfRenderOptions {
  /** 嵌入字体字节（TTF，如黑体）；缺省用 Helvetica（不支持 CJK） */
  customFontBytes?: Uint8Array | ArrayBuffer;
  customFontName?: string;
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
  const s = comp.style || {};
  if (s.fontSizePx != null) return (s.fontSizePx * 72) / 96;
  if (s.fontSize != null) return s.fontSize;
  return 10.5;
}

function encodeText(font: PDFFont, text: string): { encoded: string; supported: boolean } {
  try {
    font.encodeText(text);
    return { encoded: text, supported: true };
  } catch {
    return { encoded: "", supported: false };
  }
}

function drawGrid(
  page: ReturnType<PDFDocument["addPage"]>,
  grid: PlanGrid,
  comp: PlanComponent,
  originXPt: number,
  originYPt: number,
  widthPt: number,
  font: PDFFont
): { unsupported: number } {
  let unsupported = 0;
  const rowCount = grid.cells.length;
  const rowHeightPt = comp.heightMm > 0 && rowCount > 0 ? mmToPt(comp.heightMm) / rowCount : 12;
  const fontSize = 9;
  grid.cells.forEach((row, ri) => {
    const cols = row || [];
    const colWidthPt = widthPt / Math.max(1, cols.length);
    cols.forEach((cell, ci) => {
      const x = originXPt + ci * colWidthPt;
      const yTop = originYPt - ri * rowHeightPt;
      const text = typeof cell?.text === "string" ? cell.text : "";
      const { encoded, supported } = encodeText(font, text);
      if (text && !supported) unsupported++;
      if (encoded) {
        page.drawText(encoded, {
          x: x + 2,
          y: yTop - rowHeightPt + (rowHeightPt - fontSize) / 2 + 1,
          size: fontSize,
          font,
          color: colorOf(cell?.style?.color)
        });
      }
    });
  });
  return { unsupported };
}

export interface PdfRenderResult {
  pdfDoc: PDFDocument;
  bytes: Uint8Array;
  pageErrors: string[];
  unsupportedTextCount: number;
}

export async function renderPlanToPdf(
  plan: RenderPlan,
  options: PdfRenderOptions = {}
): Promise<PdfRenderResult> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const pageErrors: string[] = [];
  let unsupportedTextCount = 0;
  const fallbackFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const customFont = options.customFontBytes
    ? await pdfDoc.embedFont(options.customFontBytes as unknown as ArrayBuffer, {
        subset: true
      })
    : undefined;
  const font: PDFFont = customFont ?? fallbackFont;

  for (const planPage of plan.pages) {
    const widthPt = mmToPt(planPage.pageWidthMm);
    const heightPt = mmToPt(planPage.pageHeightMm);
    const page = pdfDoc.addPage([widthPt, heightPt]);

    for (const comp of planPage.components) {
      const x = mmToPt(comp.leftMm);
      const yTop = heightPt - mmToPt(comp.topMm);
      const w = mmToPt(comp.widthMm);
      const h = mmToPt(comp.heightMm);
      try {
        switch (comp.kind) {
          case "text": {
            const size = fontSizePtOf(comp);
            const text = Array.isArray(comp.lines) && comp.lines.length > 0
              ? comp.lines.join("\n")
              : (comp.text ?? "");
            const { encoded, supported } = encodeText(font, text);
            if (text && !supported) unsupportedTextCount++;
            if (encoded) {
              const lines = encoded.split("\n");
              lines.forEach((line, i) => {
                page.drawText(line, {
                  x,
                  y: yTop - size - i * size * 1.35,
                  size,
                  font,
                  color: colorOf(comp.style?.color)
                });
              });
            }
            break;
          }
          case "rect": {
            const borderColor = colorOf(
              comp.style?.borderColor ?? comp.style?.lineColor,
              [0.2, 0.2, 0.2]
            );
            page.drawRectangle({
              x,
              y: yTop - h,
              width: w,
              height: h,
              borderColor,
              borderWidth: 0.75,
              color: comp.style?.backgroundColor
                ? colorOf(comp.style?.backgroundColor, [1, 1, 1])
                : undefined
            });
            if (comp.grid) {
              const r = drawGrid(page, comp.grid, comp, x, yTop, w, font);
              unsupportedTextCount += r.unsupported;
            }
            break;
          }
          case "line": {
            page.drawLine({
              start: { x, y: yTop - h / 2 },
              end: { x: x + w, y: yTop - h / 2 },
              thickness: 0.75,
              color: colorOf(comp.style?.lineColor ?? comp.style?.borderColor, [0.2, 0.2, 0.2])
            });
            break;
          }
          case "ellipse": {
            page.drawEllipse({
              x: x + w / 2,
              y: yTop - h / 2,
              xScale: w / 2,
              yScale: h / 2,
              borderColor: colorOf(comp.style?.borderColor ?? comp.style?.lineColor, [0.2, 0.2, 0.2]),
              borderWidth: 0.75
            });
            break;
          }
          default:
            if (comp.grid) {
              const r = drawGrid(page, comp.grid, comp, x, yTop, w, font);
              unsupportedTextCount += r.unsupported;
            }
            break;
        }
      } catch (e) {
        pageErrors.push(
          `page ${plan.pages.indexOf(planPage) + 1} comp ${comp.nid ?? comp.kind}: ${String(e)}`
        );
      }
    }
  }

  const bytes = await pdfDoc.save();
  return { pdfDoc, bytes, pageErrors, unsupportedTextCount };
}
