import type * as ExcelJS from "exceljs";
import type { PlanComponent } from "../schema/render-plan";
import { createImageMediaInspector } from "../output/media";
import type { CellRange, RowSegment } from "./import-range";
import type { ImportWarnings } from "./import-types";
interface ImageGeometry { margin: number; scale: number; columns: number[]; rowHeight(row: number): number }
interface ImageMetrics extends ImageGeometry { columnOffsets: number[]; rowOffsets: number[] }
function imageMetrics(geometry: ImageGeometry, range: CellRange): ImageMetrics {
  const columnOffsets = [0], rowOffsets = [0];
  for (const width of geometry.columns) columnOffsets.push(columnOffsets[columnOffsets.length - 1]! + width);
  for (let row = range.top; row <= range.bottom; row++) rowOffsets.push(rowOffsets[rowOffsets.length - 1]! + geometry.rowHeight(row));
  return { ...geometry, columnOffsets, rowOffsets };
}
interface NativeAnchor { nativeCol: number; nativeRow: number; nativeColOff: number; nativeRowOff: number }
interface PositionedImage { row: number; rowOffset: number; left: number; width: number; height: number; data: string; id: string }
function anchorPoint(anchor: NativeAnchor, range: CellRange, geometry: ImageMetrics): { x: number; y: number } | undefined {
  if (![anchor.nativeCol, anchor.nativeRow, anchor.nativeColOff, anchor.nativeRowOff].every(value => Number.isSafeInteger(value) && value >= 0)) return;
  if (anchor.nativeCol < range.left - 1 || anchor.nativeCol > range.right || anchor.nativeRow < range.top - 1 || anchor.nativeRow > range.bottom) return;
  const x = geometry.columnOffsets[anchor.nativeCol - range.left + 1]! + anchor.nativeColOff / 36_000 * geometry.scale;
  const y = geometry.rowOffsets[anchor.nativeRow - range.top + 1]! + anchor.nativeRowOff / 36_000 * geometry.scale;
  return { x, y };
}
function dataUrl(workbook: ExcelJS.Workbook, id: string): string | undefined {
  const media = workbook.getImage(Number(id));
  if (!media || !["png", "jpeg", "jpg"].includes(media.extension)) return;
  const type = media.extension === "png" ? "png" : "jpeg";
  if (media.base64) return media.base64.startsWith("data:") ? media.base64 : `data:image/${type};base64,${media.base64}`;
  if (!media.buffer) return;
  const bytes = new Uint8Array(media.buffer as unknown as ArrayBuffer), chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += 8192) chunks.push(String.fromCharCode(...bytes.subarray(index, index + 8192)));
  return `data:image/${type};base64,${btoa(chunks.join(""))}`;
}
function positionImage(image: ReturnType<ExcelJS.Worksheet["getImages"]>[number], range: CellRange, geometry: ImageMetrics, data: string): PositionedImage | undefined {
  const tl = image.range.tl, first = anchorPoint(tl, range, geometry);
  // A bottom-right anchor may touch the exclusive range boundary; a top-left anchor may not.
  if (!first || tl.nativeCol >= range.right || tl.nativeRow >= range.bottom) return;
  const br = image.range.br ? anchorPoint(image.range.br, range, geometry) : undefined;
  const extent = (image.range as ExcelJS.ImageRange & { ext?: { width: number; height: number } }).ext;
  const width = extent ? extent.width * 25.4 / 96 * geometry.scale : (br?.x ?? first.x) - first.x;
  const height = extent ? extent.height * 25.4 / 96 * geometry.scale : (br?.y ?? first.y) - first.y;
  const fullWidth = geometry.columnOffsets[geometry.columnOffsets.length - 1]!;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || first.x + width > fullWidth + 0.01) return;
  return { row: tl.nativeRow + 1, rowOffset: tl.nativeRowOff / 36_000 * geometry.scale, left: first.x, width, height, data, id: image.imageId };
}
/** Native PNG/JPEG drawings only. No linked media, scripts, cropping, rotation or hidden I/O. */
export function createSheetImageImporter(workbook: ExcelJS.Workbook, sheet: ExcelJS.Worksheet, range: CellRange, geometry: ImageGeometry, warnings: ImportWarnings, inspect: ReturnType<typeof createImageMediaInspector>): (segment: RowSegment) => PlanComponent[] {
  const drawings = sheet.getImages();
  if (!drawings.length) return () => [];
  const metrics = imageMetrics(geometry, range), media = new Map<string, string | undefined>(), images: PositionedImage[] = [];
  for (const [index, image] of drawings.entries()) {
    if (!media.has(image.imageId)) media.set(image.imageId, dataUrl(workbook, image.imageId));
    const data = media.get(image.imageId), positioned = data ? positionImage(image, range, metrics, inspect(data).dataUrl) : undefined;
    if (positioned) images.push({ ...positioned, id: `${positioned.id}:${index}` });
    else warnings.add(`${sheet.name}: 图片 ${image.imageId} 不在完整选区内或不是 PNG/JPEG，未导入；可扩大 range`);
  }
  return segment => {
    const result: PlanComponent[] = [];
    for (const image of images) {
      if (image.row < segment.top || image.row > segment.bottom) continue;
      const start = metrics.rowOffsets[segment.top - range.top]!;
      const top = metrics.rowOffsets[image.row - range.top]! - start + image.rowOffset, available = metrics.rowOffsets[segment.bottom - range.top + 1]! - start;
      if (top + image.height > available + 0.01) { warnings.add(`${sheet.name}: 图片 ${image.id} 跨越预览分段，未裁剪导入；请提高 maxRowsPerPage 或调整图片位置`); continue; }
      result.push({ kind: "image", nid: `xlsx-image:${sheet.name}:${image.id}:${image.row}`, leftMm: geometry.margin + image.left, topMm: geometry.margin + top, widthMm: image.width, heightMm: image.height, imageData: image.data,
        meta: { xlsxOverlay: { version: "1", row: image.row - range.top, pageRow: image.row - segment.top, offsetMm: image.rowOffset, leftMm: image.left, sourceTopMm: geometry.margin + top, sourceLeftMm: geometry.margin + image.left } } });
    }
    return result;
  };
}
/** Overlay coordinates originate in an imported sheet and never insert extra data rows. */
export function importedImageOverlay(component: PlanComponent, continuous: boolean): { row: number; offsetMm: number; leftMm: number } | undefined {
  const metadata = component.meta?.xlsxOverlay;
  if (metadata === undefined) return;
  if (!metadata || typeof metadata !== "object") throw new Error("Excel 图片定位元数据无效");
  const data = metadata as Record<string, unknown>, row = continuous ? data.row : data.pageRow;
  if (data.version !== "1" || !Number.isSafeInteger(row) || Number(row) < 0 || Number(row) >= 1_048_576 || typeof data.offsetMm !== "number" || !Number.isFinite(data.offsetMm) || data.offsetMm < 0 || typeof data.leftMm !== "number" || !Number.isFinite(data.leftMm) || data.leftMm < 0) throw new Error("Excel 图片定位元数据无效");
  const delta = (key: "sourceTopMm" | "sourceLeftMm", value: number): number => {
    const source = data[key];
    if (typeof source !== "number" || !Number.isFinite(source)) throw new Error("Excel 图片定位元数据无效");
    return value - source;
  };
  const offsetMm = data.offsetMm + delta("sourceTopMm", component.topMm), leftMm = data.leftMm + delta("sourceLeftMm", component.leftMm);
  if (!Number.isFinite(offsetMm) || !Number.isFinite(leftMm) || leftMm < 0) throw new Error("Excel 图片移动到工作表边界之外");
  return { row: Number(row) + 1, offsetMm, leftMm };
}
