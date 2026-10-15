// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFFont, PDFPage } from "pdf-lib";
import { renderPlanToPdf } from "../render-pdf";
import { paginateTemplate, createTemplate } from "@agile-team/mach-report";
import type { RenderPlan } from "@agile-team/mach-report";

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

const DEMO_FONT = readFileSync(new URL("../../../../../examples/minimal/public/fonts/mach-report-demo.otf", import.meta.url));

function textPlan(lines: string[]): RenderPlan {
  return {
    schemaVersion: "font-coverage",
    pages: [{
      pageWidthMm: 210,
      pageHeightMm: 297,
      components: [{ kind: "text", leftMm: 10, topMm: 10, widthMm: 180, heightMm: 100, lines }]
    }]
  };
}

function multilineTablePlan(fontSizePt: number, lineCount: number): RenderPlan {
  const template = createTemplate().page().list(
    "detail", { leftMm: 10, topMm: 10, widthMm: 100 },
    [{ header: "Value", field: "value", widthMm: 100 }],
    { fontSizePt, paddingMm: 1 }
  ).build();
  return paginateTemplate(template, {
    detail: [{ value: Array.from({ length: lineCount }, (_, index) => `line-${index + 1}`).join("\n") }]
  }).plan;
}

const MULTILINE_CASES = [10, 10.5].flatMap((font) => [2, 3, 4, 5].map((lines) => [font, lines] as const));

describe("renderPlanToPdf", () => {
  it.each(MULTILINE_CASES)("真实分页的 %spt/%s 行精确高度保留末行，无浮点误裁告警", async (font, count) => {
    const drawText = vi.spyOn(PDFPage.prototype, "drawText");
    try {
      const result = await renderPlanToPdf(multilineTablePlan(font, count));
      const bodyLines = drawText.mock.calls.map(([text]) => text).filter((text) => text.startsWith("line-"));
      expect(bodyLines).toEqual(Array.from({ length: count }, (_, index) => `line-${index + 1}`));
      expect(result.fidelityWarnings.filter((warning) => warning.includes("文本裁切"))).toEqual([]);
    } finally { drawText.mockRestore(); }
  });

  it.each(MULTILINE_CASES)("真实分页的 %spt/%s 行高度不足 0.02pt 仍明确告警", async (font, count) => {
    const plan = multilineTablePlan(font, count);
    const body = plan.pages[0]!.components.find((component) => component.table?.role === "body")!;
    body.heightMm -= 0.02 * 25.4 / 72;
    body.grid!.rowHeightsMm = [body.heightMm];
    const result = await renderPlanToPdf(plan);
    expect(result.fidelityWarnings.some((warning) => warning.includes("文本裁切"))).toBe(true);
  });

  it("网格继承组件字号、行高与垂直对齐，关闭的单边不会被外框重画", async () => {
    const text = vi.spyOn(PDFPage.prototype, "drawText");
    const rectangle = vi.spyOn(PDFPage.prototype, "drawRectangle");
    const line = vi.spyOn(PDFPage.prototype, "drawLine");
    try {
      const plan: RenderPlan = { schemaVersion: "style", pages: [{ pageWidthMm: 210, pageHeightMm: 297, components: [{
        kind: "rect", leftMm: 10, topMm: 10, widthMm: 100, heightMm: 40,
        style: { fontSize: 18, lineHeight: 1.8, verticalAlign: "bottom", borderTop: false },
        grid: { cells: [[{ text: "first\nsecond" }]] }
      }] }] };
      const result = await renderPlanToPdf(plan);
      expect(result.pageErrors).toEqual([]);
      expect(text.mock.calls.map(([value]) => value)).toEqual(["first", "second"]);
      const first = text.mock.calls[0]![1]!;
      const second = text.mock.calls[1]![1]!;
      expect(first.size).toBe(18);
      expect(first.y! - second.y!).toBeCloseTo(18 * 1.8);
      expect(second.y).toBeCloseTo((297 - 50 + 0.5) * 72 / 25.4 + 18 * 0.8);
      expect(rectangle).not.toHaveBeenCalled();
      expect(line).toHaveBeenCalledTimes(3);
    } finally {
      text.mockRestore(); rectangle.mockRestore(); line.mockRestore();
    }
  });

  it("超高网格文本裁切及嵌套组件有明确保真告警，不会静默省略", async () => {
    const plan: RenderPlan = { schemaVersion: "overflow", pages: [{ pageWidthMm: 210, pageHeightMm: 297, components: [{
      kind: "rect", nid: "overflow-grid", leftMm: 10, topMm: 10, widthMm: 20, heightMm: 5,
      grid: { cells: [[{ text: "first\nsecond\nthird", children: [{ kind: "text", leftMm: 0, topMm: 0, widthMm: 10, heightMm: 5, text: "nested" }] }]] }
    }] }] };
    const result = await renderPlanToPdf(plan);
    expect(result.fidelityWarnings.some((warning) => warning.includes("文本") && warning.includes("裁切"))).toBe(true);
    expect(result.fidelityWarnings.some((warning) => warning.includes("嵌套组件"))).toBe(true);
  });

  it("内置粗斜体选择真实字体，下划线实际绘制；自定义字体限制明确返回", async () => {
    const drawText = vi.spyOn(PDFPage.prototype, "drawText");
    const drawLine = vi.spyOn(PDFPage.prototype, "drawLine");
    try {
      const plan = textPlan(["Styled"]);
      plan.pages[0]!.components[0]!.style = { bold: true, italic: true, underline: true };
      const regular = await renderPlanToPdf(plan);
      expect(drawText.mock.calls[0]![1]!.font!.name).toBe("Helvetica-BoldOblique");
      expect(drawLine).toHaveBeenCalledTimes(1);
      expect(regular.fidelityWarnings).toEqual([]);
      const custom = await renderPlanToPdf(plan, { customFontBytes: DEMO_FONT });
      expect(custom.fidelityWarnings.some((warning) => warning.includes("单个字面"))).toBe(true);
    } finally { drawText.mockRestore(); drawLine.mockRestore(); }
  });

  it("网格单元格显式 pt 字号覆盖组件 px 字号", async () => {
    const drawText = vi.spyOn(PDFPage.prototype, "drawText");
    try {
      const plan: RenderPlan = { schemaVersion: "font-override", pages: [{ pageWidthMm: 210, pageHeightMm: 297, components: [{
        kind: "rect", leftMm: 10, topMm: 10, widthMm: 100, heightMm: 20, style: { fontSizePx: 24 },
        grid: { cells: [[{ text: "override", style: { fontSize: 12 } }]] }
      }] }] };
      await renderPlanToPdf(plan);
      expect(drawText.mock.calls[0]![1]!.size).toBe(12);
    } finally { drawText.mockRestore(); }
  });

  it("网格 CRLF/CR 换行不会插入多余空行或遗漏文本", async () => {
    const drawText = vi.spyOn(PDFPage.prototype, "drawText");
    try {
      const plan: RenderPlan = { schemaVersion: "newlines", pages: [{ pageWidthMm: 210, pageHeightMm: 297, components: [{
        kind: "rect", leftMm: 10, topMm: 10, widthMm: 100, heightMm: 40,
        grid: { cells: [[{ text: "first\r\nsecond\rthird" }]] }
      }] }] };
      await renderPlanToPdf(plan);
      expect(drawText.mock.calls.map(([text]) => text)).toEqual(["first", "second", "third"]);
      const positions = drawText.mock.calls.map(([, options]) => options!.y!);
      expect(positions[0]! - positions[1]!).toBeCloseTo(positions[1]! - positions[2]!);
    } finally { drawText.mockRestore(); }
  });

  it("超过常规阅读器页面尺寸时返回告警，仍保留原始页面几何", async () => {
    const plan: RenderPlan = { schemaVersion: "wide-pdf", pages: [{ pageWidthMm: 6000, pageHeightMm: 297, components: [] }] };
    const result = await renderPlanToPdf(plan);
    const decoded = await PDFDocument.load(result.bytes);
    expect(decoded.getPage(0).getWidth()).toBeCloseTo(6000 * 72 / 25.4);
    expect(result.fidelityWarnings.some((warning) => warning.includes("200 英寸"))).toBe(true);
  });

  it("生成合法 PDF 字节流（%PDF 头 + 页数正确）", async () => {
    const { bytes, pageErrors, pdfDoc } = await renderPlanToPdf(planFixture());
    const header = new TextDecoder().decode(bytes.slice(0, 5));
    expect(header).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1000);
    await expect(pdfDoc.save()).resolves.toBeDefined();
    expect(pageErrors).toEqual([]);
  });

  it("页尺寸 mm→pt 换算正确（A4 = 595.28 x 841.89pt）", async () => {
    const plan: RenderPlan = {
      schemaVersion: "t",
      pages: [{ pageWidthMm: 210, pageHeightMm: 297, components: [] }]
    };
    const { bytes } = await renderPlanToPdf(plan);
    const decoded = await PDFDocument.load(bytes);
    expect(decoded.getPageCount()).toBe(1);
    expect(decoded.getPage(0).getWidth()).toBeCloseTo(595.2756, 3);
    expect(decoded.getPage(0).getHeight()).toBeCloseTo(841.8898, 3);
  });

  it("真实 demo OTF 嵌入后支持其覆盖的中文（测试不依赖系统字体）", async () => {
    const template = createTemplate()
      .page()
      .text("报表钢炼浇注工艺卡", { leftMm: 50, topMm: 5, widthMm: 110 }, { fontSize: 14 })
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
        { s: "进站温度", p: "1556 ℃" },
        { s: "白渣保持", p: "18 分" }
      ]
    }).plan;
    const { bytes, unsupportedTextCount } = await renderPlanToPdf(plan, {
      customFontBytes: DEMO_FONT
    });
    expect(unsupportedTextCount).toBe(0);
    expect(bytes.length).toBeGreaterThan(2000);
  });

  it("自定义字体缺失的中文和 emoji 按行计数，多个缺字不生成 .notdef", async () => {
    // 仓库子集覆盖“报表钢”，不覆盖“铁/龘/😀”；UTF-16 代理对作为单个码点检查。
    const { bytes, unsupportedTextCount, pageErrors } = await renderPlanToPdf(
      textPlan(["报表钢", "铁龘", "😀😀", "ASCII"]),
      { customFontBytes: DEMO_FONT }
    );
    expect(unsupportedTextCount).toBe(2);
    expect(pageErrors).toEqual([]);
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
  });

  it("字符集每个字体只建立一次，换行/空行与可编码的字符组合不计缺字", async () => {
    const getCharacterSet = vi.spyOn(PDFFont.prototype, "getCharacterSet");
    try {
      const { unsupportedTextCount, pageErrors } = await renderPlanToPdf(
        textPlan(["", "报表\r\n钢\n", "ffi fl", "ASCII"]),
        { customFontBytes: DEMO_FONT }
      );
      expect(unsupportedTextCount).toBe(0);
      expect(pageErrors).toEqual([]);
      expect(getCharacterSet).toHaveBeenCalledTimes(1);
    } finally {
      getCharacterSet.mockRestore();
    }
  });

  it("内置西文字体支持的重音文本和直接 lines 中的换行仍能导出", async () => {
    const { unsupportedTextCount, pageErrors } = await renderPlanToPdf(textPlan(["café\r\nASCII", ""]));
    expect(unsupportedTextCount).toBe(0);
    expect(pageErrors).toEqual([]);
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

  it("富文本降级为纯文本并计入保真告警", async () => {
    const plan: RenderPlan = {
      schemaVersion: "t",
      pages: [
        {
          pageWidthMm: 210,
          pageHeightMm: 297,
          components: [
            {
              kind: "text",
              leftMm: 10,
              topMm: 10,
              widthMm: 120,
              heightMm: 20,
              richParagraphs: [
                { segments: [{ kind: "text", text: "Rich " }, { kind: "field", field: "F1" }] }
              ]
            }
          ]
        }
      ]
    };
    const { fidelityWarnings, bytes } = await renderPlanToPdf(plan);
    expect(fidelityWarnings.some((w) => w.includes("富文本"))).toBe(true);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("data URL PNG 图片可嵌入，普通 URL 图片跳过并告警", async () => {
    const PNG_1PX =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const plan: RenderPlan = {
      schemaVersion: "t",
      pages: [
        {
          pageWidthMm: 210,
          pageHeightMm: 297,
          components: [
            { kind: "image", leftMm: 10, topMm: 10, widthMm: 20, heightMm: 20, imageData: PNG_1PX },
            { kind: "image", leftMm: 40, topMm: 10, widthMm: 20, heightMm: 20, imageData: "https://cdn/x.png" }
          ]
        }
      ]
    };
    const { fidelityWarnings, pageErrors, pdfDoc } = await renderPlanToPdf(plan);
    await expect(pdfDoc.save()).resolves.toBeDefined();
    expect(pageErrors).toEqual([]);
    expect(fidelityWarnings.some((w) => w.includes("已跳过"))).toBe(true);
  });

  it("网格按 colWidthsMm/rowHeightsMm/colSpan 解析且单元格底色生效", async () => {
    const plan: RenderPlan = {
      schemaVersion: "t",
      pages: [
        {
          pageWidthMm: 210,
          pageHeightMm: 297,
          components: [
            {
              kind: "rect",
              leftMm: 10,
              topMm: 10,
              widthMm: 100,
              heightMm: 20,
              grid: {
                cells: [[{ text: "H1", colSpan: 2, style: { align: "center", backgroundColor: "#eeeeee" } }, { text: "H2" }]],
                colWidthsMm: [50, 30, 20],
                rowHeightsMm: [10, 10]
              }
            }
          ]
        }
      ]
    };
    const { pageErrors, pdfDoc } = await renderPlanToPdf(plan);
    expect(pageErrors).toEqual([]);
    await expect(pdfDoc.save()).resolves.toBeDefined();
  });
});
