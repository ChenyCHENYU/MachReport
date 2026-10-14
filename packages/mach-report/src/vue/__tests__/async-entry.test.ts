/* eslint-disable vue/one-component-per-file -- 测试内联组件 */
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, resolveComponent, type App } from "vue";
import { MachReportPreview, machReportAsyncPlugin, preloadMachReport } from "../async";
import { createLocalFetcher } from "../local-adapter";
import { createTemplate, type ReportTemplate } from "@agile-team/mach-report";

const mountedApps: App[] = [];

function mount(app: App): HTMLElement {
  const root = document.createElement("div");
  mountedApps.push(app);
  app.mount(root);
  return root;
}

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount();
});

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
    const root = mount(app);
    await vi.waitFor(() => {
      expect(root.textContent).toContain("异步组件渲染");
    }, { timeout: 5000 });
  });

  it("异步插件也支持 reports 注册，首次预览才调用业务取数", async () => {
    const template = createTemplate()
      .page("a4")
      .list("detail", { widthMm: 180 }, [{ header: "名称", field: "name", widthMm: 180 }])
      .build();
    const load = vi.fn().mockResolvedValue({ detail: [{ name: "异步注册的业务行" }] });
    const app = createApp({
      render: () => h(resolveComponent("MachReportPreview"), { reportId: "outbound" })
    });
    app.use(machReportAsyncPlugin, { reports: { outbound: { template, load } } });
    expect(load).not.toHaveBeenCalled();
    const root = mount(app);
    await vi.waitFor(() => expect(root.textContent).toContain("异步注册的业务行"));
    expect(load).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ reportId: "outbound", params: {} }));
  });

  it("globalComponent: false 时异步插件保留局部接入，不注册全局组件", () => {
    const app = createApp({ render: () => h("div") });
    app.use(machReportAsyncPlugin, { globalComponent: false });
    expect(app.component("MachReportPreview")).toBeUndefined();
  });

  it("异步插件保留宿主已注册的同名组件", () => {
    const CustomPreview = defineComponent({ render: () => h("div", "宿主的异步报表组件") });
    const app = createApp({ render: () => h(resolveComponent("MachReportPreview")) });
    app.component("MachReportPreview", CustomPreview);
    app.use(machReportAsyncPlugin);
    expect(app.component("MachReportPreview")).toBe(CustomPreview);
    expect(mount(app).textContent).toBe("宿主的异步报表组件");
  });

  it("preloadMachReport 预取组件模块（正式渲染零等待）", async () => {
    await expect(preloadMachReport()).resolves.toBeTruthy();
  });
});
