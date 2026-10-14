/* eslint-disable vue/one-component-per-file -- 测试内联 render 误报 */
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, resolveComponent, type App } from "vue";
import { machReportPlugin, MachReportPreview } from "../plugin";
import { useReportPreview } from "../controller";
import { MachReportError, toErrorDetail } from "../errors";
import ReportPreview from "../ReportPreview.vue";
import { createLocalFetcher } from "../local-adapter";
import { createTemplate, type ReportTemplate } from "@agile-team/mach-report";
import { defineMachReportConfig } from "../config";

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

const tpl: ReportTemplate = {
  pages: [
    {
      widthMm: 210,
      heightMm: 297,
      components: [
        { kind: "text", leftMm: 10, topMm: 10, widthMm: 100, heightMm: 10, text: "插件全局组件" }
      ]
    }
  ]
};

describe("插件全局组件注册（mach-table 式快速集成）", () => {
  it("默认注册 <MachReportPreview>，模板直接使用（懒加载组件）", async () => {
    const app = createApp({
      render: () => h("div", [h(MachReportPreview, { reportId: "T1" })])
    });
    app.use(machReportPlugin, {
      fetcher: createLocalFetcher({ T1: { template: tpl, datasets: {} } })
    });
    expect(app.component("MachReportPreview")).toBeDefined();
    const root = mount(app);
    await vi.waitFor(() => expect(root.textContent).toContain("插件全局组件"));
  });

  it("globalComponent: false 时不注册", () => {
    const app = createApp({ render: () => h("div") });
    app.use(machReportPlugin, { globalComponent: false });
    expect(app.component("MachReportPreview")).toBeUndefined();
  });

  it("注册模板与 load 即可预览业务行，自动读取参数定义与默认值", async () => {
    const template = createTemplate()
      .params([{ field: "warehouse", label: "仓库", defaultValue: "WH-01", required: true }])
      .page("a4")
      .list("detail", { leftMm: 12, topMm: 30, widthMm: 186 }, [
        { header: "物料", field: "name", widthMm: 120 },
        { header: "数量", field: "qty", widthMm: 66 }
      ])
      .build();
    const load = vi.fn().mockResolvedValue({ detail: [{ name: "注册数据源物料", qty: 4 }] });
    const onError = vi.fn();
    const app = createApp({
      render: () => h(resolveComponent("MachReportPreview"), {
        reportId: "outbound", params: { orderId: "SO-01" }, onError
      })
    });
    app.use(machReportPlugin, { reports: { outbound: { template, load } } });
    expect(load).not.toHaveBeenCalled();
    const root = mount(app);
    await vi.waitFor(() => expect(root.textContent).toContain("注册数据源物料"));
    expect(onError).not.toHaveBeenCalled();
    expect(root.querySelector(".mrp-params")?.textContent).toContain("仓库");
    const input = root.querySelector<HTMLInputElement>(".mrp-param-input")!;
    expect(input.value).toBe("WH-01");
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenLastCalledWith(expect.objectContaining({
      reportId: "outbound", params: { orderId: "SO-01", warehouse: "WH-01" }, signal: expect.any(AbortSignal)
    }));
    input.value = "WH-02";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await nextTick();
    root.querySelector<HTMLButtonElement>(".mrp-param-query")!.click();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(load).toHaveBeenLastCalledWith(expect.objectContaining({
      params: { orderId: "SO-01", warehouse: "WH-02" }
    }));
  });

  it("两个应用的报表注册、取数和配置互不污染", async () => {
    const template = createTemplate()
      .page("a4")
      .list("detail", { widthMm: 180 }, [{ header: "物料", field: "name", widthMm: 180 }])
      .build();
    const loadA = vi.fn().mockResolvedValue({ detail: [{ name: "应用 A 的业务数据" }] });
    const loadB = vi.fn().mockResolvedValue({ detail: [{ name: "应用 B 的业务数据" }] });
    const appA = createApp({ render: () => h(MachReportPreview, { reportId: "order", params: { tenant: "A" } }) });
    const appB = createApp({ render: () => h(MachReportPreview, { reportId: "order", params: { tenant: "B" } }) });
    appA.use(machReportPlugin, {
      reports: { order: { template, load: loadA } },
      config: defineMachReportConfig({ defaults: { messages: { title: "应用 A 报表" } } })
    });
    appB.use(machReportPlugin, {
      reports: { order: { template, load: loadB } },
      config: defineMachReportConfig({ defaults: { messages: { title: "应用 B 报表" } } })
    });
    const rootA = mount(appA);
    const rootB = mount(appB);
    await vi.waitFor(() => {
      expect(rootA.textContent).toContain("应用 A 的业务数据");
      expect(rootB.textContent).toContain("应用 B 的业务数据");
    });
    expect(rootA.textContent).toContain("应用 A 报表");
    expect(rootA.textContent).not.toContain("应用 B");
    expect(rootB.textContent).toContain("应用 B 报表");
    expect(rootB.textContent).not.toContain("应用 A");
    expect(loadA).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ params: { tenant: "A" } }));
    expect(loadB).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ params: { tenant: "B" } }));
  });

  it.each(["plugin", "component"])("显式 %s fetcher 优先于 reports 注册", async (source) => {
    const load = vi.fn().mockResolvedValue({});
    const fetcher = vi.fn(createLocalFetcher({ T1: { template: tpl } }));
    const app = createApp({
      render: () => h(MachReportPreview, { reportId: "T1", ...(source === "component" ? { fetcher } : {}) })
    });
    app.use(machReportPlugin, {
      reports: { T1: { template: tpl, load } },
      ...(source === "plugin" ? { fetcher } : {})
    });
    const root = mount(app);
    await vi.waitFor(() => expect(root.textContent).toContain("插件全局组件"));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(load).not.toHaveBeenCalled();
  });

  it("保留宿主已注册的同名组件", () => {
    const CustomPreview = defineComponent({ render: () => h("div", "宿主的报表组件") });
    const app = createApp({ render: () => h(resolveComponent("MachReportPreview")) });
    app.component("MachReportPreview", CustomPreview);
    app.use(machReportPlugin);
    expect(app.component("MachReportPreview")).toBe(CustomPreview);
    expect(mount(app).textContent).toBe("宿主的报表组件");
  });
});

describe("useReportPreview()（后代组件免模板 ref）", () => {
  it("后代组件拿到控制器并调用 gotoPage/reload", async () => {
    let captured: ReturnType<typeof useReportPreview> = null;
    const Child = defineComponent({
      setup() {
        captured = useReportPreview();
        return () => h("button", { onClick: () => captured?.gotoPage(2) }, "跳页");
      }
    });
    const Host = defineComponent({
      setup() {
        return () =>
          h(ReportPreview, { reportId: "T1", autoLoad: true }, { default: () => h(Child) });
      }
    });
    const app = createApp(Host);
    app.use(machReportPlugin, {
      fetcher: createLocalFetcher({
        T1: {
          template: {
            pages: [
              tpl.pages[0]!,
              { widthMm: 210, heightMm: 297, components: [] }
            ]
          },
          datasets: {}
        }
      })
    });
    mount(app);
    await vi.waitFor(() => expect(captured).not.toBeNull());
    expect(captured).toMatchObject({
      reload: expect.any(Function),
      print: expect.any(Function),
      exportAs: expect.any(Function),
      openPdfWindow: expect.any(Function),
      gotoPage: expect.any(Function)
    });
  });

  it("不在预览组件内调用返回 null（不抛错）", () => {
    const Probe = defineComponent({
      setup() {
        return () => h("div", String(useReportPreview() === null));
      }
    });
    const root = mount(createApp(Probe));
    expect(root.textContent).toBe("true");
  });
});

describe("MachReportError 结构化错误", () => {
  it("code/cause 保留，detail 形状正确", () => {
    const cause = new Error("boom");
    const err = new MachReportError("fetch", "网关超时", cause);
    expect(err.code).toBe("fetch");
    expect(err.cause).toBe(cause);
    expect(err.name).toBe("MachReportError");
    expect(toErrorDetail(err)).toEqual({ code: "fetch", cause });
    expect(toErrorDetail(new Error("x"))).toEqual({ code: "render", cause: new Error("x") });
  });

  it("error 事件第二参数带 code（validate 分类）", async () => {
    const onError = vi.fn();
    const badFetcher = vi.fn().mockResolvedValue({ schemaVersion: "t", pages: [{}] });
    const app = createApp({
      render: () => h(ReportPreview, { reportId: "T1", autoLoad: true, onError })
    });
    app.use(machReportPlugin, { fetcher: badFetcher });
    mount(app);
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    const [, detail] = onError.mock.calls[0] as [string, { code: string }];
    expect(typeof onError.mock.calls[0]![0]).toBe("string");
    expect(detail.code).toBe("validate");
  });
});
