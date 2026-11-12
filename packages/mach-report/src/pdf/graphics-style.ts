import { concatTransformationMatrix, popGraphicsState, pushGraphicsState, PDFPage, PDFName, PDFStream, PDFRef, PDFArray, type PDFDocument } from "pdf-lib";
import type { ComponentStyle } from "../schema/render-plan";

export interface PdfStyleBox { x: number; yTop: number; width: number; height: number }
/** PDF uses y-up coordinates; CSS positive rotations turn clockwise about the border-box center. */
function rotation(page: PDFPage, degrees: number, box: PdfStyleBox): void {
  const angle = -(degrees % 360) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  const x = box.x + box.width / 2, y = box.yTop - box.height / 2;
  page.pushOperators(concatTransformationMatrix(c, s, -s, c, x - c * x + s * y, y - s * x - c * y));
}
/** Explicit opacity composes one isolated group; inherited font styles never apply alpha twice. */
export function createPdfGraphicsStyle(document: PDFDocument) {
  function enter(page: PDFPage, degrees: number, box: PdfStyleBox): () => void {
    if (!Number.isFinite(degrees)) throw new RangeError("Invalid PDF rotation");
    if (!degrees) return () => {};
    page.pushOperators(pushGraphicsState());
    rotation(page, degrees, box);
    return () => { page.pushOperators(popGraphicsState()); };
  }
  async function group(page: PDFPage, style: ComponentStyle | undefined, box: PdfStyleBox, draw: (target: PDFPage) => Promise<void>): Promise<void> {
    const opacity = style?.opacity ?? 1;
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new RangeError("Invalid PDF opacity");
    const leave = enter(page, style?.rotateDeg ?? 0, box);
    let target: PDFPage | undefined;
    try {
      if (opacity === 1) { await draw(page); return; }
      // CSS opacity composites the whole element once, including overlapping text/fills/borders.
      target = PDFPage.create(document);
      target.setSize(page.getWidth(), page.getHeight());
      target.pushOperators(pushGraphicsState(), popGraphicsState());
      await draw(target);
      const padding = (style?.rotateDeg ? Math.hypot(box.width, box.height) : 0) + (style?.lineWidthPt ?? 1);
      const bounds = { left: Math.min(0, box.x - padding), bottom: Math.min(0, box.yTop - box.height - padding), right: Math.max(page.getWidth(), box.x + box.width + padding), top: Math.max(page.getHeight(), box.yTop + padding) };
      // Keep original coordinates, including off-page content which rotation can bring into view.
      const embedded = await document.embedPage(target, bounds, [1, 0, 0, 1, 0, 0]);
      await embedded.embed();
      const stream = document.context.lookup(embedded.ref, PDFStream);
      stream.dict.set(PDFName.of("Group"), document.context.obj({ S: "Transparency", I: true, K: false, CS: "DeviceRGB" }));
      page.drawPage(embedded, { x: 0, y: 0, xScale: 1, yScale: 1, opacity });
    } finally { if (target) releaseTarget(document, target); leave(); }
  }
  return { group };
}

/** Graphics properties have already been applied by the surrounding component/cell scope. */
export function textOnlyStyle(style: ComponentStyle): ComponentStyle {
  const result = { ...style };
  delete result.opacity; delete result.rotateDeg;
  return result;
}

/** The temporary page is not part of the page tree; its contents have been copied into the form. */
function releaseTarget(document: PDFDocument, target: PDFPage): void {
  const contents = target.node.Contents();
  if (contents instanceof PDFArray) for (let index = 0; index < contents.size(); index++) {
    const ref = contents.get(index);
    if (ref instanceof PDFRef) document.context.delete(ref);
  }
  document.context.delete(target.ref);
}
