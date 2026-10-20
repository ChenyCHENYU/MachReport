// @vitest-environment node
import { describe, expect, it } from "vitest";
import { renderPlanToXlsx } from "../xlsx";
import { paginateTemplate } from "../layout/paginate";
import type { RenderPlan } from "../schema/render-plan";
import ExcelJSRuntime from "exceljs";
import { createTableTemplate } from "../builder/table-template";

/** 构造带分组小计的出库单式计划（复用语义层能力） */
function buildPlan(): RenderPlan {
  const { plan } = paginateTemplate(
    {
      pages: [
        {
          widthMm: 210,
          heightMm: 297,
          components: [
            { kind: "text", leftMm: 70, topMm: 5, widthMm: 70, heightMm: 8, text: "出库单明细", style: { fontSize: 16, bold: true, align: "center" } },
            {
              kind: "list" as const,
              leftMm: 12,
              topMm: 20,
              widthMm: 186,
              dataset: "detail",
              columns: [
                { header: "物料", field: "name", widthMm: 106 },
                { header: "数量", field: "qty", widthMm: 40, format: { kind: "number" as const, thousands: true } },
                { header: "金额", field: "amount", widthMm: 40, format: { kind: "number" as const, thousands: true, digits: 2 } }
              ],
              groupBy: { field: "wh", headerTemplate: "仓库：{value}", subtotal: ["qty", "amount"] },
              grandTotal: true
            }
          ]
        }
      ]
    },
    {
      detail: [
        { name: "螺纹钢", wh: "1号库", qty: 10, amount: 100 },
        { name: "热轧卷", wh: "1号库", qty: 5, amount: 50.5 },
        { name: "冷轧板", wh: "2号库", qty: 8, amount: 80 }
      ]
    }
  );
  return plan;
}

describe("renderPlanToXlsx（./xlsx 子路径）", () => {
  it("真实回读保留被 rowSpan 覆盖的空白行高度", async () => {
    const plan: RenderPlan = { schemaVersion: "rowspan-height", pages: [{ pageWidthMm: 210, pageHeightMm: 297, components: [{
      kind: "rect", leftMm: 10, topMm: 10, widthMm: 80, heightMm: 30,
      grid: { cells: [[{ text: "merged", rowSpan: 2 }], []], colWidthsMm: [80], rowHeightsMm: [10, 20] }
    }] }] };
    const { buffer } = await renderPlanToXlsx(plan);
    const workbook = new ExcelJSRuntime.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0]!;
    expect(sheet.model.merges).toEqual(["A1:A2"]);
    expect(sheet.getRow(1).height).toBeCloseTo(10 * 72 / 25.4);
    expect(sheet.getRow(2).height).toBeCloseTo(20 * 72 / 25.4);
  });

  it("纯文本标题回读保留多行、底色和显式垂直对齐", async () => {
    const plan: RenderPlan = { schemaVersion: "title-style", pages: [{ pageWidthMm: 210, pageHeightMm: 297, components: [{
      kind: "text", leftMm: 10, topMm: 10, widthMm: 100, heightMm: 20,
      lines: ["first", "second"], style: { verticalAlign: "bottom", backgroundColor: "#123456", fontSize: 14 }
    }] }] };
    const { buffer } = await renderPlanToXlsx(plan);
    const workbook = new ExcelJSRuntime.Workbook();
    await workbook.xlsx.load(buffer);
    const cell = workbook.worksheets[0]!.getCell("A1");
    expect(cell.value).toBe("first\nsecond");
    expect(cell.alignment).toMatchObject({ vertical: "bottom", wrapText: true });
    expect(cell.fill).toEqual({ type: "pattern", pattern: "solid", fgColor: { argb: "FF123456" } });
    expect(cell.font.size).toBe(14);
  });

  it("网格单元格 pt 字号覆盖组件 px 字号并保留继承颜色", async () => {
    const plan: RenderPlan = { schemaVersion: "font-override", pages: [{ pageWidthMm: 210, pageHeightMm: 297, components: [{
      kind: "rect", leftMm: 10, topMm: 10, widthMm: 80, heightMm: 20,
      style: { fontSizePx: 24, color: "#123456" }, grid: { cells: [[{ text: "override", style: { fontSize: 12 } }]] }
    }] }] };
    const { buffer } = await renderPlanToXlsx(plan);
    const workbook = new ExcelJSRuntime.Workbook();
    await workbook.xlsx.load(buffer);
    expect(workbook.worksheets[0]!.getCell("A1").font).toMatchObject({ size: 12, color: { argb: "FF123456" } });
  });

  it("raw 模式经真实工作簿回读保留数值、空值、布尔、文本炉号和百分比格式", async () => {
    const template = createTableTemplate({ columns: [
      { header: "炉号", field: "id" },
      { header: "重量", field: "weight", format: { kind: "number", digits: 3 } },
      { header: "产率", field: "yield", format: { kind: "percent", digits: 2 } },
      { header: "确认", field: "confirmed" }
    ] });
    const plan = paginateTemplate(template, { detail: [
      { id: "00120", weight: 0, yield: 0.899, confirmed: false },
      { id: "=SUM(A1:A2)", weight: null, yield: null, confirmed: true }
    ] }).plan;
    const { buffer } = await renderPlanToXlsx(plan, { valueMode: "raw" });
    const workbook = new ExcelJSRuntime.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0]!;
    expect(sheet.getCell("A2").value).toBe("00120");
    expect(sheet.getCell("B2").value).toBe(0);
    expect(sheet.getCell("B2").numFmt).toBe("0.000");
    expect(sheet.getCell("C2").value).toBe(0.899);
    expect(sheet.getCell("C2").numFmt).toBe("0.00%");
    expect(sheet.getCell("D2").value).toBe(false);
    expect(sheet.getCell("A3").value).toBe("=SUM(A1:A2)");
    expect(sheet.getCell("A3").type).toBe(ExcelJSRuntime.ValueType.String);
    expect(sheet.getCell("B3").value).toBeNull();
    expect(sheet.getCell("C3").value).toBeNull();
    expect(sheet.getCell("D3").value).toBe(true);
  });

  it("raw 模式的小计与总计保留真实数值，没有元数据的旧计划仍写显示文本", async () => {
    const { workbook } = await renderPlanToXlsx(buildPlan(), { valueMode: "raw" });
    const sheet = workbook.worksheets[0]!;
    const amounts: number[] = [];
    sheet.eachRow((row) => { if (typeof row.getCell(3).value === "number") amounts.push(row.getCell(3).value as number); });
    expect(amounts).toContain(50.5);
    expect(amounts).toContain(150.5);
    expect(amounts).toContain(230.5);
    const oldPlan: RenderPlan = { schemaVersion: "old", pages: [{ pageWidthMm: 210, pageHeightMm: 297, components: [
      { kind: "rect", leftMm: 0, topMm: 0, widthMm: 40, heightMm: 5, grid: { cells: [[{ text: "00123" }]] } }
    ] }] };
    expect((await renderPlanToXlsx(oldPlan, { valueMode: "raw" })).workbook.worksheets[0]!.getCell("A1").value).toBe("00123");
  });

  it("按真实页面自动识别横向A3与A5，允许显式纸型并说明自定义纸张回退", async () => {
    const plan: RenderPlan = { schemaVersion: "paper", pages: [
      { pageWidthMm: 420, pageHeightMm: 297, components: [] },
      { pageWidthMm: 148, pageHeightMm: 210, components: [] },
      { pageWidthMm: 300, pageHeightMm: 500, components: [] }
    ] };
    const { workbook, warnings } = await renderPlanToXlsx(plan);
    expect(workbook.worksheets.map((sheet) => sheet.pageSetup.paperSize)).toEqual([8, 11, 9]);
    expect(workbook.worksheets[0]!.pageSetup.orientation).toBe("landscape");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("自定义纸张");
    const forced = await renderPlanToXlsx(plan, { paperSize: "a4" });
    expect(forced.workbook.worksheets.every((sheet) => sheet.pageSetup.paperSize === 9)).toBe(true);
    expect(forced.warnings).toEqual([]);
  });

  it("单元格样式覆盖组件样式，保留垂直对齐、换行和显式非加粗", async () => {
    const plan: RenderPlan = { schemaVersion: "style", pages: [{ pageWidthMm: 210, pageHeightMm: 297, components: [
      { kind: "rect", leftMm: 0, topMm: 0, widthMm: 80, heightMm: 10,
        style: { align: "right", verticalAlign: "bottom", bold: true, italic: true, color: "#123456" },
        grid: { cells: [[{ text: "继承" }, { text: "覆盖\n换行", style: { align: "center", verticalAlign: "top", bold: false } }]] }
      }
    ] }] };
    const sheet = (await renderPlanToXlsx(plan)).workbook.worksheets[0]!;
    expect(sheet.getCell("A1").alignment).toMatchObject({ horizontal: "right", vertical: "bottom", wrapText: true });
    expect(sheet.getCell("A1").font).toMatchObject({ bold: true, italic: true, color: { argb: "FF123456" } });
    expect(sheet.getCell("B1").alignment).toMatchObject({ horizontal: "center", vertical: "top", wrapText: true });
    expect(sheet.getCell("B1").font.bold).toBe(false);
  });

  it("拒绝未知导出配置；无效原始值回退显示文本且返回告警", async () => {
    const plan = buildPlan();
    await expect(renderPlanToXlsx(plan, { valueMode: "invalid" as "raw" })).rejects.toThrow("valueMode");
    await expect(renderPlanToXlsx(plan, { paperSize: "invalid" as "auto" })).rejects.toThrow("paperSize");
    const bad: RenderPlan = { schemaVersion: "raw", pages: [{ pageWidthMm: 210, pageHeightMm: 297, components: [
      { kind: "rect", leftMm: 0, topMm: 0, widthMm: 40, heightMm: 5, grid: { cells: [[{ text: "不可用", value: Infinity }]] } }
    ] }] };
    const result = await renderPlanToXlsx(bad, { valueMode: "raw" });
    expect(result.workbook.worksheets[0]!.getCell("A1").value).toBe("不可用");
    expect(result.warnings).toHaveLength(1);
  });

  it("像素字号优先级与其它出口一致，无边框配置和单边颜色可保留", async () => {
    const template = createTableTemplate({ columns: [
      { header: "名称", field: "name", style: { fontSizePx: 16, fontSize: 20 } }
    ], listOptions: { border: false } });
    const plan = paginateTemplate(template, { detail: [{ name: "无边框" }] }).plan;
    const sheet = (await renderPlanToXlsx(plan)).workbook.worksheets[0]!;
    expect(sheet.getCell("A2").font.size).toBe(12);
    expect(sheet.getCell("A2").border).toEqual({});
    const component = plan.pages[0]!.components.find((comp) => comp.grid?.cells[0]?.[0]?.text === "无边框")!;
    component.grid!.cells[0]![0]!.style = { ...component.grid!.cells[0]![0]!.style, borderBottom: true, borderColor: "#123456" };
    const next = (await renderPlanToXlsx(plan)).workbook.worksheets[0]!.getCell("A2");
    expect(next.border).toEqual({ bottom: { style: "thin", color: { argb: "FF123456" } } });
  });

  it("产出合法 xlsx（PK zip 头）且工作表/单元格/合并正确", async () => {
    const plan = buildPlan();
    const { workbook, buffer, warnings } = await renderPlanToXlsx(plan);
    const bytes = new Uint8Array(buffer as ArrayBuffer);
    // xlsx = zip：魔数 PK\x03\x04
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(warnings).toEqual([]);

    const sheet = workbook.worksheets[0]!;
    expect(sheet.name).toBe("Sheet1");
    const texts: string[] = [];
    sheet.eachRow((row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (typeof cell.value === "string") texts.push(cell.value);
      });
    });
    expect(texts).toContain("出库单明细");
    expect(texts).toContain("物料");
    expect(texts).toContain("50.50");  // 金额列 digits:2 走列格式化
    expect(texts).toContain("仓库：1号库");
    expect(texts).toContain("小计");
    expect(texts).toContain("合计");
    expect(texts).toContain("230.50"); // 总金额合计（digits:2）
    // 标题合并单元格存在
    expect(sheet.model.merges?.length).toBeGreaterThan(0);
  });

  it("SVG等不支持图片格式计入保真告警", async () => {
    const plan: RenderPlan = {
      schemaVersion: "t",
      pages: [
        {
          pageWidthMm: 210,
          pageHeightMm: 297,
          components: [
            { kind: "image", leftMm: 10, topMm: 10, widthMm: 20, heightMm: 20, imageData: "data:image/svg+xml,%3Csvg/%3E" }
          ]
        }
      ]
    };
    const { warnings } = await renderPlanToXlsx(plan);
    expect(warnings.some((w) => w.includes("已跳过"))).toBe(true);
  });

  it("没有文本回退的富文本与未导出的嵌套组件计入告警，保留已有文本", async () => {
    const plan: RenderPlan = {
      schemaVersion: "t",
      pages: [{
        pageWidthMm: 210,
        pageHeightMm: 297,
        components: [
          {
            kind: "text", nid: "rich-only", leftMm: 0, topMm: 0, widthMm: 80, heightMm: 8,
            richParagraphs: [{ segments: [{ text: "富文本专有内容" }] }]
          },
          {
            kind: "text", nid: "rich-fallback", leftMm: 0, topMm: 10, widthMm: 80, heightMm: 8,
            text: "已有文本回退", richParagraphs: [{ segments: [{ text: "富文本" }] }]
          },
          {
            kind: "rect", nid: "nested-grid", leftMm: 0, topMm: 20, widthMm: 80, heightMm: 8,
            grid: { cells: [[
              { children: [{ kind: "text", leftMm: 0, topMm: 0, widthMm: 40, heightMm: 8, text: "子组件" }] },
              { text: "单元格已有文本", children: [{ kind: "image", leftMm: 0, topMm: 0, widthMm: 40, heightMm: 8 }] }
            ]] }
          }
        ]
      }]
    };
    const { workbook, warnings } = await renderPlanToXlsx(plan);
    expect(warnings).toHaveLength(4);
    expect(warnings[0]).toContain("rich-only: 富文本内容");
    expect(warnings[1]).toContain("rich-fallback: 富文本按已有文本回退导出");
    expect(warnings[2]).toContain("nested-grid cell 1:1: 嵌套组件内容");
    expect(warnings[3]).toContain("nested-grid cell 1:2: 嵌套组件内容");
    const sheet = workbook.worksheets[0]!;
    expect(sheet.getCell("A1").value).toBe("");
    expect(sheet.getCell("A2").value).toBe("已有文本回退");
    expect(sheet.getCell("A3").value).toBe("");
    expect(sheet.getCell("B3").value).toBe("单元格已有文本");
  });

  it("无网格的线与形状组件均告警，不影响普通文本导出", async () => {
    const plan: RenderPlan = {
      schemaVersion: "t",
      pages: [{
        pageWidthMm: 210,
        pageHeightMm: 297,
        components: [
          ...(["line", "rect", "ellipse"] as const).map((kind) => ({
            kind, leftMm: 0, topMm: 0, widthMm: 80, heightMm: 8
          })),
          { kind: "text", leftMm: 0, topMm: 10, widthMm: 80, heightMm: 8, text: "正文" }
        ]
      }]
    };
    const { workbook, warnings } = await renderPlanToXlsx(plan);
    expect(warnings).toHaveLength(3);
    for (const kind of ["line", "rect", "ellipse"]) {
      expect(warnings.some((warning) => warning.includes(`组件类型 ${kind}`))).toBe(true);
    }
    expect(workbook.worksheets[0]!.getCell("A1").value).toBe("正文");
  });

  it("越界合并收敛到当前网格，不占用后续文本行", async () => {
    const plan: RenderPlan = {
      schemaVersion: "t",
      pages: [{
        pageWidthMm: 210,
        pageHeightMm: 297,
        components: [
          {
            kind: "rect", leftMm: 0, topMm: 0, widthMm: 80, heightMm: 10,
            grid: {
              cells: [[{ text: "网格内容", colSpan: 99, rowSpan: 99 }], []],
              colWidthsMm: [40, 40],
              rowHeightsMm: [5, 5]
            }
          },
          { kind: "text", leftMm: 0, topMm: 10, widthMm: 80, heightMm: 8, text: "后续标题" }
        ]
      }]
    };
    const { workbook } = await renderPlanToXlsx(plan);
    const sheet = workbook.worksheets[0]!;
    expect(sheet.model.merges).toEqual(["A1:B2", "A3:B3"]);
    expect(sheet.getCell("A1").value).toBe("网格内容");
    expect(sheet.getCell("A3").value).toBe("后续标题");
    expect(sheet.columnCount).toBe(2);
    expect(sheet.rowCount).toBe(3);
  });

  it("标题只合并真实网格列，不因毫米宽度生成空白列", async () => {
    const plan: RenderPlan = {
      schemaVersion: "t",
      pages: [{
        pageWidthMm: 210,
        pageHeightMm: 297,
        components: [
          { kind: "text", leftMm: 70, topMm: 5, widthMm: 70, heightMm: 8, text: "三列报表" },
          {
            kind: "rect", leftMm: 12, topMm: 20, widthMm: 186, heightMm: 8,
            grid: { cells: [[{ text: "名称" }, { text: "数量" }, { text: "金额" }]], colWidthsMm: [106, 40, 40] }
          }
        ]
      }]
    };
    const { workbook } = await renderPlanToXlsx(plan);
    const sheet = workbook.worksheets[0]!;
    expect(sheet.model.merges).toEqual(["A1:C1"]);
    expect(sheet.columnCount).toBe(3);
    expect(sheet.getCell("C2").value).toBe("金额");
  });

  it("纯文本报表使用单列，并按文本组件宽度设置列宽", async () => {
    const plan: RenderPlan = {
      schemaVersion: "t",
      pages: [{
        pageWidthMm: 210,
        pageHeightMm: 297,
        components: [
          { kind: "text", leftMm: 0, topMm: 0, widthMm: 70, heightMm: 8, text: "标题" },
          { kind: "text", leftMm: 0, topMm: 10, widthMm: 140, heightMm: 8, text: "正文" }
        ]
      }]
    };
    const { workbook } = await renderPlanToXlsx(plan);
    const sheet = workbook.worksheets[0]!;
    expect(sheet.columnCount).toBe(1);
    expect(sheet.model.merges).toEqual([]);
    expect(sheet.getColumn(1).width).toBeCloseTo((140 * (96 / 25.4) - 5) / 7);
    expect(sheet.getCell("A1").value).toBe("标题");
    expect(sheet.getCell("A2").value).toBe("正文");
  });
});
