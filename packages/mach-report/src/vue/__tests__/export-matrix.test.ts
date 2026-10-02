// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import ReportPreview from "../ReportPreview.vue";
import { buildWordHtml, usePrintExport } from "../composables/usePrintExport";
import { createDefaultPdfExporter } from "../pdf-exporter";
import { ref } from "vue";
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
  it("PDF 异步生成期间报告忙碌状态，失败后清除", async () => {
    const onBusy = vi.fn();
    const onError = vi.fn();
    const api = usePrintExport(ref(plan), {
      getPdfExporter: () => async () => { throw new Error("字体不可用"); },
      onBusy,
      onError
    });
    api.exportAs("pdf");
    expect(onBusy).toHaveBeenCalledWith("PDF");
    await vi.waitFor(() => expect(onBusy).toHaveBeenCalledWith(null));
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("字体不可用"), "pdf");
  });

  it("未知格式拒绝；PDF 窗口装载 application/pdf，Excel 下载真实 xlsx", async () => {
    const onError = vi.fn();
    const onWarning = vi.fn();
    const blobs: Blob[] = [];
    const createUrl = vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return `blob:test-${blobs.length}`;
    });
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const iframe = { title: "", style: { cssText: "" }, src: "" };
    const viewer = {
      document: {
        title: "",
        documentElement: { style: { height: "" } },
        body: { style: { cssText: "" }, replaceChildren: vi.fn() },
        createElement: vi.fn().mockReturnValue(iframe)
      },
      close: vi.fn()
    };
    const open = vi.spyOn(window, "open").mockReturnValue(viewer as unknown as Window);
    try {
      const api = usePrintExport(ref(plan), {
        getPdfExporter: () => async () => new Uint8Array([37, 80, 68, 70]),
        onError,
        onWarning
      });
      api.exportAs("bogus");
      expect(onError).toHaveBeenCalledWith("不支持的导出格式：bogus", "export");
      api.openPdfWindow();
      await vi.waitFor(() => expect(iframe.src).toBe("blob:test-1"));
      expect(viewer.document.body.replaceChildren).toHaveBeenCalledWith(iframe);
      expect(blobs[0]?.type).toBe("application/pdf");
      api.exportAs("xlsx");
      await vi.waitFor(() => expect(blobs.some((b) => b.type.includes("spreadsheetml.sheet"))).toBe(true), { timeout: 10000 });
      expect(open).toHaveBeenCalledWith("", "_blank");
    } finally {
      createUrl.mockRestore();
      revokeUrl.mockRestore();
      open.mockRestore();
    }
  }, 15000);

  it("默认 PDF 导出器遇到中文缺字时失败，不下载残缺文件", async () => {
    const exporter = createDefaultPdfExporter({ fontUrl: "" });
    await expect(exporter(plan)).rejects.toThrow(/字体/);
  });

  it("png/word 别名正确分发（happy-dom 无 2D：图片导出走 export 错误码不崩溃）", async () => {
    const onError = vi.fn();
    const fetcher = async () => ({
      schemaVersion: "t",
      pages: [{ pageWidthMm: 210, pageHeightMm: 100, components: [] as never[] }]
    });
    const wrapper = mount(ReportPreview, {
      props: { reportId: "T1", autoLoad: true, fetcher, onError },
      attachTo: document.body
    });
    await vi.waitFor(() => {
      expect(wrapper.element.querySelector(".mrp-page-holder")).toBeTruthy();
    }, { timeout: 5000 });
    // 工具栏出现三个按需导出按钮
    const texts = wrapper.findAll("button").map((b) => b.text());
    expect(texts.some((t) => t.includes("导出 Excel"))).toBe(true);
    expect(texts.some((t) => t.includes("导出图片"))).toBe(true);
    expect(texts.some((t) => t.includes("导出 Word"))).toBe(true);
    // Word 导出：触发下载路径（happy-dom 下 a.click 为 no-op，不应崩溃/报错）
    const wordBtn = wrapper.findAll("button").find((b) => b.text().includes("导出 Word"))!;
    await wordBtn.trigger("click");
    expect(onError).not.toHaveBeenCalled();
    wrapper.unmount();
  }, 15000);
});
