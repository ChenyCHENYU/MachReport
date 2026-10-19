// @vitest-environment node
import { createReportSource } from "../source/report-source";
import { validateRenderPlan } from "../schema/validate";
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { renderPlanToXlsx } from "../xlsx";
import { renderPlanToPdf } from "../pdf/render-pdf";
import {
  paginateTemplate,
  type ListComponent,
  type ReportTemplate,
} from "../layout/paginate";
function fixture(): ReportTemplate {
  const list: ListComponent = {
    kind: "list",
    id: "invoice",
    dataset: "rows",
    leftMm: 5,
    topMm: 5,
    widthMm: 150,
    rowKey: "id",
    columns: [
      { header: "Item", field: "id", widthMm: 50 },
      {
        header: "Amount",
        field: "amount",
        widthMm: 50,
        format: { kind: "number", digits: 2 },
      },
      { header: "Value", field: "value", widthMm: 50 },
    ],
    computed: [
      {
        field: "amount",
        numeric: "decimal",
        digits: 2,
        expression: { op: "add", args: [{ field: "base" }, { value: "0.09" }] },
      },
    ],
    groups: [
      {
        field: "plant",
        headerTemplate: "Plant {value}",
        subtotalLabel: "Subtotal",
        aggregates: [
          { field: "amount", op: "sum", numeric: "decimal", digits: 2 },
          { field: "value", op: "weightedAvg", weightField: "weight" },
        ],
      },
    ],
    grandTotal: {
      label: "Total",
      aggregates: [
        { field: "amount", op: "sum", numeric: "decimal", digits: 2 },
        { field: "value", op: "sum" },
      ],
    },
  };
  return { pages: [{ widthMm: 160, heightMm: 100, components: [list] }] };
}
const data = {
  rows: [
    { id: "x1", plant: "A", base: "9007199254740993.01", value: 0, weight: 1 },
    { id: "x2", plant: "A", base: "0.11", value: 10, weight: 3 },
  ],
};
describe("complex report actual PDF / XLSX round trip", () => {
  it("keeps exact decimals, zero, weighted subtotal and total in a real workbook", async () => {
    const plan = paginateTemplate(fixture(), data).plan;
    const exported = await renderPlanToXlsx(plan, { sheetMode: "continuous" });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported.buffer);
    const sheet = workbook.worksheets[0]!;
    const values = sheet.getColumn(2).values;
    expect(values).toContain("9007199254740993.10");
    expect(values).toContain("9007199254740993.30");
    expect(sheet.getColumn(3).values).toContain(0);
    expect(sheet.getColumn(3).values).toContain(7.5);
    expect(sheet.getColumn(3).values).toContain(10);
    const exact = sheet.findRow(3)!.getCell(2);
    expect(exact.type).toBe(ExcelJS.ValueType.String);
    expect(data.rows[0]!.base).toBe("9007199254740993.01");
  });
  it("exports saved dynamic matrices to real Excel and PDF with raw totals", async () => {
    const source: ReportTemplate = {
      pages: [
        {
          widthMm: 160,
          heightMm: 100,
          layout: "wide",
          components: [
            {
              kind: "list",
              dataset: "rows",
              layout: "wide",
              leftMm: 5,
              topMm: 5,
              widthMm: 150,
              columns: [{ header: "Placeholder", field: "plant", widthMm: 30 }],
              matrix: {
                rowFields: ["plant"],
                columnFields: ["shift"],
                measures: [{ field: "value", op: "sum", label: "Value" }],
                totals: false,
              },
            },
          ],
        },
      ],
    };
    const plan = paginateTemplate(source, {
      rows: [
        { plant: "A", shift: "Day", value: 0 },
        { plant: "A", shift: "Night", value: 10 },
      ],
    }).plan;
    const exported = await renderPlanToXlsx(plan);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported.buffer);
    expect(workbook.worksheets[0]!.getRow(2).values).toEqual([
      undefined,
      "A",
      0,
      10,
    ]);
    const pdf = await renderPlanToPdf(plan);
    expect(pdf.pageErrors).toEqual([]);
    expect((await PDFDocument.load(pdf.bytes)).getPageCount()).toBe(1);
  });
  it("exports a schema-validated master/detail source to real Excel and PDF without aliasing identities", async () => {
    const source = createReportSource({ report: { template: { pages: [{ widthMm: 160, heightMm: 120, components: [{ kind: "list", dataset: "masters", rowKey: "id", leftMm: 5, topMm: 5, widthMm: 150, columns: [{ field: "id", header: "Master", widthMm: 75 }, { field: "value", header: "Value", widthMm: 75 }], detail: { dataset: "lines", parentKey: "id", foreignKey: "masterId", rowKey: "lineId", columns: [{ field: "lineId", header: "Line", widthMm: 75 }, { field: "qty", header: "Qty", widthMm: 75 }] } }] }] }, datasets: { masters: [{ id: "M1", value: 10 }, { id: "M2", value: 20 }], lines: [{ lineId: "L1", masterId: "M1", qty: 0 }, { lineId: "L2", masterId: "M2", qty: 2 }] } } });
    const plan = await source({ reportIds: ["report"], params: {} });
    expect(validateRenderPlan(plan).ok).toBe(true);
    const xlsx = await renderPlanToXlsx(plan, { sheetMode: "pages", valueMode: "raw" });
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(xlsx.buffer);
    const values: unknown[] = []; for (const sheet of workbook.worksheets) sheet.eachRow((row) => row.eachCell((cell) => { values.push(cell.value); }));
    expect(values).toContain("L1"); expect(values).toContain("L2"); expect(values).toContain(0);
    const pdf = await renderPlanToPdf(plan); expect(pdf.pageErrors).toEqual([]); expect((await PDFDocument.load(pdf.bytes)).getPageCount()).toBe(plan.pages.length);
  });
  it("reads back actual PDF pages and exact rendered decimal text", async () => {
    const plan = paginateTemplate(fixture(), data).plan;
    const exported = await renderPlanToPdf(plan);
    expect(exported.pageErrors).toEqual([]);
    const document = await PDFDocument.load(exported.bytes);
    expect(document.getPageCount()).toBe(plan.pages.length);
    const streams: string[] = [];
    document.context.enumerateIndirectObjects().forEach(([, object]) => {
      if (object instanceof PDFRawStream)
        streams.push(
          Buffer.from(decodePDFRawStream(object).decode()).toString("latin1"),
        );
    });
    const content = streams.join(" ").toUpperCase();
    expect(content).toContain(
      Buffer.from("9007199254740993.10").toString("hex").toUpperCase(),
    );
    expect(content).toContain(
      Buffer.from("9007199254740993.30").toString("hex").toUpperCase(),
    );
    expect(document.getPage(0).getWidth()).toBeCloseTo((160 * 72) / 25.4);
  });
});
