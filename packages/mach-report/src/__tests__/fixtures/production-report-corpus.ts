import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";

/** Frozen application metadata only; data and workbook layout are synthetic replay fixtures. */
interface ColumnSnapshot { key: string; cell: string; label: string; mappingKind: string; precisionHint: number }
interface MetricSnapshot { key: string; label: string; unit: string; monthlyLabel?: string | null; cell?: string }
interface ReportSnapshot { id: string; title: string; renderTitle: string; columns: ColumnSnapshot[]; metrics?: MetricSnapshot[] }
export const productionSnapshot = JSON.parse(readFileSync(new URL("./production-report-structures.json", import.meta.url), "utf8")) as { provenance: { originalWorkbookAvailable: boolean; businessMappingVerified: boolean; allValuesSynthetic: boolean }; reports: ReportSnapshot[] };
export const EXACT_STRUCTURE_DECIMAL = "12345678901234567890.123456789012345678";
const cases = [0, null, 1, "0000123", EXACT_STRUCTURE_DECIMAL, false];

function fixtureRows(report: ReportSnapshot): Array<Array<string | number | boolean | null>> {
  if (report.metrics) return report.metrics.map((metric, index) => [`M${String(index + 1).padStart(3, "0")}`, cases[index % cases.length]!, cases[(index + 2) % cases.length]!]);
  return cases.map(value => report.columns.map(() => value));
}
export async function structureWorkbookFixture(report: ReportSnapshot) {
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet(report.renderTitle);
  const headers = report.metrics ? ["Metric", "Daily", "Monthly"] : report.columns.map(column => column.key);
  sheet.addRow(headers);
  const rows = fixtureRows(report);
  for (const row of rows) sheet.addRow(row);
  for (let column = 1; column <= headers.length; column++) sheet.getColumn(column).width = report.metrics ? 42 : 28;
  for (let row = 1; row <= rows.length + 1; row++) {
    sheet.getRow(row).height = rows[row - 2]?.includes(EXACT_STRUCTURE_DECIMAL) ? 40 : 18;
    for (let column = 1; column <= headers.length; column++) {
      sheet.getCell(row, column).font = { name: "Helvetica", size: 10 };
      sheet.getCell(row, column).alignment = { horizontal: "center", vertical: "middle" };
    }
  }
  return { bytes: new Uint8Array(await workbook.xlsx.writeBuffer()), rows, headers };
}
