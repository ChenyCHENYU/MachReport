// @vitest-environment node
import { describe, expect, it } from "vitest";
import ExcelJSRuntime from "exceljs";
import { createTableTemplate } from "../builder/table-template";
import { paginateTemplate } from "../layout/paginate";
import { createReportSource } from "../source/report-source";
import type { RenderPlan } from "../schema/render-plan";
import { renderPlanToXlsx } from "../xlsx";

function wideTemplate() {
  return createTableTemplate({
    layout: "wide",
    title: "炼钢/宽表",
    columns: Array.from({ length: 82 }, (_, index) => ({
      header: `指标${index + 1}`,
      field: `c${index}`,
      widthMm: 24,
      ...(index === 1 ? { format: { kind: "number" as const, digits: 3 } } : {})
    })),
    listOptions: { rowHeightMm: 6 }
  });
}

function wideRows() {
  return Array.from({ length: 120 }, (_, rowIndex) => Object.fromEntries(
    Array.from({ length: 82 }, (_, index) => [
      `c${index}`,
      index === 0 ? String(rowIndex).padStart(5, "0")
        : index === 1 ? rowIndex * 0.125
          : index === 2 ? rowIndex % 2 === 1
            : index === 3 ? null
              : index === 4 ? "=SUM(A1:A2)" : rowIndex * 100 + index
    ])
  ));
}

async function reread(plan: RenderPlan, options: Parameters<typeof renderPlanToXlsx>[1] = {}) {
  const result = await renderPlanToXlsx(plan, options);
  const workbook = new ExcelJSRuntime.Workbook();
  await workbook.xlsx.load(result.buffer);
  return { ...result, workbook };
}

describe("连续完整 Excel 宽表", () => {
  it("82 列、多预览页自动成为一张原始数值 Sheet，表头只保留一次", async () => {
    const plan = paginateTemplate(wideTemplate(), { detail: wideRows() }).plan;
    expect(plan.pages.length).toBeGreaterThan(1);
    const { workbook, warnings } = await reread(plan);
    expect(warnings).toEqual([]);
    expect(workbook.worksheets).toHaveLength(1);
    const sheet = workbook.worksheets[0]!;
    expect(sheet.name).toBe("炼钢 宽表");
    expect(sheet.columnCount).toBe(82);
    expect(sheet.rowCount).toBe(122);
    expect(sheet.getCell("A1").value).toBe("炼钢/宽表");
    expect(sheet.model.merges).toContain("A1:CD1");
    expect(sheet.getCell("A2").value).toBe("指标1");
    expect(sheet.getCell("A3").value).toBe("00000");
    expect(sheet.getCell("B3").value).toBe(0);
    expect(sheet.getCell("B4").value).toBe(0.125);
    expect(sheet.getCell("B4").numFmt).toBe("0.000");
    expect(sheet.getCell("C3").value).toBe(false);
    expect(sheet.getCell("C4").value).toBe(true);
    expect(sheet.getCell("D3").value).toBeNull();
    expect(sheet.getCell("E3").value).toBe("=SUM(A1:A2)");
    expect(sheet.getCell("E3").type).toBe(ExcelJSRuntime.ValueType.String);
    expect(sheet.getCell("CD122").value).toBe(11981);
    const headers: number[] = [];
    sheet.eachRow((row) => { if (row.getCell(1).value === "指标1") headers.push(row.number); });
    expect(headers).toEqual([2]);
    expect(sheet.getColumn(82).width).toBeCloseTo(24 * (96 / 25.4) / 7, 5);
    expect(sheet.pageSetup.paperSize).toBeUndefined();
    expect(sheet.pageSetup.fitToPage).toBe(false);
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 2, xSplit: 0 });
    expect(sheet.pageSetup.printTitlesRow).toBe("1:2");
  });

  it("A3/A4 仅影响打印设置，Excel 列宽和值不随纸型缩小", async () => {
    const plan = paginateTemplate(wideTemplate(), { detail: wideRows().slice(0, 2) }).plan;
    const natural = (await reread(plan)).workbook.worksheets[0]!;
    for (const [paper, code] of [["a3", 8], ["a4", 9]] as const) {
      const sheet = (await reread(plan, { paperSize: paper })).workbook.worksheets[0]!;
      expect(sheet.pageSetup).toMatchObject({ paperSize: code, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 });
      expect(sheet.getColumn(1).width).toBe(natural.getColumn(1).width);
      expect(sheet.getColumn(82).width).toBe(natural.getColumn(82).width);
      expect(sheet.getCell("CD4").value).toBe(natural.getCell("CD4").value);
    }
  });

  it("显式 pages/text 保持逐页和显示文本，普通纸张模板默认仍按页", async () => {
    const plan = paginateTemplate(wideTemplate(), { detail: wideRows() }).plan;
    const pageSheets = (await reread(plan, { sheetMode: "pages", paperSize: "a4" })).workbook.worksheets;
    expect(pageSheets).toHaveLength(plan.pages.length);
    expect(pageSheets[0]!.getCell("B3").value).toBe(0);
    expect((await reread(plan, { valueMode: "text" })).workbook.worksheets[0]!.getCell("B3").value).toBe("0.000");
    const standard = paginateTemplate(createTableTemplate({ columns: [{ header: "数量", field: "n" }] }), {
      detail: Array.from({ length: 120 }, (_, n) => ({ n }))
    }).plan;
    expect((await reread(standard)).workbook.worksheets).toHaveLength(standard.pages.length);
    const continuous = (await reread(standard, { sheetMode: "continuous" })).workbook.worksheets;
    expect(continuous).toHaveLength(1);
    expect(continuous[0]!.rowCount).toBe(121);
    expect(continuous[0]!.getCell("A121").value).toBe(119);
  });

  it("同名报表、多实例及不同列结构各自独立 Sheet，不按表头或标题误拼", async () => {
    const shared = wideTemplate();
    const other = createTableTemplate({ layout: "wide", title: "炼钢/宽表", columns: [{ header: "指标1", field: "id" }] });
    const source = createReportSource({
      first: { template: shared, datasets: { detail: wideRows().slice(0, 3) } },
      second: { template: shared, datasets: { detail: wideRows().slice(0, 4) } },
      third: { template: other, datasets: { detail: [{ id: "00009" }] } }
    });
    const plan = await source({ reportIds: ["first", "second", "first", "third"], params: {} });
    const sheets = (await reread(plan)).workbook.worksheets;
    expect(sheets.map((sheet) => sheet.name)).toEqual(["炼钢 宽表", "炼钢 宽表 (2)", "炼钢 宽表 (3)", "炼钢 宽表 (4)"]);
    expect(sheets.map((sheet) => sheet.rowCount)).toEqual([5, 6, 5, 3]);
    expect(sheets.map((sheet) => sheet.columnCount)).toEqual([82, 82, 82, 1]);
    expect(sheets[3]!.getCell("A3").value).toBe("00009");
  });

  it("分组、小计、总计顺序和合并保留，跨页组头不会错当重复表头", async () => {
    const template = createTableTemplate({
      layout: "wide",
      columns: [
        { header: "物料", field: "name", widthMm: 30 },
        { header: "批次", field: "lot", widthMm: 30 },
        { header: "数量", field: "qty", widthMm: 30, format: { kind: "number", digits: 2 } }
      ],
      listOptions: { rowHeightMm: 10, groupBy: { field: "warehouse", headerTemplate: "仓库{value}", subtotal: ["qty"] }, grandTotal: true }
    });
    const detail = Array.from({ length: 60 }, (_, index) => ({ name: `物料${index}`, lot: "00001", qty: 1.25, warehouse: index < 35 ? "A" : "B" }));
    const plan = paginateTemplate(template, { detail }).plan;
    expect(plan.pages.length).toBeGreaterThan(1);
    const { workbook } = await reread(plan);
    const sheet = workbook.worksheets[0]!;
    expect(sheet.rowCount).toBe(66);
    expect(sheet.getCell("A2").value).toBe("仓库A");
    expect(sheet.model.merges).toContain("A2:C2");
    expect(sheet.getCell("A38").value).toBe("小计");
    expect(sheet.model.merges).toContain("A38:B38");
    expect(sheet.getCell("C38").value).toBe(43.75);
    expect(sheet.getCell("A39").value).toBe("仓库B");
    expect(sheet.getCell("C65").value).toBe(31.25);
    expect(sheet.getCell("A66").value).toBe("合计");
    expect(sheet.getCell("C66").value).toBe(75);
    expect(sheet.getCell("C66").numFmt).toBe("0.00");
  });

  it("任意矩阵不猜测拼接，wide 混合内容退回按页并给出明确告警", async () => {
    const free: RenderPlan = { schemaVersion: "free", pages: [{ pageWidthMm: 200, pageHeightMm: 300, components: [
      { kind: "rect", leftMm: 0, topMm: 0, widthMm: 80, heightMm: 8, grid: { cells: [[{ text: "自由矩阵" }]] } }
    ] }] };
    await expect(renderPlanToXlsx(free, { sheetMode: "continuous" })).rejects.toThrow("逻辑表来源");
    const mixed = paginateTemplate(wideTemplate(), { detail: wideRows().slice(0, 1) }).plan;
    mixed.pages[0]!.components.push(free.pages[0]!.components[0]!);
    const { workbook, warnings } = await reread(mixed);
    expect(warnings).toEqual([expect.stringContaining("未猜测合并")]);
    expect(workbook.worksheets[0]!.getCell("A4").value).toBe("自由矩阵");
    await expect(renderPlanToXlsx(mixed, { sheetMode: "continuous" })).rejects.toThrow("逻辑表来源");
    const partial = paginateTemplate(wideTemplate(), { detail: wideRows() }).plan;
    partial.pages[1]!.components.push(free.pages[0]!.components[0]!);
    const fallback = await reread(partial);
    expect(fallback.workbook.worksheets).toHaveLength(partial.pages.length);
    expect(fallback.warnings).toHaveLength(partial.pages.length);
    const ids: string[] = [];
    for (const sheet of fallback.workbook.worksheets) sheet.eachRow((row) => {
      const id = row.getCell(1).value;
      if (typeof id === "string" && /^\d{5}$/.test(id)) ids.push(id);
    });
    expect(ids).toHaveLength(120);
    expect(new Set(ids).size).toBe(120);
  });

  it("来源列变化、逻辑行重复和嵌套组件明确拒绝，避免静默数据丢失", async () => {
    const make = () => paginateTemplate(wideTemplate(), { detail: wideRows().slice(0, 2) }).plan;
    const changed = make();
    const secondRow = changed.pages[0]!.components.find((comp) => comp.table?.rowIndex === 1)!;
    secondRow.table = { ...secondRow.table!, columnKeys: ["other", ...secondRow.table!.columnKeys.slice(1)] };
    await expect(renderPlanToXlsx(changed)).rejects.toThrow("列结构或列宽不一致");
    const repeated = make();
    repeated.pages[0]!.components.find((comp) => comp.table?.rowIndex === 1)!.table!.rowIndex = 0;
    await expect(renderPlanToXlsx(repeated)).rejects.toThrow("逻辑行来源不连续或重复");
    const nested = make();
    nested.pages[0]!.components.find((comp) => comp.table?.rowIndex === 0)!.grid!.cells[0]![0]!.children = [
      { kind: "text", leftMm: 0, topMm: 0, widthMm: 10, heightMm: 3, text: "嵌套内容" }
    ];
    await expect(renderPlanToXlsx(nested)).rejects.toThrow("嵌套组件");
    await expect(renderPlanToXlsx(make(), { sheetMode: "wrong" as "auto" })).rejects.toThrow("sheetMode");
  });

  it("超过 Excel 本身的列上限时明确拒绝，不截掉尾部列", async () => {
    const count = 16_385;
    const plan: RenderPlan = { schemaVersion: "limits", pages: [{
      layout: "wide", pageWidthMm: count, pageHeightMm: 20, components: [{
        kind: "rect", leftMm: 0, topMm: 0, widthMm: count, heightMm: 5,
        table: { id: "limit", role: "header", rowIndex: -1, layout: "wide", columnKeys: Array.from({ length: count }, (_, index) => `c${index}`) },
        grid: { cells: [[{ text: "列数超限" }]], colWidthsMm: Array.from({ length: count }, () => 1), rowHeightsMm: [5] }
      }]
    }] };
    await expect(renderPlanToXlsx(plan)).rejects.toThrow("16384 列");
  });
});

describe("Excel 原生内容与尺寸边界", () => {
  function cellPlan(text: string, value?: string | number): RenderPlan {
    return { schemaVersion: "limits", pages: [{ pageWidthMm: 210, pageHeightMm: 297, components: [{
      kind: "rect", leftMm: 0, topMm: 0, widthMm: 40, heightMm: 8,
      grid: { cells: [[{ text, ...(value === undefined ? {} : { value }) }]], colWidthsMm: [40], rowHeightsMm: [8] }
    }] }] };
  }

  it("32767 字符和 253 换行的边界值真实回读不丢内容，超限明确拒绝", async () => {
    const maxText = "字".repeat(32_767);
    expect((await reread(cellPlan(maxText))).workbook.worksheets[0]!.getCell("A1").value).toBe(maxText);
    await expect(renderPlanToXlsx(cellPlan(maxText + "字"))).rejects.toThrow("32767 个字符");
    const maxLines = Array.from({ length: 254 }, () => "行").join("\n");
    expect((await reread(cellPlan(maxLines))).workbook.worksheets[0]!.getCell("A1").value).toBe(maxLines);
    await expect(renderPlanToXlsx(cellPlan(maxLines + "\n行"))).rejects.toThrow("253 个换行");
  });

  it("按最终 raw/text 值检查，不因数值的长显示文本误拒绝", async () => {
    const long = "长".repeat(40_000);
    const numeric = await reread(cellPlan(long, 12.5), { valueMode: "raw" });
    expect(numeric.workbook.worksheets[0]!.getCell("A1").value).toBe(12.5);
    await expect(renderPlanToXlsx(cellPlan(long, 12.5), { valueMode: "text" })).rejects.toThrow("32767 个字符");
    expect((await reread(cellPlan("短显示", long), { valueMode: "text" })).workbook.worksheets[0]!.getCell("A1").value).toBe("短显示");
    await expect(renderPlanToXlsx(cellPlan("短显示", long), { valueMode: "raw" })).rejects.toThrow("32767 个字符");
    await expect(renderPlanToXlsx(cellPlan(long, Infinity), { valueMode: "raw" })).rejects.toThrow("32767 个字符");
    await expect(renderPlanToXlsx(cellPlan("短显示", "行\n".repeat(254)), { valueMode: "raw" })).rejects.toThrow("253 个换行");
  });

  it("合并标题和 lines 拼接结果同样受原生字符串上限保护", async () => {
    const make = (text: string): RenderPlan => {
      const plan = cellPlan("表头");
      plan.pages[0]!.components[0]!.grid!.colWidthsMm = [20, 20];
      plan.pages[0]!.components.unshift({ kind: "text", leftMm: 0, topMm: 0, widthMm: 40, heightMm: 8, text });
      return plan;
    };
    const title = "题".repeat(32_767);
    const sheet = (await reread(make(title))).workbook.worksheets[0]!;
    expect(sheet.model.merges).toContain("A1:B1");
    expect(sheet.getCell("A1").value).toBe(title);
    await expect(renderPlanToXlsx(make(title + "题"))).rejects.toThrow("32767 个字符");
    const lines = make("占位");
    lines.pages[0]!.components[0]!.lines = Array.from({ length: 255 }, () => "行");
    await expect(renderPlanToXlsx(lines)).rejects.toThrow("253 个换行");
  });

  it("超宽列与超高行按 Excel 上限收敛，各告警一次且完整保留标题和数据", async () => {
    const text = "完整数据".repeat(1_000);
    const plan: RenderPlan = { schemaVersion: "limits", pages: [{ pageWidthMm: 1220, pageHeightMm: 800, components: [
      { kind: "text", leftMm: 0, topMm: 0, widthMm: 1200, heightMm: 200, text: "完整标题" },
      { kind: "rect", leftMm: 0, topMm: 210, widthMm: 1200, heightMm: 420, grid: {
        cells: [[{ text }, { text: "第二列" }], [{ text: "第三行" }, { text }]], colWidthsMm: [600, 600], rowHeightsMm: [200, 220]
      } }
    ] }] };
    const { workbook, warnings } = await reread(plan, { paperSize: "a3" });
    const sheet = workbook.worksheets[0]!;
    expect(sheet.getColumn(1).width).toBe(255);
    expect(sheet.getColumn(2).width).toBe(255);
    expect([1, 2, 3].map((row) => sheet.getRow(row).height)).toEqual([409, 409, 409]);
    expect(warnings).toHaveLength(2);
    expect(warnings).toEqual(expect.arrayContaining([expect.stringContaining("255 字符"), expect.stringContaining("409pt")]));
    expect(sheet.getCell("A1").value).toBe("完整标题");
    expect(sheet.getCell("A2").value).toBe(text);
    expect(sheet.getCell("B3").value).toBe(text);
    const plain = await reread({ schemaVersion: "text", pages: [{ pageWidthMm: 1200, pageHeightMm: 600, components: [
      { kind: "text", leftMm: 0, topMm: 0, widthMm: 1200, heightMm: 500, text }
    ] }] }, { paperSize: "a4" });
    expect(plain.workbook.worksheets[0]!.getColumn(1).width).toBe(255);
    expect(plain.workbook.worksheets[0]!.getRow(1).height).toBe(409);
    expect(plain.workbook.worksheets[0]!.getCell("A1").value).toBe(text);
    expect(plain.warnings).toHaveLength(2);
  });
});
