import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderPlanToPdf } from "../render-pdf";
import { paginateTemplate, createTemplate } from "@mach-report/core";
import type { RenderPlan } from "@mach-report/core";

function planFixture(): RenderPlan {
  const template = createTemplate()
    .page(210, 297, { marginTopMm: 12 })
    .text("Delivery Note 2026-09-17", { leftMm: 50, topMm: 4, widthMm: 110 }, { fontSize: 14, bold: true })
    .line(12, 20, 186)
    .list(
      "detail",
      { leftMm: 12, topMm: 24, widthMm: 186 },
      [
        { header: "No", field: "no", widthMm: 30 },
        { header: "Item", field: "item", widthMm: 100 },
        { header: "Qty", field: "qty", widthMm: 56 }
      ]
    )
    .build();
  return paginateTemplate(template, {
    detail: Array.from({ length: 60 }, (_, i) => ({
      no: String(i + 1),
      item: `Steel Billet ${i + 1}`,
      qty: String((i + 1) * 3)
    }))
  }).plan;
}

const SIMHEI = "C:\\Windows\\Fonts\\simhei.ttf";

describe("renderPlanToPdf", () => {
  it("生成合法 PDF 字节流（%PDF 头 + 页数正确）", async () => {
    const { bytes, pageErrors, pdfDoc } = await renderPlanToPdf(planFixture());
    const header = new TextDecoder().decode(bytes.slice(0, 5));
    expect(header).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1000);
    expect(pdfDoc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(pageErrors).toEqual([]);
  });

  it("页尺寸 mm→pt 换算正确（A4 = 595.28 x 841.89pt）", async () => {
    const plan: RenderPlan = {
      schemaVersion: "t",
      pages: [{ pageWidthMm: 210, pageHeightMm: 297, components: [] }]
    };
    const { pdfDoc } = await renderPlanToPdf(plan);
    const size = pdfDoc.getPage(0)!.getSize();
    expect(size.width).toBeCloseTo(595.28, 1);
    expect(size.height).toBeCloseTo(841.89, 1);
  });

  it("中文字体嵌入后无 unsupported 文本", async () => {
    if (!existsSync(SIMHEI)) {
      console.warn("skip: simhei.ttf not found");
      return;
    }
    const fontBytes = readFileSync(SIMHEI);
    const template = createTemplate()
      .page()
      .text("钢铁冶炼浇注工艺卡", { leftMm: 50, topMm: 5, widthMm: 110 }, { fontSize: 14 })
      .list(
        "步骤",
        { leftMm: 12, topMm: 20, widthMm: 186 },
        [
          { header: "工序", field: "s", widthMm: 60 },
          { header: "参数", field: "p", widthMm: 126 }
        ]
      )
      .build();
    const plan = paginateTemplate(template, {
      步骤: [
        { s: "进站温度", p: "1556 摄氏度" },
        { s: "白渣保持", p: "18 分钟" }
      ]
    }).plan;
    const { bytes, unsupportedTextCount } = await renderPlanToPdf(plan, {
      customFontBytes: fontBytes
    });
    expect(unsupportedTextCount).toBe(0);
    expect(bytes.length).toBeGreaterThan(2000);
  });

  it("无嵌入字体时中文计入 unsupported（不崩溃）", async () => {
    const plan: RenderPlan = {
      schemaVersion: "t",
      pages: [
        {
          pageWidthMm: 210,
          pageHeightMm: 297,
          components: [
            { kind: "text", leftMm: 10, topMm: 10, widthMm: 80, heightMm: 8, text: "中文标题" }
          ]
        }
      ]
    };
    const { unsupportedTextCount, bytes } = await renderPlanToPdf(plan);
    expect(unsupportedTextCount).toBeGreaterThan(0);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });
});
