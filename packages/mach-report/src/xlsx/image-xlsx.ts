import type * as ExcelJS from "exceljs";
import { excelColumnWidthToMm } from "./column-width";
import type { PlanComponent } from "../schema/render-plan";

export interface XlsxImageOptions {
  /** Decoded bytes per unique embedded image; default 16 MiB. */
  maxImageBytes?: number;
  /** Total decoded bytes of unique images in this workbook; default 32 MiB. */
  maxTotalImageBytes?: number;
  /** Unique embedded media limit, default 1000; repeated placements reuse the same media. */
  maxImages?: number;
}
export interface XlsxImageWriter {
  write(sheet: ExcelJS.Worksheet, component: PlanComponent, row: number): number;
}
function limit(value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) throw new Error("Excel 图片字节预算应为正安全整数");
  return resolved;
}
interface ImageData { base64: string; key: string; extension: "png" | "jpeg"; bytes: number }
function imageData(component: PlanComponent, maximum: number): ImageData | undefined {
  const value = component.imageData;
  if (!value || !/^data:image\/(png|jpe?g);base64,/i.test(value)) return;
  if (value.length > Math.ceil(maximum / 3) * 4 + 64) throw new Error("Excel 单张图片超过字节预算");
  const comma = value.indexOf(","), encoded = value.slice(comma + 1);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) throw new Error("Excel 图片不是有效的 base64 数据");
  const bytes = encoded.length / 4 * 3 - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
  if (bytes > maximum) throw new Error("Excel 单张图片超过字节预算");
  const extension = /^data:image\/png;/i.test(value) ? "png" : "jpeg";
  const prefix = atob(encoded.slice(0, 12));
  if (extension === "png" ? !prefix.startsWith("\x89PNG\r\n\x1a\n") : !prefix.startsWith("\xff\xd8\xff")) throw new Error("Excel 图片内容与 PNG/JPEG 类型不一致");
  return { base64: `data:image/${extension};base64,${encoded}`, key: `${extension}:${encoded}`, extension, bytes };
}
function reserveRows(sheet: ExcelJS.Worksheet, row: number, heightMm: number): number {
  let remaining = heightMm * 72 / 25.4;
  if (!Number.isFinite(remaining) || row + Math.ceil(remaining / 409) - 1 > 1_048_576) throw new Error("Excel 图片占位超过工作表行数上限");
  while (remaining > 0) {
    if (row > 1_048_576) throw new Error("Excel 图片占位超过工作表行数上限");
    const height = Math.min(409, remaining);
    sheet.getRow(row++).height = height;
    remaining -= height;
  }
  return row;
}

/** Native drawing offsets use EMU, not ExcelJS fractional-character-width approximations. */
function imageAnchor(sheet: ExcelJS.Worksheet, leftMm: number, row: number): ExcelJS.IAnchor {
  let remaining = Math.round(leftMm * 36_000), column = 0;
  if (!Number.isSafeInteger(remaining)) throw new Error("Excel 图片锚点超出安全坐标范围");
  // Explicit default keeps image-only bands and offsets beyond a table deterministic.
  sheet.properties.defaultColWidth ??= 8.43;
  while (column < 16_384) {
    const width = sheet.getColumn(column + 1).width ?? sheet.properties.defaultColWidth;
    const emu = Math.round(excelColumnWidthToMm(width) * 36_000);
    if (!Number.isSafeInteger(emu) || emu <= 0) throw new Error("Excel 图片锚点所在列宽无效");
    if (remaining < emu) return { col: column + remaining / emu, row: row - 1, nativeCol: column, nativeColOff: remaining, nativeRow: row - 1, nativeRowOff: 0 };
    remaining -= emu; column++;
  }
  throw new Error("Excel 图片锚点超过16384列上限");
}
/** Images occupy their own flow band; PDF-style absolute page geometry is not inferred. */
export function createXlsxImageWriter(workbook: ExcelJS.Workbook, options: XlsxImageOptions, warnings: string[]): XlsxImageWriter {
  const perImage = limit(options.maxImageBytes, 16 * 1024 * 1024);
  const maximum = limit(options.maxTotalImageBytes, 32 * 1024 * 1024);
  const maxImages = limit(options.maxImages, 1000);
  const images = new Map<string, number>(), parsed = new Map<string, ImageData>();
  let total = 0;
  return { write(sheet, component, row) {
    if (![component.widthMm, component.heightMm, component.leftMm].every(Number.isFinite) || component.widthMm < 0 || component.heightMm < 0 || component.leftMm < 0) throw new Error("Excel 图片尺寸无效");
    if (!component.widthMm || !component.heightMm) return row;
    const data = parsed.get(component.imageData!) ?? imageData(component, perImage);
    if (data) parsed.set(component.imageData!, data);
    if (!data) { warnings.push(`${component.nid ?? component.kind}: Excel 图片仅支持 PNG/JPEG data URI，已跳过`); return row; }
    let imageId = images.get(data.key);
    if (imageId === undefined) {
      if (images.size >= maxImages) throw new Error("Excel 唯一图片数量超过预算");
      if (total + data.bytes > maximum) throw new Error("Excel 图片总字节数超过预算");
      imageId = workbook.addImage({ base64: data.base64, extension: data.extension });
      images.set(data.key, imageId); total += data.bytes;
    }
    const nextRow = reserveRows(sheet, row, component.heightMm);
    sheet.addImage(imageId, {
      tl: imageAnchor(sheet, component.leftMm, row),
      ext: { width: component.widthMm * 96 / 25.4, height: component.heightMm * 96 / 25.4 },
      editAs: "oneCell",
    });
    return nextRow;
  } };
}
