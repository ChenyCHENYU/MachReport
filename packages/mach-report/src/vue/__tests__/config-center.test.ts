/* eslint-disable vue/one-component-per-file -- 测试内联 render 误报 */
// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h } from "vue";
import { machReportPlugin } from "../plugin";
import {
  defineMachReportConfig,
  defineMachReportPreset,
  provideMachReportConfig,
  resolveConfig,
  themeToCssVars,
  useMachReportConfig
} from "../config";
import ReportPreview from "../ReportPreview.vue";
import type { ReportTemplate } from "@agile-team/mach-report";
import { createLocalFetcher } from "../local-adapter";

const tpl: ReportTemplate = {
  pages: [
    {
      widthMm: 210,
      heightMm: 297,
      components: [
        { kind: "text", leftMm: 10, topMm: 10, widthMm: 100, heightMm: 10, text: "配置中心渲染" }
      ]
    }
  ]
};

describe("defineMachReportConfig 配置中心", () => {
  it("preset 覆盖 defaults，未配置项落内置缺省", () => {
    const config = defineMachReportConfig({
      defaults: { showExport: true, gapPx: 10 },
      presets: { lean: defineMachReportPreset({ showExport: false, showPrint: false }) },
      defaultPreset: "lean"
    });
    const resolved = resolveConfig(config);
    expect(resolved.showExport).toBe(false);
    expect(resolved.showPrint).toBe(false);
    expect(resolved.gapPx).toBe(10); // 未被 preset 覆盖，继承 defaults
    expect(resolved.showPdfWindow).toBe(true); // 内置缺省
    expect(resolved.messages.title).toBe("报表预览");
  });

  it("指定 preset 名优先于 defaultPreset", () => {
    const config = defineMachReportConfig({
      defaults: {},
      presets: { a: { gapPx: 5 }, b: { gapPx: 9 } },
      defaultPreset: "a"
    });
    expect(resolveConfig(config, "b").gapPx).toBe(9);
  });

  it("messages 与 theme 可整体覆写", () => {
    const config = defineMachReportConfig({
      defaults: { messages: { title: "Report Preview" }, theme: { shellBg: "#101010" } },
      presets: {}
    });
    const resolved = resolveConfig(config);
    expect(resolved.messages.title).toBe("Report Preview");
    expect(resolved.messages.print).toBe("打印"); // 其余文案沿用缺省
    expect(resolved.theme.shellBg).toBe("#101010");
    expect(resolved.theme.toolbarBg).toBe("#323639");
  });

  it("themeToCssVars 产出 --mrp-* 变量", () => {
    const vars = themeToCssVars({ shellBg: "#111", btnActiveBg: "#0a7" }) as Record<string, string>;
    expect(vars["--mrp-shell-bg"]).toBe("#111");
    expect(vars["--mrp-btn-active-bg"]).toBe("#0a7");
    expect(Object.keys(vars)).toHaveLength(2);
  });

  it("provideMachReportConfig 路由级叠加：本层优先于应用层", async () => {
    const Host = defineComponent({
      setup() {
        provideMachReportConfig({ showPrint: false, messages: { title: "Route Title" } });
        return () => h(ReportPreview, { reportId: "T1", autoLoad: false });
      }
    });
    const app = createApp({ render: () => h(Host) });
    app.use(machReportPlugin, {
      fetcher: createLocalFetcher({ T1: { template: tpl, datasets: {} } }),
      config: defineMachReportConfig({
        defaults: { showPrint: true, messages: { title: "App Title" } },
        presets: {}
      })
    });
    const root = document.createElement("div");
    app.mount(root);
    await vi.waitFor(() => {
      expect(root.textContent).toContain("Route Title");
    });
    // 路由层关闭打印：工具栏无打印按钮，但仍可导出（应用层默认开）
    expect(root.textContent).not.toContain("打印");
    expect(root.textContent).toContain("导出 PDF");
  });

  it("props 优先级最高：显式 show-print 覆盖配置中心", async () => {
    const app = createApp({
      render: () =>
        h(ReportPreview, { reportId: "T1", autoLoad: true, showPrint: true })
    });
    app.use(machReportPlugin, {
      fetcher: createLocalFetcher({ T1: { template: tpl, datasets: {} } }),
      config: defineMachReportConfig({
        defaults: { showPrint: false },
        presets: {}
      })
    });
    const root = document.createElement("div");
    app.mount(root);
    await vi.waitFor(() => {
      expect(root.textContent).toContain("配置中心渲染");
    });
    expect(root.textContent).toContain("打印");
  });

  it("useMachReportConfig 未提供时返回 null（走内置缺省）", () => {
    let captured: unknown = "unset";
    const Probe = defineComponent({
      setup() {
        const configRef = useMachReportConfig();
        captured = configRef.value;
        return () => h("div");
      }
    });
    const app = createApp(Probe);
    app.mount(document.createElement("div"));
    expect(captured).toBeNull();
  });
});
