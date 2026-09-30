/* eslint-disable vue/one-component-per-file -- 测试文件内联 render 函数误报 */
// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { createApp, h } from "vue";
import { machReportPlugin } from "../plugin";
import { MACH_REPORT_FETCHER_KEY, MACH_REPORT_PDF_EXPORTER_KEY } from "../injection-keys";
import ReportPreview from "../ReportPreview.vue";
import type { ReportTemplate } from "@agile-team/mach-report-core";

const tpl: ReportTemplate = {
  pages: [
    {
      widthMm: 210,
      heightMm: 297,
      components: [
        { kind: "text", leftMm: 10, topMm: 10, widthMm: 100, heightMm: 10, text: "插件注入渲染" }
      ]
    }
  ]
};

describe("machReportPlugin（一次注册，业务侧一行使用）", () => {
  it("request 选项自动组装 jh4j fetcher 并注入", async () => {
    const request = vi.fn().mockResolvedValue({
      code: 200,
      data: { pages: [{ pageWidthMm: 210, pageHeightMm: 297, components: [] }] }
    });
    const app = createApp({ render: () => h(ReportPreview, { tempId: "T1", autoLoad: true }) });
    app.use(machReportPlugin, { request });
    app.mount(document.createElement("div"));
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({ url: "/report/codePrintReport/gridPlan", method: "get" })
      );
    });
  });

  it("fetcher 选项优先于 request；pdfExporter 注入生效", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      schemaVersion: "t",
      pages: tpl.pages.map((p) => ({ ...p, components: [] as never[] }))
    });
    const pdfExporter = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
    const app = createApp({ render: () => h(ReportPreview, { tempId: "T1", autoLoad: true }) });
    app.use(machReportPlugin, { request: vi.fn(), fetcher, pdfExporter });
    const provides = app._context.provides as Record<string | symbol, unknown>;
    const injectedFetcher = provides[MACH_REPORT_FETCHER_KEY as unknown as string] as
      | (() => void)
      | undefined;
    const injectedExporter = provides[MACH_REPORT_PDF_EXPORTER_KEY as unknown as string] as
      | ((plan: unknown) => Promise<Uint8Array>)
      | undefined;
    expect(typeof injectedFetcher).toBe("function");
    expect(typeof injectedExporter).toBe("function");
    await expect(injectedExporter!({ schemaVersion: "t", pages: [] })).resolves.toEqual(
      new Uint8Array([1, 2, 3])
    );
    app.mount(document.createElement("div"));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
  });

  it("本地 fetcher 直接可注入（离线/单测场景）", async () => {
    const { createLocalFetcher } = await import("../local-adapter");
    const fetcher = createLocalFetcher({
      T1: { tempId: "T1", template: tpl, datasets: {} }
    });
    const app = createApp({ render: () => h(ReportPreview, { tempId: "T1", autoLoad: true }) });
    app.use(machReportPlugin, { fetcher });
    const root = document.createElement("div");
    app.mount(root);
    await vi.waitFor(() => {
      expect(root.textContent).toContain("插件注入渲染");
    });
  });
});
