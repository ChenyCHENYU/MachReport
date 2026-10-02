// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { createApp, h, resolveComponent } from "vue";
import { MachReportPreview, machReportAsyncPlugin, preloadMachReport } from "../async";
import { createLocalFetcher } from "../local-adapter";
import type { ReportTemplate } from "@agile-team/mach-report";

describe("./async 异步入口（首屏按需加载）", () => {
  it("导出异步组件/插件/预载函数", () => {
    expect(MachReportPreview).toBeDefined();
    expect(typeof preloadMachReport).toBe("function");
    expect(typeof machReportAsyncPlugin.install).toBe("function");
  });

  it("异步插件注册全局组件 MachReportPreview 且数据面注入生效", async () => {
    const tpl: ReportTemplate = {
      pages: [
        {
          widthMm: 210,
          heightMm: 297,
          components: [
            { kind: "text", leftMm: 10, topMm: 10, widthMm: 100, heightMm: 10, text: "异步组件渲染" }
          ]
        }
      ]
    };
    const app = createApp({
      render: () => {
        const comp = resolveComponent("MachReportPreview");
        return h("div", [h(comp, { reportId: "T1" })]);
      }
    });
    app.use(machReportAsyncPlugin, {
      fetcher: createLocalFetcher({ T1: { template: tpl, datasets: {} } })
    });
    expect(app.component("MachReportPreview")).toBeDefined();
    const root = document.createElement("div");
    app.mount(root);
    await vi.waitFor(() => {
      expect(root.textContent).toContain("异步组件渲染");
    }, { timeout: 5000 });
  });

  it("preloadMachReport 预取组件模块（正式渲染零等待）", async () => {
    await expect(preloadMachReport()).resolves.toBeTruthy();
  });
});
