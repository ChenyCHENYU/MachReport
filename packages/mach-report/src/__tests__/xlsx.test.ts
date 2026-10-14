// @vitest-environment node
import { describe, expect, it } from "vitest";
import { renderPlanToXlsx } from "../xlsx";
import { paginateTemplate } from "../layout/paginate";
import type { RenderPlan } from "../schema/render-plan";

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

  it("图片等不支持组件计入保真告警", async () => {
    const plan: RenderPlan = {
      schemaVersion: "t",
      pages: [
        {
          pageWidthMm: 210,
          pageHeightMm: 297,
          components: [
            { kind: "image", leftMm: 10, topMm: 10, widthMm: 20, heightMm: 20, imageData: "data:image/png;base64,x" }
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
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toContain("rich-only: 富文本内容");
    expect(warnings[1]).toContain("nested-grid cell 1:1: 嵌套组件内容");
    expect(warnings[2]).toContain("nested-grid cell 1:2: 嵌套组件内容");
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
    expect(sheet.getColumn(1).width).toBeCloseTo(140 * (96 / 25.4) / 7);
    expect(sheet.getCell("A1").value).toBe("标题");
    expect(sheet.getCell("A2").value).toBe("正文");
  });
});
