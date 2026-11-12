import { parseImportRange } from "../xlsx/import-range";
import type { ExcelImportDiagnostic, ExcelImportResult } from "../xlsx/import-types";

export interface ImportDiagnosticTarget { sheet: string; row: number; column: number }
/** Workbook coordinates are metadata, never inferred by parsing a translated warning. */
export function importDiagnosticTarget(diagnostic: ExcelImportDiagnostic, source: ExcelImportResult): ImportDiagnosticTarget | undefined {
  const sheet = source.sheets.find(sheet => sheet.name === diagnostic.sheet);
  if (!sheet) return;
  try {
    const bounds = parseImportRange(sheet.range), location = diagnostic.cell ?? diagnostic.range;
    const range = location ? parseImportRange(location) : undefined;
    const row = diagnostic.row ?? range?.top ?? bounds.top, column = diagnostic.column ?? range?.left ?? bounds.left;
    if (!Number.isInteger(row) || !Number.isInteger(column) || row < bounds.top || row > bounds.bottom || column < bounds.left || column > bounds.right) return;
    return { sheet: sheet.name, row, column };
  } catch { return; }
}
