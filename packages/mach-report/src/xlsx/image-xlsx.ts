import type * as ExcelJS from "exceljs";
import { excelColumnWidthToMm } from "./column-width";
import type { PlanComponent } from "../schema/render-plan";

import { createImageMediaInspector, type ImageMediaOptions } from "../output/media";

export type XlsxImageOptions = ImageMediaOptions;
export interface XlsxImageWriter {
  write(sheet: ExcelJS.Worksheet, component: PlanComponent, row: number, overlay?: { offsetMm: number; leftMm: number }): number;
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
/** Normalize edited overlay offsets against actual row heights, including moves across row boundaries. */
function verticalAnchor(sheet: ExcelJS.Worksheet, row: number, offsetMm: number): Pick<ExcelJS.IAnchor, "nativeRow" | "nativeRowOff"> {
  let remaining = offsetMm * 72 / 25.4;
  if (!Number.isFinite(remaining) || Math.abs(remaining) > 1_048_576 * 409) throw new Error("Excel 图片纵向偏移超过工作表范围");
  const rowHeight = (index: number): number => {
    const height = sheet.getRow(index).height ?? sheet.properties.defaultRowHeight ?? 15;
    if (!Number.isFinite(height) || height <= 0) throw new Error("Excel 图片锚点所在行高无效");
    return height;
  };
  while (remaining < 0 && row > 1) remaining += rowHeight(--row);
  while (row <= 1_048_576 && remaining >= rowHeight(row)) remaining -= rowHeight(row++);
  if (row > 1_048_576 || remaining < 0) throw new Error("Excel 图片移动到工作表边界之外");
  return { nativeRow: row - 1, nativeRowOff: Math.round(remaining * 25.4 / 72 * 36_000) };
}
/** Images occupy their own flow band; PDF-style absolute page geometry is not inferred. */
export function createXlsxImageWriter(workbook: ExcelJS.Workbook, options: XlsxImageOptions, warnings: string[]): XlsxImageWriter {
  const inspect = createImageMediaInspector(options);
  const images = new Map<string, number>();
  return { write(sheet, component, row, overlay) {
    if (![component.widthMm, component.heightMm, component.leftMm].every(Number.isFinite) || component.widthMm < 0 || component.heightMm < 0 || component.leftMm < 0) throw new Error("Excel 图片尺寸无效");
    if (!component.widthMm || !component.heightMm) return row;
    if (!component.imageData || !/^data:image\/(png|jpe?g);base64,/i.test(component.imageData)) { warnings.push(`${component.nid ?? component.kind}: Excel 图片仅支持 PNG/JPEG data URI，已跳过`); return row; }
    const data = inspect(component.imageData);
    let imageId = images.get(data.dataUrl);
    if (imageId === undefined) {
      imageId = workbook.addImage({ base64: data.dataUrl, extension: data.extension });
      images.set(data.dataUrl, imageId);
    }
    const nextRow = overlay ? row : reserveRows(sheet, row, component.heightMm);
    sheet.addImage(imageId, {
      tl: { ...imageAnchor(sheet, overlay?.leftMm ?? component.leftMm, row), ...(overlay ? verticalAnchor(sheet, row, overlay.offsetMm) : {}) },
      ext: { width: component.widthMm * 96 / 25.4, height: component.heightMm * 96 / 25.4 },
      editAs: "oneCell",
    });
    return nextRow;
  } };
}
