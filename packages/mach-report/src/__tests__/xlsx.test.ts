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
});
