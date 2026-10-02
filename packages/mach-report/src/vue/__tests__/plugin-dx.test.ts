/* eslint-disable vue/one-component-per-file -- 测试内联 render 误报 */
// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h } from "vue";
import { machReportPlugin, MachReportPreview } from "../plugin";
import { useReportPreview } from "../controller";
import { MachReportError, toErrorDetail } from "../errors";
import ReportPreview from "../ReportPreview.vue";
import { createLocalFetcher } from "../local-adapter";
import type { ReportTemplate } from "@agile-team/mach-report";

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
    const root = document.createElement("div");
    app.mount(root);
    await vi.waitFor(() => expect(root.textContent).toContain("插件全局组件"));
  });

  it("globalComponent: false 时不注册", () => {
    const app = createApp({ render: () => h("div") });
    app.use(machReportPlugin, { globalComponent: false });
    expect(app.component("MachReportPreview")).toBeUndefined();
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
    const root = document.createElement("div");
    app.mount(root);
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
    const root = document.createElement("div");
    createApp(Probe).mount(root);
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
    app.mount(document.createElement("div"));
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    const [, detail] = onError.mock.calls[0] as [string, { code: string }];
    expect(typeof onError.mock.calls[0]![0]).toBe("string");
    expect(detail.code).toBe("validate");
  });
});
