/* eslint-disable vue/one-component-per-file -- 测试文件内联 render 函数误报 */
// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { createApp, h } from "vue";
import { machReportPlugin } from "../plugin";
import { MACH_REPORT_FETCHER_KEY, MACH_REPORT_PDF_EXPORTER_KEY } from "../injection-keys";
import ReportPreview from "../ReportPreview.vue";
import { createLocalFetcher } from "../local-adapter";
import type { ReportTemplate } from "@agile-team/mach-report";

const template: ReportTemplate = {
  pages: [{
    widthMm: 210, heightMm: 297,
    components: [{
      kind: "text", leftMm: 10, topMm: 10, widthMm: 100, heightMm: 10,
      text: "插件注入渲染"
    }]
  }]
};

describe("machReportPlugin（项目自带数据源）", () => {
  it("只注册组件时不发隐式请求，提示提供 fetcher", async () => {
    const fetchMock = vi.fn();
    const onError = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp({ render: () => h(ReportPreview, { reportId: "T1", onError }) });
    try {
      app.use(machReportPlugin);
      app.mount(document.createElement("div"));
      await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(
        "未提供渲染数据源 fetcher", expect.objectContaining({ code: "config" })
      ));
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      app.unmount();
      vi.unstubAllGlobals();
    }
  });

  it("注入项目 fetcher 和自定义 PDF 导出器", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      schemaVersion: "1.0.0-mach",
      pages: [{ pageWidthMm: 210, pageHeightMm: 297, components: [] }]
    });
    const pdfExporter = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
    const app = createApp({ render: () => h(ReportPreview, { reportId: "T1" }) });
    app.use(machReportPlugin, { fetcher, pdfExporter });
    const provides = app._context.provides as Record<string | symbol, unknown>;
    const injectedFetcher = provides[MACH_REPORT_FETCHER_KEY as unknown as string];
    const injectedExporter = provides[MACH_REPORT_PDF_EXPORTER_KEY as unknown as string] as
      ((plan: unknown) => Promise<Uint8Array>) | undefined;
    expect(typeof injectedFetcher).toBe("function");
    expect(typeof injectedExporter).toBe("function");
    await expect(injectedExporter!({ schemaVersion: "t", pages: [] })).resolves.toEqual(
      new Uint8Array([1, 2, 3])
    );
    app.mount(document.createElement("div"));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledWith({ reportIds: ["T1"], params: {} }));
    app.unmount();
  });

  it("本地模板也通过同一 fetcher 接口接入", async () => {
    const fetcher = createLocalFetcher({ T1: { template } });
    const app = createApp({ render: () => h(ReportPreview, { reportId: "T1" }) });
    app.use(machReportPlugin, { fetcher });
    const root = document.createElement("div");
    app.mount(root);
    await vi.waitFor(() => expect(root.textContent).toContain("插件注入渲染"));
    app.unmount();
  });
});
