// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import ReportPreview from "../ReportPreview.vue";
import { buildWordHtml } from "../composables/usePrintExport";
import type { RenderPlan } from "@agile-team/mach-report";

const plan: RenderPlan = {
  schemaVersion: "t",
  pages: [
    {
      pageWidthMm: 210,
      pageHeightMm: 297,
      components: [
        { kind: "text", leftMm: 10, topMm: 10, widthMm: 80, heightMm: 8, text: "出库单明细" }
      ]
    },
    { pageWidthMm: 297, pageHeightMm: 210, components: [] }
  ]
};

describe("buildWordHtml（Word 兼容导出）", () => {
  it("带 Word 命名空间与 Print 视图头，保留页面内容与分页规则", () => {
    const { html, filename } = buildWordHtml(plan);
    expect(filename).toBe("mach-report.doc");
    expect(html).toContain("xmlns:w=\"urn:schemas-microsoft-com:office:word\"");
    expect(html).toContain("<w:View>Print</w:View>");
    expect(html).toContain("出库单明细");
    // named pages 分页规则随行（混合纸张在 Word 中保持尺寸）
    expect(html).toContain("@page p210x297");
    expect(html).toContain("@page p297x210");
    expect(html).not.toContain("<!doctype html><html><head>"); // 头部被 Word 版替换
  });
});

describe("exportAs 出口矩阵接线", () => {
  it("png/word 别名正确分发（happy-dom 无 2D：图片导出走 export 错误码不崩溃）", async () => {
    const onError = vi.fn();
    const fetcher = async () => ({
      schemaVersion: "t",
      pages: [{ pageWidthMm: 210, pageHeightMm: 100, components: [] as never[] }]
    });
    const wrapper = mount(ReportPreview, {
      props: { tempId: "T1", autoLoad: true, fetcher, onError },
      attachTo: document.body
    });
    await vi.waitFor(() => {
      expect(wrapper.element.querySelector(".mrp-page-holder")).toBeTruthy();
    }, { timeout: 5000 });
    // 工具栏出现两个新出口按钮
    const texts = wrapper.findAll("button").map((b) => b.text());
    expect(texts.some((t) => t.includes("导出图片"))).toBe(true);
    expect(texts.some((t) => t.includes("导出 Word"))).toBe(true);
    // Word 导出：触发下载路径（happy-dom 下 a.click 为 no-op，不应崩溃/报错）
    const wordBtn = wrapper.findAll("button").find((b) => b.text().includes("导出 Word"))!;
    await wordBtn.trigger("click");
    expect(onError).not.toHaveBeenCalled();
    wrapper.unmount();
  }, 15000);
});
