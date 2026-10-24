// @vitest-environment node
import { describe, expect, it } from "vitest";
import ExcelJSRuntime from "exceljs";
import type * as ExcelJS from "exceljs";
import { importExcelTemplate, renderPlanToXlsx } from "../xlsx";
import { paginateTemplate } from "../layout/paginate";
import { resolveGridLayout } from "../render/grid-geometry";
import { validateRenderPlan } from "../schema/validate";
import type { GridCell } from "../schema/render-plan";
import { applyReportCellEdit, createReportCellEdit } from "../editing";

async function excel(build: (workbook: ExcelJS.Workbook) => void): Promise<Uint8Array> {
  const workbook = new ExcelJSRuntime.Workbook();
  build(workbook);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

function importedCells(result: Awaited<ReturnType<typeof importExcelTemplate>>): GridCell[] {
  return result.template.pages.flatMap((page) => page.components.flatMap((component) => "grid" in component ? component.grid?.cells.flatMap((row) => row.filter((cell): cell is GridCell => cell !== null)) ?? [] : []));
}

describe("importExcelTemplate", () => {
  it("无边框与显式单边在导入、分页及实际 Excel 写读后保持原样", async () => {
    const bytes = await excel((workbook) => {
      const sheet = workbook.addWorksheet("边框");
      sheet.getCell("A1").value = "无边框";
      sheet.getCell("B1").value = "仅下边框";
      sheet.getCell("B1").border = { bottom: { style: "thin", color: { argb: "FF123456" } } };
      sheet.mergeCells("A2:B2"); sheet.getCell("A2").value = "合并单元格仅上边框";
      sheet.getCell("A2").border = { top: { style: "thin" } };
    });
    const result = await importExcelTemplate(bytes);
    const cells = importedCells(result);
    expect(cells[0]!.style).toMatchObject({ borderTop: false, borderRight: false, borderBottom: false, borderLeft: false });
    expect(cells[1]!.style).toMatchObject({ borderTop: false, borderRight: false, borderBottom: true, borderLeft: false });
    expect(cells[2]!.style).toMatchObject({ borderTop: true, borderRight: false, borderBottom: false, borderLeft: false });
    const { buffer } = await renderPlanToXlsx(paginateTemplate(result.template, {}).plan);
    const reread = new ExcelJSRuntime.Workbook(); await reread.xlsx.load(buffer);
    const sheet = reread.worksheets[0]!;
    expect(sheet.getCell("A1").border).toEqual({});
    expect(sheet.getCell("B1").border).toEqual({ bottom: { style: "thin", color: { argb: "FF123456" } } });
    expect(sheet.getCell("A2").border.top?.style).toBe("thin");
    expect(sheet.getCell("A2").border.bottom).toBeUndefined();
  });

  it("空白数字模板按格式右对齐且保留显式左对齐、文本格式与文本编号", async () => {
    const bytes = await excel((workbook) => {
      const sheet = workbook.addWorksheet("空白对齐");
      sheet.addRow(["数量", "左对齐金额", "文本", "编号"]);
      sheet.getCell("A2").numFmt = "0.000";
      sheet.getCell("B2").numFmt = "#,##0.00"; sheet.getCell("B2").alignment = { horizontal: "left" };
      sheet.getCell("C2").numFmt = "@";
      sheet.getCell("D2").value = "000012"; sheet.getCell("D2").numFmt = "00000";
    });
    const result = await importExcelTemplate(bytes);
    expect(importedCells(result).slice(4).map((cell) => [cell.value, cell.style?.align])).toEqual([[null, "right"], [null, "left"], [null, "left"], ["000012", "left"]]);
    const plan = paginateTemplate(result.template, {}).plan;
    const edit = createReportCellEdit(plan, { pageIndex: 0, componentIndex: 1, rowIndex: 0, columnIndex: 0 }, 12.5);
    const { buffer } = await renderPlanToXlsx(applyReportCellEdit(plan, edit));
    const reread = new ExcelJSRuntime.Workbook(); await reread.xlsx.load(buffer);
    const sheet = reread.worksheets[0]!;
    expect(sheet.getCell("A2").value).toBe(12.5);
    expect(sheet.getCell("A2").alignment?.horizontal).toBe("right");
    expect(sheet.getCell("D2").value).toBe("000012");
  });

  it("imports all visible worksheets, preserves merge geometry/styles and roundtrips a single continuous sheet", async () => {
    const bytes = await excel((workbook) => {
      const sheet = workbook.addWorksheet("生产日报");
      sheet.columns = [{ width: 20 }, { width: 12 }, { width: 16 }];
      sheet.mergeCells("A1:B2"); sheet.getCell("A1").value = "合并标题";
      sheet.getCell("A1").font = { name: "Arial", size: 16, bold: true, color: { argb: "FF123456" } };
      sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFECFDF5" } };
      sheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
      sheet.getCell("A1").border = { top: { style: "thin", color: { argb: "FF345678" } } };
      sheet.getCell("C1").value = "数量"; sheet.getCell("C2").value = 0;
      sheet.getCell("A3").value = "00120"; sheet.getCell("B3").value = false; sheet.getCell("C3").value = 12.345;
      sheet.getCell("C3").numFmt = "0.000";
      sheet.getRow(1).height = 24; sheet.getRow(2).height = 18;
      workbook.addWorksheet("第二张").getCell("A1").value = "另一个报表";
      workbook.addWorksheet("隐藏", { state: "hidden" }).getCell("A1").value = "隐藏内容";
    });
    const result = await importExcelTemplate(bytes, { maxRowsPerPage: 2 });
    expect(result.sheets.map((sheet) => sheet.name)).toEqual(["生产日报", "第二张"]);
    expect(result.sheets[0]).toMatchObject({ index: 1, range: "A1:C3", rowCount: 3, columnCount: 3, pageStart: 0, pageCount: 2 });
    const first = result.template.pages[0]!.components[0]!;
    if (!("grid" in first)) throw new Error("expected grid");
    const layout = resolveGridLayout(first.grid!, first.widthMm, first.heightMm);
    expect(layout.cells.map((box) => [box.ri, box.ci, box.cell.text])).toEqual([[0, 0, "合并标题"], [0, 2, "数量"], [1, 2, "0"]]);
    expect(layout.cells[0]!.cell).toMatchObject({ colSpan: 2, rowSpan: 2, style: { fontFamily: "Arial", fontSize: 16, bold: true, color: "#123456", backgroundColor: "#ECFDF5", align: "center", verticalAlign: "middle", borderTop: true, borderColor: "#345678" } });
    expect(first.heightMm).toBeCloseTo(42 * 25.4 / 72);
    const plan = paginateTemplate(result.template, {}).plan;
    expect(validateRenderPlan(plan).ok).toBe(true);
    const output = await renderPlanToXlsx(plan);
    expect(output.workbook.worksheets.map((sheet) => sheet.name)).toEqual(["生产日报", "第二张"]);
    const sheet = output.workbook.worksheets[0]!;
    expect(sheet.model.merges).toContain("A1:B2");
    expect(sheet.getCell("A3").value).toBe("00120");
    expect(sheet.getCell("B3").value).toBe(false);
    expect(sheet.getCell("C2").value).toBe(0);
    expect(sheet.getCell("C3").value).toBe(12.345);
    expect(sheet.getCell("C3").numFmt).toBe("0.000");
    expect(sheet.getColumn(1).width).toBeCloseTo(20);
  });

  it("retains raw primitives and common numeric formatting without converting text IDs or blanks to zero", async () => {
    const bytes = await excel((workbook) => {
      const sheet = workbook.addWorksheet("类型");
      sheet.addRow(["炉号", "数量", "产率", "缺失", "确认", "负数", "千分位", "数值编号"]);
      sheet.addRow(["000012", 0, 0.125, null, false, -12.3, 1234.5, 12]);
      sheet.getCell("B2").numFmt = "0.000"; sheet.getCell("C2").numFmt = "0.0%";
      sheet.getCell("F2").numFmt = "0.00"; sheet.getCell("G2").numFmt = "#,##0.00"; sheet.getCell("H2").numFmt = "00000";
    });
    const cells = importedCells(await importExcelTemplate(bytes));
    expect(cells.slice(8).map((cell) => [cell.text, cell.value])).toEqual([["000012", "000012"], ["0.000", 0], ["12.5%", 0.125], ["", null], ["FALSE", false], ["-12.30", -12.3], ["1,234.50", 1234.5], ["00012", 12]]);
    expect(cells[8]!.style?.align).toBe("left");
    expect(cells[9]!.style?.align).toBe("right");
    expect(cells[12]!.style?.align).toBe("center");
  });

  it("shows cached formula zero and reports missing caches; neither formulas nor hyperlinks are evaluated", async () => {
    const bytes = await excel((workbook) => {
      const sheet = workbook.addWorksheet("公式");
      sheet.getCell("A1").value = { formula: "1-1", result: 0 };
      sheet.getCell("B1").value = { formula: "SUM(2,3)" };
      sheet.getCell("C1").value = { text: "链接文字", hyperlink: "https://example.invalid/never-follow" };
      sheet.getCell("D1").value = { richText: [{ text: "不同", font: { bold: true } }, { text: "字体" }] };
      sheet.getCell("E1").value = { formula: "1=0", result: false };
    });
    const result = await importExcelTemplate(bytes);
    expect(importedCells(result)).toMatchObject([
      { text: "0", value: 0, formula: "1-1", editable: false },
      { text: "", value: null, formula: "SUM(2,3)", editable: false },
      { text: "链接文字", value: "链接文字" }, { text: "不同字体", value: "不同字体" },
      { text: "FALSE", value: false, formula: "1=0", editable: false }
    ]);
    expect(result.warnings.join("\n")).toMatch(/不会自动重算公式/);
    expect(result.warnings.join("\n")).toMatch(/没有缓存结果/);
    expect(importedCells(result)[3]).toMatchObject({ editable: false, richParagraphs: [{ segments: [{ text: "不同", style: { bold: true } }, { text: "字体" }] }] });
  });

  it.each([false, true])("retains UTC calendar dates as numeric Excel serials (date1904=%s)", async (date1904) => {
    const date = new Date("2026-10-15T08:09:10.000Z");
    const bytes = await excel((workbook) => {
      workbook.properties.date1904 = date1904;
      const cell = workbook.addWorksheet("日期").getCell("A1");
      cell.value = date; cell.numFmt = 'yyyy-mm-dd hh:mm:ss';
    });
    const result = await importExcelTemplate(bytes);
    const cell = importedCells(result)[0]!;
    expect(cell).toMatchObject({ text: "2026-10-15 08:09:10", numberFormat: "yyyy-mm-dd hh:mm:ss", editable: false });
    expect(cell.value).toBeCloseTo(date.getTime() / 86_400_000 + 25_569, 7);
    const output = await renderPlanToXlsx(paginateTemplate(result.template, {}).plan);
    const reread = new ExcelJSRuntime.Workbook();
    await reread.xlsx.load(output.buffer);
    expect((reread.worksheets[0]!.getCell("A1").value as Date).toISOString()).toBe(date.toISOString());
    expect(JSON.parse(JSON.stringify(result.template))).toEqual(result.template);
  });

  it("supports sheet names/positions and rectangular ranges while rejecting clipped merges", async () => {
    const bytes = await excel((workbook) => {
      workbook.addWorksheet("一").getCell("A1").value = "一";
      const sheet = workbook.addWorksheet("二"); sheet.mergeCells("B2:C3"); sheet.getCell("B2").value = "二";
      sheet.getCell("D4").value = "选区外";
    });
    const result = await importExcelTemplate(bytes, { sheets: [2], range: { 二: "$B$2:$C$3" } });
    expect(result.sheets[0]).toMatchObject({ name: "二", index: 2, range: "B2:C3", rowCount: 2, columnCount: 2 });
    expect(importedCells(result)).toMatchObject([{ text: "二", colSpan: 2, rowSpan: 2 }]);
    await expect(importExcelTemplate(bytes, { sheets: ["二"], range: "C2:D4" })).rejects.toThrow(/截断合并单元格/);
    await expect(importExcelTemplate(bytes, { sheets: ["不存在"] })).rejects.toThrow(/不存在/);
    await expect(importExcelTemplate(bytes, { sheets: [1, "一"] })).rejects.toThrow(/重复/);
  });

  it.each(["a3", "a4"] as const)("offers %s page dimensions without dropping right-hand columns", async (layout) => {
    const bytes = await excel((workbook) => { const sheet = workbook.addWorksheet("宽表"); sheet.addRow(Array.from({ length: 80 }, (_, index) => `列${index + 1}`)); });
    const result = await importExcelTemplate(bytes, { layout });
    expect(result.template.pages[0]).toMatchObject({ layout: "page", widthMm: layout === "a3" ? 420 : 297, heightMm: layout === "a3" ? 297 : 210 });
    expect(importedCells(result).at(-1)?.text).toBe("列80");
    const grid = result.template.pages[0]!.components[0]!;
    if (!("grid" in grid)) throw new Error("expected grid");
    const widthScale = grid.widthMm / (80 * (8.43 * 7 + 5) * 25.4 / 96);
    expect(grid.grid!.cells[0]![0]!.style!.fontSize).toBeCloseTo(11 * widthScale);
    expect(grid.grid!.rowHeightsMm![0]).toBeCloseTo(15 * 25.4 / 72 * widthScale);
    expect(grid.grid!.paddingMm).toBeCloseTo(0.25 * widthScale);
    expect(result.warnings.join("\n")).toMatch(/标准纸张列宽压缩较大/);
  });

  it("bounds large grid segments by row count and cell count and preserves all 82 x 2,000 cells", async () => {
    const bytes = await excel((workbook) => {
      const sheet = workbook.addWorksheet("大宽表");
      for (let row = 1; row <= 2_000; row++) sheet.addRow(Array.from({ length: 82 }, (_, column) => row === 1 ? `列${column}` : row * 100 + column));
    });
    const result = await importExcelTemplate(bytes);
    expect(result.sheets[0]).toMatchObject({ rowCount: 2_000, columnCount: 82, pageCount: 25 });
    expect(importedCells(result)).toHaveLength(164_000);
    expect(result.template.pages.every((page) => page.components.every((component) => "grid" in component && component.grid!.cells.length <= 80))).toBe(true);
    expect(importedCells(result).at(-1)?.value).toBe(200_081);
  }, 30_000);

  it("accepts Blob and exact ArrayBuffer views", async () => {
    const bytes = await excel((workbook) => { workbook.addWorksheet("简单").getCell("A1").value = "内容"; });
    expect(importedCells(await importExcelTemplate(new Blob([bytes.buffer as ArrayBuffer])))[0]?.text).toBe("内容");
    const padded = new Uint8Array(bytes.length + 10); padded.set(bytes, 5);
    expect(importedCells(await importExcelTemplate(padded.subarray(5, 5 + bytes.length)))[0]?.text).toBe("内容");
    expect(importedCells(await importExcelTemplate(Buffer.from(padded).subarray(5, 5 + bytes.length)))[0]?.text).toBe("内容");
    expect(importedCells(await importExcelTemplate(bytes.buffer as ArrayBuffer))[0]?.text).toBe("内容");
  });

  it("uses one numeric formatter for imported currency, editing and typed Excel export", async () => {
    const numberFormat = '"¥"#,##0.00;[Red]("¥"#,##0.00);"-"';
    const bytes = await excel((workbook) => {
      const sheet = workbook.addWorksheet("金额");
      sheet.getCell("A1").value = "金额";
      sheet.getCell("A2").value = -1234.5; sheet.getCell("A2").numFmt = numberFormat;
    });
    const imported = await importExcelTemplate(bytes);
    const plan = paginateTemplate(imported.template, {}).plan;
    const edit = createReportCellEdit(plan, { pageIndex: 0, componentIndex: 1, rowIndex: 0, columnIndex: 0 }, -2500.25);
    expect(edit.previousText).toBe("(¥1,234.50)");
    expect(edit.text).toBe("(¥2,500.25)");
    const output = await renderPlanToXlsx(applyReportCellEdit(plan, edit));
    expect(output.workbook.worksheets[0]!.getCell("A2").value).toBe(-2500.25);
    expect(output.workbook.worksheets[0]!.getCell("A2").numFmt).toBe(numberFormat);
  });

  it("preserves blank numeric formats through import, editing, clearing and actual Excel roundtrips", async () => {
    const bytes = await excel((workbook) => {
      const sheet = workbook.addWorksheet("空模板");
      sheet.getCell("A1").value = "数量";
      sheet.getCell("A2").numFmt = "0.000";
    });
    const result = await importExcelTemplate(bytes);
    expect(importedCells(result)[1]).toMatchObject({ value: null, valueType: "number", text: "", editable: true });
    const plan = paginateTemplate(result.template, {}).plan;
    const blankOutput = await renderPlanToXlsx(plan);
    const blankWorkbook = new ExcelJSRuntime.Workbook();
    await blankWorkbook.xlsx.load(blankOutput.buffer);
    expect(blankWorkbook.worksheets[0]!.getCell("A2").value).toBeNull();
    expect(blankWorkbook.worksheets[0]!.getCell("A2").numFmt).toBe("0.000");
    const edit = createReportCellEdit(plan, { pageIndex: 0, componentIndex: 1, rowIndex: 0, columnIndex: 0 }, "1.2");
    expect(edit).toMatchObject({ value: 1.2, text: "1.200" });
    const filled = applyReportCellEdit(plan, edit);
    const cleared = applyReportCellEdit(filled, createReportCellEdit(filled, edit.address, ""));
    const clearedOutput = await renderPlanToXlsx(cleared);
    const clearedWorkbook = new ExcelJSRuntime.Workbook();
    await clearedWorkbook.xlsx.load(clearedOutput.buffer);
    expect(clearedWorkbook.worksheets[0]!.getCell("A2").value).toBeNull();
    expect(clearedWorkbook.worksheets[0]!.getCell("A2").numFmt).toBe("0.000");
  });
});
