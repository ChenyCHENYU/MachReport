import ExcelJS from "exceljs";
import { createTableTemplate } from "../../builder/table-template";
import { createReportSource } from "../../source/report-source";
import { bindExcelTemplate } from "../../xlsx/bind-template";
import { importExcelTemplate } from "../../xlsx/import-template";

/** Synthetic acceptance data, deliberately unrelated to a business database or the six steel reports. */
export const EXACT_DECIMAL = "12345678901234567890.123456789012345678";
export const LONG_NOTE = "TRACEABILITY CHECK: preserve this deliberately long inspection explanation across every output without losing words.";
export const productionRows = Array.from({ length: 48 }, (_, index) => ({
  id: `PROD-${index}`, revision: 7, sequence: index + 1, heat: `00${String(index).padStart(3, "0")}`,
  qty: index === 0 ? 0 : index === 1 ? -2.5 : 1.25, ratio: index === 0 ? null : .125,
  lot: `LOT-${index}`, decimal: EXACT_DECIMAL, note: index === 0 ? LONG_NOTE : index === 1 ? "" : `Inspection ${index}`,
  warehouse: index < 24 ? "A" : "B"
}));

async function importedThreeLevelTemplate() {
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Three-Level");
  [18, 16, 16, 18, 45, 70].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.mergeCells("A1:A3"); sheet.getCell("A1").value = "Heat ID";
  sheet.mergeCells("B1:C1"); sheet.getCell("B1").value = "Measurements";
  sheet.mergeCells("B2:B3"); sheet.getCell("B2").value = "Quantity";
  sheet.mergeCells("C2:C3"); sheet.getCell("C2").value = "Ratio";
  sheet.mergeCells("D1:F1"); sheet.getCell("D1").value = "Traceability";
  sheet.mergeCells("D2:E2"); sheet.getCell("D2").value = "Business identity";
  sheet.getCell("D3").value = "Batch"; sheet.getCell("E3").value = "Exact decimal";
  sheet.mergeCells("F2:F3"); sheet.getCell("F2").value = "Inspection note";
  for (let row = 1; row <= 3; row++) sheet.getRow(row).height = 18;
  sheet.getCell("A4").value = "OLD SAMPLE MUST DISAPPEAR"; sheet.getCell("B4").value = 999; sheet.getCell("B4").numFmt = "0.000";
  sheet.getCell("C4").value = .5; sheet.getCell("C4").numFmt = "0.00%";
  sheet.getCell("E4").value = "sample"; sheet.getCell("E4").numFmt = "@";
  sheet.getCell("F4").value = "sample"; sheet.getCell("F4").alignment = { horizontal: "left", wrapText: true };
  const imported = await importExcelTemplate(new Uint8Array(await workbook.xlsx.writeBuffer()));
  return bindExcelTemplate(imported, [{ sheet: "Three-Level", header: "A1:F3", dataset: "production", rowKey: "id", revisionField: "revision", columns: [
    { field: "heat", semanticRole: "identifier" }, { field: "qty", format: { kind: "number", digits: 3 } },
    { field: "ratio", format: { kind: "percent", digits: 2 } }, { field: "lot", semanticRole: "identifier" },
    { field: "decimal", semanticRole: "text" }, { field: "note", align: "left" }
  ] }]).template;
}

export async function complexAcceptanceFixture() {
  const imported = await importedThreeLevelTemplate();
  const grouped = createTableTemplate({ title: "Grouped Production", paper: "a3", landscape: true, dataset: "production", columns: [
    { field: "sequence", header: "No", widthMm: 15, semanticRole: "identifier" },
    { field: "heat", header: "Heat ID", widthMm: 25, semanticRole: "identifier" },
    { field: "qty", header: "Quantity", widthMm: 25, format: { kind: "number", digits: 3 }, rules: [{ when: { field: "qty", op: "<", value: 0 }, style: { color: "#cc0000", backgroundColor: "#fff0f0", bold: true } }] },
    { field: "ratio", header: "Ratio", widthMm: 25, format: { kind: "percent", digits: 2 } },
    { field: "decimal", header: "Exact decimal", widthMm: 100, semanticRole: "text" },
    { field: "note", header: "Inspection note", widthMm: 190, align: "left" }
  ], listOptions: { id: "grouped", rowKey: "id", revisionField: "revision", rowHeightMm: 7, groupBy: { field: "warehouse", headerTemplate: "Warehouse {value}", subtotal: ["qty"], subtotalLabel: "Subtotal" }, grandTotal: { label: "Grand Total", fields: ["qty"] } } });
  const exceptions = createTableTemplate({ paper: "a3", landscape: true, title: "Independent Exceptions", dataset: "exceptions", columns: [{ field: "code", header: "Exception" }, { field: "reason", header: "Reason" }], listOptions: { id: "exceptions", rowKey: "id" } });
  grouped.pages.push(...exceptions.pages);
  const summary = createTableTemplate({ title: "A4 Summary", paper: "a4", dataset: "summary", columns: [{ field: "code", header: "Code", semanticRole: "identifier" }, { field: "count", header: "Count", valueType: "number" }], listOptions: { id: "summary", rowKey: "id" } });
  summary.pages[0]!.components.unshift({ kind: "text", leftMm: 10, topMm: 280, widthMm: 190, heightMm: 6, text: "Page {page} / {totalPages}" });
  const datasets = { production: productionRows, exceptions: [{ id: "EX-1", code: "EX-001", reason: "Unmatched measurement" }], summary: [{ id: "SUM-1", code: "00042", count: 0 }] };
  const fetcher = createReportSource({ mergedHeaders: { template: imported, datasets }, grouped: { template: grouped, datasets }, summary: { template: summary, datasets } });
  const plan = await fetcher({ reportIds: ["mergedHeaders", "grouped", "summary"], params: {} });
  return { plan, datasets, templates: { imported, grouped, summary } };
}
