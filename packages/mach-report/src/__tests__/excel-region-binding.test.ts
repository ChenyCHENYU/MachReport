// @vitest-environment node
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { importExcelTemplate } from "../xlsx/import-template";
import { createExcelRegionBindingDocument, createExcelRegionBindingSession, excelBindingCellRange, parseExcelRegionBindingSession, validateExcelRegionBindings, type ExcelRegionBindingRecipe } from "../xlsx/region-binding-workflow";
import type { ExcelBindingDataset } from "../xlsx/binding-workflow";
import { paginateTemplate } from "../layout/paginate";
import { createReportSource } from "../source/report-source";
import { columnName } from "../xlsx/import-range";
import type { ExcelImportResult } from "../xlsx/import-types";
import { renderPlanToXlsx } from "../xlsx/render-xlsx";

const fields = ["id", ...Array.from({ length: 11 }, (_, index) => `value${index + 1}`)];
const datasets: ExcelBindingDataset[] = ["production", "cost"].map(id => ({ id, rowKey: "id", fields: fields.map(field => ({ field, type: field === "id" ? "text" as const : "number" as const, ...(field === "id" ? { semanticRole: "identifier" as const } : { digits: 2, unit: "元" }) })) }));
function recipe(): ExcelRegionBindingRecipe {
  return { version: "2.0", sheet: "W4", regions: [
    { id: "production", range: "A3:L3", dataset: "production", mode: "record", fields, rowKey: "id" },
    { id: "cost", range: "A5:L5", headerRange: "A4:L4", dataset: "cost", mode: "repeat", fields, rowKey: "id" },
  ], footerRange: "A6:L6" };
}
async function fixture(columns = 12) {
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("W4");
  sheet.mergeCells(1, 1, 1, columns); sheet.getCell("A1").value = "W4 成本日报";
  for (let column = 1; column <= columns; column++) {
    sheet.getCell(2, column).value = `产量 ${column}`;
    sheet.getCell(3, column).value = `SAMPLE-PRODUCTION-${column}`;
    sheet.getCell(4, column).value = `成本 ${column}`;
    sheet.getCell(5, column).value = `SAMPLE-COST-${column}`;
    sheet.getColumn(column).width = 11 + column;
    sheet.getCell(3, column).alignment = { horizontal: column === 1 ? "center" : "right" };
  }
  sheet.mergeCells(6, 1, 6, columns); sheet.getCell("A6").value = "审核：业务确认";
  return importExcelTemplate(new Uint8Array(await workbook.xlsx.writeBuffer()));
}
function rows(count: number) {
  return Array.from({ length: count }, (_, index) => Object.fromEntries(fields.map((field, column) => [field, column === 0 ? `COST-${index}` : index * 100 + column])));
}
describe("multi-region Excel business bindings", () => {
  it("compiles the manual's A3:L3 record + A5:L5 list without sample leakage, then reads the real Excel back", async () => {
    const imported = await fixture(), before = JSON.stringify(imported);
    expect(validateExcelRegionBindings(imported, recipe(), datasets)).toEqual({ ok: true, issues: [], mapped: 24, total: 24 });
    const result = createExcelRegionBindingDocument(imported, recipe(), datasets, { id: "w4", name: "成本日报" });
    expect(JSON.stringify(result.document)).not.toContain("SAMPLE");
    const { plan, warnings } = paginateTemplate(result.document.template, { production: [{ id: "PRODUCTION", ...Object.fromEntries(fields.slice(1).map(field => [field, 0])) }], cost: rows(130) });
    expect(warnings).toEqual([]);
    expect(plan.pages.length).toBeGreaterThan(1);
    expect(JSON.stringify(plan)).toContain('"text":"0.00"');
    const bodies = plan.pages.flatMap(page => page.components.filter(component => component.table?.role === "body"));
    expect(bodies.filter(component => component.table?.source?.datasetId === "production")).toHaveLength(1);
    expect(bodies.filter(component => component.table?.source?.datasetId === "cost")).toHaveLength(130);
    for (const page of plan.pages) {
      const footer = page.components.find(component => component.pageAnchor === "footer")!;
      expect(footer).toBeDefined();
      for (const body of page.components.filter(component => component.table?.role === "body")) expect(body.topMm + body.heightMm).toBeLessThanOrEqual(footer.topMm + 0.001);
    }
    const encoded = await renderPlanToXlsx(plan), decoded = new ExcelJS.Workbook();
    await decoded.xlsx.load(encoded.buffer);
    expect(decoded.worksheets).toHaveLength(1);
    const sheet = decoded.worksheets[0]!, values = sheet.getSheetValues();
    expect(JSON.stringify(values)).not.toContain("SAMPLE");
    const costRows = sheet.getRows(1, sheet.rowCount)!.filter(row => String(row.getCell(1).value).startsWith("COST-"));
    expect(costRows).toHaveLength(130);
    expect(costRows[129]!.getCell(12).value).toBe(12911);
    expect(sheet.getColumn(12).width).toBeCloseTo(23, 2);
    expect(sheet.getRows(1, sheet.rowCount)!.filter(row => row.getCell(1).value === "成本 1")).toHaveLength(1);
    expect(sheet.getRows(1, sheet.rowCount)!.filter(row => row.getCell(1).value === "审核：业务确认")).toHaveLength(1);
    expect(JSON.stringify(imported)).toBe(before);
  });
  it("rejects unsafe collisions, partial merges, ambiguous record cardinality and unresolved identities before rendering", async () => {
    const imported = await fixture(), cases: Array<[string, (value: ExcelRegionBindingRecipe) => void]> = [
      ["旁列", value => { value.regions[1]!.range = "B5:L5"; value.regions[1]!.headerRange = "B4:L4"; value.regions[1]!.fields = fields.slice(1); }],
      ["重叠", value => { value.regions[1]!.range = "A3:L3"; delete value.regions[1]!.headerRange; }],
      ["合并", value => { value.regions[0]!.range = "A1:B1"; value.regions[0]!.fields = fields.slice(0, 2); }],
      ["一行原型", value => { value.regions[0]!.range = "A2:L3"; }],
      ["稳定业务主键", value => { value.regions[0]!.rowKey = ""; }],
      ["页尾", value => { value.footerRange = "A5:L6"; }],
    ];
    for (const [message, mutate] of cases) {
      const configured = recipe(); mutate(configured);
      expect(validateExcelRegionBindings(imported, configured, datasets).issues.map(issue => issue.message).join(" ")).toContain(message);
    }
    const compiled = createExcelRegionBindingDocument(imported, recipe(), datasets, { id: "w4", name: "成本日报" });
    expect(() => paginateTemplate(compiled.document.template, { production: rows(2), cost: [] })).toThrow(/record|单记录|一行/);
  });
  it("keeps partial record columns beside static labels at the same physical Excel cells", async () => {
    const workbook = new ExcelJS.Workbook(), source = workbook.addWorksheet("W4");
    source.getCell("A1").value = "编号"; source.getCell("B1").value = "重量"; source.getCell("C1").value = "金额"; source.getCell("D1").value = "状态";
    source.getCell("A2").value = "生产："; source.getCell("B2").value = "SAMPLE"; source.getCell("C2").value = 999; source.getCell("D2").value = "审核中";
    const input = await importExcelTemplate(new Uint8Array(await workbook.xlsx.writeBuffer()));
    const configured: ExcelRegionBindingRecipe = { version: "2.0", sheet: "W4", regions: [{ id: "record", range: "B2:C2", mode: "record", dataset: "record", fields: ["id", "amount"], rowKey: "id" }] };
    const catalog: ExcelBindingDataset[] = [{ id: "record", fields: [{ field: "id", type: "text" }, { field: "amount", type: "number", digits: 2 }] }];
    const compiled = createExcelRegionBindingDocument(input, configured, catalog, { id: "partial", name: "局部绑定" });
    const plan = paginateTemplate(compiled.document.template, { record: [{ id: "001", amount: 0 }] }).plan;
    const encoded = await renderPlanToXlsx(plan), decoded = new ExcelJS.Workbook(); await decoded.xlsx.load(encoded.buffer);
    const sheet = decoded.worksheets[0]!;
    expect([sheet.getCell("A2").value, sheet.getCell("B2").value, sheet.getCell("C2").value, sheet.getCell("D2").value]).toEqual(["生产：", "001", 0, "审核中"]);
  });
  it("preserves a vertically merged static neighbour when replacing the adjoining header and record", async () => {
    const workbook = new ExcelJS.Workbook(), source = workbook.addWorksheet("W4");
    source.getCell("A1").value = "总览"; source.getCell("D1").value = "状态";
    source.mergeCells("A2:A3"); source.getCell("A2").value = "跨两行的标签";
    source.getCell("B2").value = "编号"; source.getCell("C2").value = "金额"; source.getCell("D2").value = "头部备注";
    source.getCell("B3").value = "SAMPLE-ID"; source.getCell("C3").value = "SAMPLE-AMOUNT"; source.getCell("D3").value = "底部备注";
    const imported = await importExcelTemplate(new Uint8Array(await workbook.xlsx.writeBuffer()));
    const configured: ExcelRegionBindingRecipe = { version: "2.0", sheet: "W4", regions: [{ id: "record", range: "B3:C3", headerRange: "B2:C2", mode: "record", dataset: "record", fields: ["id", "amount"], rowKey: "id" }] };
    const catalog: ExcelBindingDataset[] = [{ id: "record", fields: [{ field: "id", type: "text" }, { field: "amount", type: "number" }] }];
    const compiled = createExcelRegionBindingDocument(imported, configured, catalog, { id: "merged", name: "合并邻列" });
    expect(JSON.stringify(compiled.document)).not.toContain("SAMPLE");
    const plan = paginateTemplate(compiled.document.template, { record: [{ id: "001", amount: 0 }] }).plan;
    const encoded = await renderPlanToXlsx(plan), decoded = new ExcelJS.Workbook(); await decoded.xlsx.load(encoded.buffer);
    const sheet = decoded.worksheets[0]!;
    expect(sheet.getCell("A2").value).toBe("跨两行的标签"); expect(sheet.getCell("A3").isMerged).toBe(true);
    expect(sheet.getCell("B3").value).toBe("001"); expect(sheet.getCell("C3").value).toBe(0);
    expect(sheet.getCell("D3").value).toBe("底部备注");
  });
  it("keeps empty records structural and read-only, supports per-page export, and rejects forged geometry", async () => {
    const imported = await fixture(), compiled = createExcelRegionBindingDocument(imported, recipe(), datasets, { id: "empty", name: "空记录" });
    const plan = paginateTemplate(compiled.document.template, { production: [], cost: rows(100) }).plan;
    const empty = plan.pages[0]!.components.find(component => component.table?.role === "body")!;
    expect(empty.table?.source).toBeUndefined();
    expect(empty.grid!.cells[0]!.every(cell => !cell?.source && cell?.editable === false)).toBe(true);
    const encoded = await renderPlanToXlsx(plan, { sheetMode: "pages" }), decoded = new ExcelJS.Workbook(); await decoded.xlsx.load(encoded.buffer);
    expect(decoded.worksheets).toHaveLength(plan.pages.length);
    const forged = structuredClone(plan);
    const component = forged.pages[0]!.components.find(item => !!item.meta?.xlsxFlow)!;
    (component.meta!.xlsxFlow as { columnStart: number }).columnStart = -1;
    await expect(renderPlanToXlsx(forged)).rejects.toThrow(/几何标记/);
    const relocated = structuredClone(plan); relocated.pages[0]!.components[0]!.leftMm += 1;
    await expect(renderPlanToXlsx(relocated)).rejects.toThrow(/横向位置/);
  });
  it("round-trips versioned sessions independently and rejects executable metadata without invoking it", async () => {
    const imported = await fixture(), original = createExcelRegionBindingSession(imported, recipe(), { id: "w4", name: "成本日报" });
    const restored = parseExcelRegionBindingSession(JSON.stringify(original));
    expect(restored).toEqual(original); restored.recipe.regions[0]!.fields[0] = "changed";
    expect(original.recipe.regions[0]!.fields[0]).toBe("id");
    let invoked = false;
    const unsafe = recipe(); Object.defineProperty(unsafe.regions[0], "dataset", { enumerable: true, get() { invoked = true; return "production"; } });
    expect(() => createExcelRegionBindingSession(imported, unsafe, original.identity)).toThrow(/安全|访问|元数据/);
    expect(invoked).toBe(false);
    expect(excelBindingCellRange(imported, "W4", { row: 3, column: 12 }, { row: 3, column: 1 })).toBe("A3:L3");
    expect(() => excelBindingCellRange(imported, "W4", { row: 3, column: 13 })).toThrow(/超出/);
  });
  it("isolates same-name Sheets when the same template is queried twice through the shared report source", async () => {
    const imported = await fixture(), compiled = createExcelRegionBindingDocument(imported, recipe(), datasets, { id: "same-template", name: "相同来源" });
    const first = { production: [{ id: "FIRST" }], cost: rows(2) }, second = { production: [{ id: "SECOND" }], cost: rows(3) };
    const source = createReportSource({ first: { template: compiled.document.template, datasets: first }, second: { template: compiled.document.template, datasets: second } });
    const plan = await source({ reportIds: ["first", "second"], params: {} });
    const encoded = await renderPlanToXlsx(plan), decoded = new ExcelJS.Workbook(); await decoded.xlsx.load(encoded.buffer);
    expect(decoded.worksheets).toHaveLength(2);
    expect(JSON.stringify(decoded.worksheets[0]!.getSheetValues())).toContain("FIRST");
    expect(JSON.stringify(decoded.worksheets[0]!.getSheetValues())).not.toContain("SECOND");
    expect(JSON.stringify(decoded.worksheets[1]!.getSheetValues())).toContain("SECOND");
  });
  it("keeps full-column metadata once per page instead of multiplying it by every rendered row", () => {
    const count = 512, width = count * 10, range = `A1:${columnName(count)}2`, keys = Array.from({ length: count }, (_, index) => index === 0 ? "id" : `v${index}`);
    const imported: ExcelImportResult = { warnings: [], sheets: [{ name: "wide", index: 1, range, rowCount: 2, columnCount: count, pageStart: 0, pageCount: 1 }], template: { pages: [{ widthMm: width, heightMm: 297, layout: "wide", components: [{ kind: "rect", leftMm: 0, topMm: 0, widthMm: width, heightMm: 12, meta: { xlsxSheet: "wide", xlsxRange: range }, grid: { cells: [keys.map(text => ({ text })), keys.map(() => ({ text: "SAMPLE" }))], colWidthsMm: keys.map(() => 10), rowHeightsMm: [6, 6] } }] }] } };
    const catalog: ExcelBindingDataset[] = [{ id: "wide", fields: keys.map(field => ({ field, type: field === "id" ? "text" : "number" })) }];
    const configured: ExcelRegionBindingRecipe = { version: "2.0", sheet: "wide", regions: [{ id: "rows", range: `A2:${columnName(count)}2`, headerRange: `A1:${columnName(count)}1`, mode: "repeat", dataset: "wide", rowKey: "id", fields: keys }] };
    const compiled = createExcelRegionBindingDocument(imported, configured, catalog, { id: "wide", name: "宽表元数据" });
    const values = Array.from({ length: 80 }, (_, index) => Object.fromEntries(keys.map((field, column) => [field, column ? column : `ROW-${index}`])));
    const plan = paginateTemplate(compiled.document.template, { wide: values }).plan;
    const metadata = JSON.stringify(plan.pages.map(page => ({ meta: page.meta, components: page.components.map(component => component.meta) })));
    expect(metadata.length).toBeLessThan(15_000);
    expect(metadata.match(/fullWidthsMm/g)).toHaveLength(plan.pages.length);
    expect(plan.pages.flatMap(page => page.components).every(component => !JSON.stringify(component.meta).includes("fullWidthsMm"))).toBe(true);
  });
});
