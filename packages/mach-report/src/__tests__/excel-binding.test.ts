// @vitest-environment node
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { importExcelTemplate } from "../xlsx/import-template";
import { bindExcelTemplate } from "../xlsx/bind-template";
import { paginateTemplate } from "../layout/paginate";
import { renderPlanToXlsx } from "../xlsx/render-xlsx";

async function fixture() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("生产日报");
  sheet.getColumn(1).width = 16; sheet.getColumn(2).width = 22;
  sheet.mergeCells("A1:B1"); sheet.getCell("A1").value = "日报标题";
  sheet.mergeCells("A2:B2"); sheet.getCell("A2").value = "生产明细";
  sheet.getCell("A3").value = "炉号"; sheet.getCell("B3").value = "产重";
  sheet.getCell("A4").value = "SAMPLE MUST DISAPPEAR"; sheet.getCell("B4").value = 999;
  sheet.getCell("B4").numFmt = "0.000";
  sheet.getCell("A5").value = "OLD ROW"; sheet.getCell("B5").value = 999;
  const bytes = await workbook.xlsx.writeBuffer();
  return importExcelTemplate(new Uint8Array(bytes));
}

describe("Excel 业务区域绑定", () => {
  it("显式表头文字/对齐和常用数字格式作用于实际绑定计划及Excel", async () => {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Formats");
    sheet.getCell("A1").value = "Original"; sheet.getCell("A1").alignment = { horizontal: "left" };
    sheet.getCell("B1").value = "Ratio"; sheet.getCell("A2").value = "sample";
    sheet.getCell("B2").value = 0.125; sheet.getCell("B2").numFmt = "0.00%";
    const imported = await importExcelTemplate(new Uint8Array(await workbook.xlsx.writeBuffer()));
    const { template } = bindExcelTemplate(imported, [{ sheet: "Formats", header: "A1:B1", columns: [{ field: "id", header: "Heat", headerAlign: "right" }, "rate"] }]);
    const { plan } = paginateTemplate(template, { detail: [{ id: "001", rate: 0.125 }] });
    const header = plan.pages[0]!.components.find((component) => component.table?.role === "header")!;
    const body = plan.pages[0]!.components.find((component) => component.table?.role === "body")!;
    expect(header.grid!.cells[0]![0]).toMatchObject({ text: "Heat", style: { align: "right" } });
    expect(body.grid!.cells[0]![1]).toMatchObject({ text: "12.50%", value: 0.125, numberFormat: "0.00%" });
    const result = await renderPlanToXlsx(plan);
    expect(result.workbook.worksheets[0]!.getCell("B2").numFmt).toBe("0.00%");
    const original = imported.template.pages[0]!.components[0]!;
    if (original.kind === "list") throw new Error("fixture should be a static imported grid");
    expect(original.grid!.cells[0]![0]!.text).toBe("Original");
  });

  it("跨越明细和页脚边界的合并格拒绝绑定，不能静默丢失锚点内容", async () => {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Footer");
    for (let row = 1; row <= 5; row++) { sheet.getCell(row, 1).value = `A${row}`; sheet.getCell(row, 2).value = row; }
    sheet.mergeCells("A4:A5"); sheet.getCell("A4").value = "保留的跨行内容";
    const imported = await importExcelTemplate(new Uint8Array(await workbook.xlsx.writeBuffer()));
    expect(() => bindExcelTemplate(imported, [{ sheet: "Footer", header: "A1:B1", detail: "A2:B4", columns: ["id", "value"] }])).toThrow(/合并区域跨越绑定边界/);
    expect(JSON.stringify(imported)).toContain("保留的跨行内容");
  });

  it("同一合并表头的冲突配置明确报错，不以列顺序覆盖", async () => {
    const imported = await fixture();
    expect(() => bindExcelTemplate(imported, [{ sheet: "生产日报", header: "A1:B2", columns: [{ field: "a", header: "A" }, { field: "b", header: "B" }] }])).toThrow(/同一合并表头/);
  });
  it("保留多行合并表头、替换样例明细，重复查询与连续Excel不混入原样例", async () => {
    const imported = await fixture();
    const before = JSON.stringify(imported);
    const { template } = bindExcelTemplate(imported, [{
      sheet: "生产日报", header: "A2:B3", columns: [
        { field: "heat", semanticRole: "identifier" },
        { field: "weight", semanticRole: "measure", format: { kind: "number", digits: 3 } }
      ], dataset: "heats", rowKey: "id", revisionField: "revision"
    }]);
    const rows = Array.from({ length: 100 }, (_, id) => ({ id, revision: "v1", heat: `00${id}`, weight: id === 0 ? 0 : id + 0.125 }));
    const { plan } = paginateTemplate(template, { heats: rows });
    expect(plan.pages.length).toBeGreaterThan(1);
    const headers = plan.pages.flatMap((page) => page.components).filter((component) => component.table?.role === "header");
    expect(headers.length).toBeGreaterThan(1);
    expect(headers.every((header) => header.grid?.cells[0]?.[0]?.colSpan === 2)).toBe(true);
    const body = plan.pages.flatMap((page) => page.components).filter((component) => component.table?.role === "body");
    expect(body).toHaveLength(100);
    expect(body[0]?.table?.source).toEqual({ datasetId: "heats", rowKey: 0, revision: "v1" });
    expect(body[0]?.grid?.cells[0]?.[0]?.text).toBe("000");
    expect(body[0]?.grid?.cells[0]?.[0]?.style?.align).toBe("center");
    expect(body[0]?.grid?.cells[0]?.[1]?.text).toBe("0.000");
    expect(JSON.stringify(plan)).not.toContain("SAMPLE MUST DISAPPEAR");
    const { workbook } = await renderPlanToXlsx(plan, { sheetMode: "continuous", valueMode: "raw" });
    expect(JSON.stringify(workbook.worksheets.map((sheet) => sheet.getSheetValues()))).not.toContain("OLD ROW");
    expect(JSON.stringify(imported)).toBe(before);
    expect(paginateTemplate(template, { heats: [] }).plan.pages.flatMap((p) => p.components).filter((c) => c.table?.role === "body")).toHaveLength(0);
  });

  it("不猜字段，不允许半合并表头或重复业务主键", async () => {
    const imported = await fixture();
    expect(() => bindExcelTemplate(imported, [{ sheet: "生产日报", header: "A2:B3", columns: ["heat"] }])).toThrow(/逐列映射/);
    expect(() => bindExcelTemplate(imported, [{ sheet: "生产日报", header: "A2:B3", columns: ["same", "same"] }])).toThrow(/唯一/);
    const { template } = bindExcelTemplate(imported, [{ sheet: "生产日报", header: "A2:B3", columns: ["heat", "weight"], rowKey: "id" }]);
    expect(() => paginateTemplate(template, { detail: [{ id: 1 }, { id: 1 }] })).toThrow(/业务主键重复/);
    expect(() => paginateTemplate(template, { detail: [{ heat: "missing" }] })).toThrow(/稳定/);
  });
});
