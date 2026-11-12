import type { RenderPlan } from "../schema/render-plan";
import type { ReportCellAddress } from "../editing/context";
import { resolveGridLayout } from "../render/grid-geometry";
import { parseImportRange } from "../xlsx/import-range";
import type { ExcelImportDiagnostic, ExcelImportedSheet } from "../xlsx/import-types";

/** Map original Excel coordinates to a segmented/merged preview without interpreting warning text. */
export function importedDiagnosticAddress(plan: RenderPlan, entry: ExcelImportDiagnostic): ReportCellAddress | undefined {
  if (!entry.sheet || entry.row === undefined || entry.column === undefined) return;
  for (const [pageIndex, page] of plan.pages.entries()) for (const [componentIndex, component] of page.components.entries()) {
    if (!component.grid || component.meta?.xlsxSheet !== entry.sheet || typeof component.meta.xlsxRange !== "string") continue;
    let range; try { range = parseImportRange(component.meta.xlsxRange); } catch { continue; }
    if (entry.row < range.top || entry.row > range.bottom || entry.column < range.left || entry.column > range.right) continue;
    const row = entry.row - range.top, column = entry.column - range.left;
    const box = resolveGridLayout(component.grid, component.widthMm, component.heightMm).cells.find(cell => cell.ri <= row && cell.ri + (cell.cell.rowSpan ?? 1) > row && cell.ci <= column && cell.ci + (cell.cell.colSpan ?? 1) > column);
    if (box) return { pageIndex, componentIndex, rowIndex: box.ri, columnIndex: box.ci };
  }
}
export function importedDiagnosticPage(sheets: readonly ExcelImportedSheet[], entry: ExcelImportDiagnostic): number | undefined {
  return sheets.find(sheet => sheet.name === entry.sheet)?.pageStart;
}
