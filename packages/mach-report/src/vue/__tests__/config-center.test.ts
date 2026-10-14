/* eslint-disable vue/one-component-per-file -- 测试内联 render 误报 */
// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, reactive } from "vue";
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
  it("只声明需要的配置层，省略 defaults/presets 由包内补齐", () => {
    expect(defineMachReportConfig()).toEqual({ defaults: {}, presets: {} });
    const config = defineMachReportConfig({ defaults: { pdfFontUrl: "/fonts/report.ttf" } });
    expect(config.presets).toEqual({});
    expect(resolveConfig(config).pdfFontUrl).toBe("/fonts/report.ttf");
    const presetOnly = defineMachReportConfig({
      presets: { previewOnly: { showPrint: false } },
      defaultPreset: "previewOnly"
    });
    expect(presetOnly.defaults).toEqual({});
    expect(resolveConfig(presetOnly).showPrint).toBe(false);
  });

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

  it("messages 与 theme 局部覆写保留内置缺省", () => {
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

  it("preset 局部覆盖文案和主题时保留 defaults 的其余字段，不改动输入", () => {
    const config = defineMachReportConfig({
      defaults: {
        messages: { title: "订单报表", retry: "重新获取" },
        theme: { shellBg: "#101010", toolbarBg: "#202020" }
      },
      presets: {
        invoice: {
          messages: { print: "打印本单", retry: "再试一次" },
          theme: { btnActiveBg: "#334455", toolbarBg: "#303030" }
        }
      }
    });
    const before = structuredClone(config);
    const resolved = resolveConfig(config, "invoice");
    expect(resolved.messages).toMatchObject({
      title: "订单报表", print: "打印本单", retry: "再试一次", exportPdf: "导出 PDF"
    });
    expect(resolved.theme).toMatchObject({
      shellBg: "#101010", toolbarBg: "#303030", btnActiveBg: "#334455"
    });
    expect(config).toEqual(before);
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

  it("路由 defaults 优先于应用 preset，同名 preset 按字段叠加且保持响应式", () => {
    const overlay = reactive({
      defaults: {
        gapPx: 12,
        messages: { title: "路由报表" },
        theme: { shellBg: "#111111" }
      },
      presets: {
        invoice: {
          showPrint: false,
          messages: { print: "打印路由单据" },
          theme: { btnActiveBg: "#555555" }
        }
      }
    });
    let configRef: ReturnType<typeof useMachReportConfig> | undefined;
    const Probe = defineComponent({
      setup() {
        configRef = useMachReportConfig();
        return () => h("div");
      }
    });
    const Host = defineComponent({
      setup() {
        provideMachReportConfig(overlay);
        return () => h(Probe);
      }
    });
    const app = createApp(Host);
    const appConfig = defineMachReportConfig({
      defaults: {
        messages: { retry: "重新取数" },
        theme: { toolbarBorder: "#222222" }
      },
      defaultPreset: "invoice",
      presets: {
        invoice: {
          gapPx: 99,
          showPrint: true,
          showExport: false,
          messages: { title: "应用预设", print: "打印应用单据", exportPdf: "下载 PDF" },
          theme: { shellBg: "#333333", toolbarBg: "#444444" }
        },
        other: { showPdfWindow: false, messages: { title: "其它应用预设" } }
      }
    });
    const original = structuredClone(appConfig);
    app.use(machReportPlugin, { config: appConfig });
    app.mount(document.createElement("div"));
    const resolved = resolveConfig(configRef!.value);
    expect(resolved).toMatchObject({ gapPx: 12, showPrint: false, showExport: false });
    expect(resolved.messages).toMatchObject({
      title: "路由报表", print: "打印路由单据", exportPdf: "下载 PDF", retry: "重新取数"
    });
    expect(resolved.theme).toMatchObject({
      shellBg: "#111111", toolbarBg: "#444444", toolbarBorder: "#222222", btnActiveBg: "#555555"
    });
    expect(resolveConfig(configRef!.value, "other")).toMatchObject({
      showPdfWindow: false,
      messages: { title: "路由报表", retry: "重新取数" }
    });
    overlay.defaults.messages.title = "更新后的路由报表";
    expect(resolveConfig(configRef!.value).messages.title).toBe("更新后的路由报表");
    expect(appConfig).toEqual(original);
    app.unmount();
  });

  it("多级路由 overlay 继承字段，允许只提供 presets", () => {
    let resolved: ReturnType<typeof resolveConfig> | undefined;
    const Probe = defineComponent({
      setup() {
        resolved = resolveConfig(useMachReportConfig().value);
        return () => h("div");
      }
    });
    const Inner = defineComponent({
      setup() {
        provideMachReportConfig({ presets: { invoice: { messages: { print: "打印详情" } } } });
        return () => h(Probe);
      }
    });
    const Outer = defineComponent({
      setup() {
        provideMachReportConfig({ messages: { title: "路由标题" }, theme: { shellBg: "#123456" } });
        return () => h(Inner);
      }
    });
    const app = createApp(Outer);
    app.use(machReportPlugin, {
      config: defineMachReportConfig({
        defaults: { messages: { retry: "重新获取" } },
        defaultPreset: "invoice",
        presets: { invoice: { gapPx: 22, messages: { title: "预设标题", print: "打印预设" } } }
      })
    });
    app.mount(document.createElement("div"));
    expect(resolved).toMatchObject({
      gapPx: 22,
      messages: { title: "路由标题", print: "打印详情", retry: "重新获取" },
      theme: { shellBg: "#123456" }
    });
    app.unmount();
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
