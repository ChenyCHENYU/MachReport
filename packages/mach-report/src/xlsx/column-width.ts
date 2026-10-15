const PX_TO_MM = 25.4 / 96;

/** Calibri 11 approximation: 7px maximum digit width plus 5px cell padding; sub-one widths scale the entire 12px. */
export function excelColumnWidthToMm(width: number): number {
  return (width < 1 ? width * 12 : width * 7 + 5) * PX_TO_MM;
}

/** Inverse of excelColumnWidthToMm; custom workbook fonts can have different digit metrics. */
export function mmToExcelColumnWidth(widthMm: number): number {
  const pixels = widthMm / PX_TO_MM;
  return pixels < 12 ? pixels / 12 : (pixels - 5) / 7;
}
