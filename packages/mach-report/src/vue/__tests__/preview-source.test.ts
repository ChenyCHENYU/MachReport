// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { reactive } from "vue";
import {
  createReportSource,
  type DatasetRows,
  type RenderPlan,
  type ReportFetchInput,
  type ReportRegistry,
  type ReportTemplate
} from "@agile-team/mach-report";
import ReportPreview from "../ReportPreview.vue";
import ReportParamPanel from "../ReportParamPanel.vue";
import { createLocalFetcher } from "../local-adapter";
import type { PlanFetcher } from "../adapters";
import { machReportPlugin } from "../plugin";

const mounted = new Set<VueWrapper>();
function track<T extends VueWrapper>(wrapper: T): T {
  mounted.add(wrapper);
  return wrapper;
}
function unmount(wrapper: VueWrapper): void {
  wrapper.unmount();
  mounted.delete(wrapper);
}
afterEach(() => {
  for (const wrapper of mounted) wrapper.unmount();
  mounted.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function planOf(text: string): RenderPlan {
  return {
    schemaVersion: "test",
    pages: [{
      pageWidthMm: 210,
      pageHeightMm: 100,
      components: [{ kind: "text", leftMm: 10, topMm: 10, widthMm: 100, heightMm: 10, text }]
    }]
  };
}

interface PendingLoad {
  input: ReportFetchInput;
  resolve(plan: RenderPlan): void;
  reject(reason: Error): void;
}
/** 故意忽略取消，用来验证组件也能保护旧宿主 fetcher。 */
function pendingFetcher() {
  const pending: PendingLoad[] = [];
  const fetcher: PlanFetcher = vi.fn((input: ReportFetchInput) => new Promise<RenderPlan>((resolve, reject) => {
    pending.push({ input, resolve, reject });
  }));
  return { fetcher, pending };
}

function templateOf(text: string, defaultValue?: string): ReportTemplate {
  return {
    params: [{ field: "keyword", label: "关键字", placeholder: "输入关键字", required: true, defaultValue }],
    pages: [{
      widthMm: 210,
      heightMm: 100,
      components: [{ kind: "text", leftMm: 10, topMm: 10, widthMm: 100, heightMm: 10, text }]
    }]
  };
}

describe("预览请求生命周期", () => {
  it.each(["reload", "switch", "clear", "unmount"] as const)("%s 立即取消旧请求的 signal", async (action) => {
    const { fetcher, pending } = pendingFetcher();
    const onError = vi.fn();
    const wrapper = track(mount(ReportPreview, { props: { reportId: "A", fetcher, onError } }));
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    const old = pending[0]!;
    expect(old.input.signal).toBeInstanceOf(AbortSignal);
    expect(old.input.signal!.aborted).toBe(false);
    let reloaded: Promise<void> | undefined;
    if (action === "reload") reloaded = (wrapper.vm as unknown as { reload(): Promise<void> }).reload();
    else if (action === "switch") await wrapper.setProps({ reportId: "B" });
    else if (action === "clear") await wrapper.setProps({ reportId: null });
    else unmount(wrapper);
    expect(old.input.signal!.aborted).toBe(true);

    if (action === "reload" || action === "switch") {
      await vi.waitFor(() => expect(pending).toHaveLength(2));
      expect(pending[1]!.input.signal!.aborted).toBe(false);
      pending[1]!.resolve(planOf("当前报表"));
      await reloaded;
      await flushPromises();
      expect(wrapper.text()).toContain("当前报表");
    } else {
      expect(pending).toHaveLength(1);
    }
    old.resolve(planOf("已取消的报表"));
    await flushPromises();
    if (action !== "unmount") expect(wrapper.text()).not.toContain("已取消的报表");
    if (action === "clear") {
      expect(wrapper.find(".mrp-error").text()).toContain("缺少报表 ID");
      expect(onError).toHaveBeenCalledOnce();
      expect(onError.mock.calls[0]![1]).toMatchObject({ code: "param" });
    } else {
      expect(onError).not.toHaveBeenCalled();
    }
  });

  it.each(["resolve", "reject"] as const)("忽略 signal 的旧 fetcher %s 后不污染新计划、事件或日志", async (outcome) => {
    const { fetcher, pending } = pendingFetcher();
    const onLoaded = vi.fn();
    const onError = vi.fn();
    const onWarning = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wrapper = track(mount(ReportPreview, {
      props: { reportId: "A", fetcher, onLoaded, onError, onWarning }
    }));
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    await wrapper.setProps({ reportId: "B" });
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending[1]!.input.onWarning?.("当前分页告警");
    pending[1]!.resolve(planOf("当前计划"));
    await flushPromises();
    expect(wrapper.text()).toContain("当前计划");

    pending[0]!.input.onWarning?.("旧分页告警");
    const readOldPages = vi.fn(() => []);
    if (outcome === "resolve") pending[0]!.resolve({ schemaVersion: "old", get pages() { return readOldPages(); } });
    else pending[0]!.reject(new Error("旧取数失败"));
    await flushPromises();
    expect(readOldPages).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("当前计划");
    expect(wrapper.find(".mrp-error").exists()).toBe(false);
    expect(onLoaded).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
    expect(onWarning.mock.calls).toEqual([["当前分页告警"]]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("卸载后旧 fetcher 的错误和告警不再通知宿主", async () => {
    const { fetcher, pending } = pendingFetcher();
    const onLoaded = vi.fn();
    const onError = vi.fn();
    const onWarning = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wrapper = track(mount(ReportPreview, {
      props: { reportId: "A", fetcher, onLoaded, onError, onWarning }
    }));
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    unmount(wrapper);
    expect(pending[0]!.input.signal!.aborted).toBe(true);
    pending[0]!.input.onWarning?.("卸载后的告警");
    pending[0]!.reject(new Error("卸载后的错误"));
    await flushPromises();
    expect(onLoaded).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onWarning).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(["switch", "clear", "params", "fetcher"] as const)("autoLoad=false 时 %s 仍取消手动请求，但不自动取数", async (action) => {
    const { fetcher, pending } = pendingFetcher();
    const replacement = pendingFetcher();
    const onLoaded = vi.fn();
    const onError = vi.fn();
    const onWarning = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wrapper = track(mount(ReportPreview, {
      props: { reportId: "A", fetcher, autoLoad: false, onLoaded, onError, onWarning }
    }));
    expect(fetcher).not.toHaveBeenCalled();
    const loading = (wrapper.vm as unknown as { reload(): Promise<void> }).reload();
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    if (action === "switch") await wrapper.setProps({ reportId: "B" });
    else if (action === "clear") await wrapper.setProps({ reportId: null });
    else if (action === "params") await wrapper.setProps({ params: { id: "new" } });
    else await wrapper.setProps({ fetcher: replacement.fetcher });
    expect(pending[0]!.input.signal!.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(replacement.fetcher).not.toHaveBeenCalled();
    pending[0]!.input.onWarning?.("已取消手动请求的告警");
    pending[0]!.resolve(planOf("旧手动请求结果"));
    await loading;
    await flushPromises();
    expect(wrapper.text()).not.toContain("旧手动请求结果");
    expect(wrapper.text()).not.toContain("报表渲染中");
    expect(onLoaded).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onWarning).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("响应式 reportId 数组原地 push 触发新 IDs 查询并取消旧请求", async () => {
    const ids = reactive(["A"]);
    const { fetcher, pending } = pendingFetcher();
    const wrapper = track(mount(ReportPreview, { props: { reportId: ids, fetcher } }));
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    expect(pending[0]!.input.reportIds).toEqual(["A"]);
    ids.push("B");
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[0]!.input.signal!.aborted).toBe(true);
    expect(pending[1]!.input.reportIds).toEqual(["A", "B"]);
    pending[1]!.resolve(planOf("A 与 B 的报表"));
    await flushPromises();
    pending[0]!.resolve(planOf("旧 A 报表"));
    await flushPromises();
    expect(wrapper.text()).toContain("A 与 B 的报表");
    expect(wrapper.text()).not.toContain("旧 A 报表");
  });

  it("autoLoad=false 时响应式 ID 数组原地 splice 取消手动请求，不自动查询", async () => {
    const ids = reactive(["A"]);
    const { fetcher, pending } = pendingFetcher();
    const onLoaded = vi.fn();
    const wrapper = track(mount(ReportPreview, {
      props: { reportId: ids, fetcher, autoLoad: false, onLoaded }
    }));
    const loading = (wrapper.vm as unknown as { reload(): Promise<void> }).reload();
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    ids.splice(0, 1, "B");
    await flushPromises();
    expect(pending[0]!.input.signal!.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledOnce();
    pending[0]!.resolve(planOf("旧 A 手动报表"));
    await loading;
    await flushPromises();
    expect(onLoaded).not.toHaveBeenCalled();
    expect(wrapper.text()).not.toContain("旧 A 手动报表");
  });
});

describe("报表元数据与参数面板", () => {
  it.each(["registry", "local"] as const)("%s 自动使用 template.params，切换报表重置同名参数默认值", async (mode) => {
    const reports: ReportRegistry = {
      A: { template: templateOf("报表 A", "A 默认值") },
      B: { template: templateOf("报表 B", "B 默认值") }
    };
    const fetcher = mode === "registry" ? createReportSource(reports) : createLocalFetcher(reports);
    const wrapper = track(mount(ReportPreview, { props: { reportId: "A", fetcher } }));
    await vi.waitFor(() => expect(wrapper.text()).toContain("报表 A"));
    expect(wrapper.findComponent(ReportParamPanel).exists()).toBe(true);
    const field = wrapper.find('input[placeholder="输入关键字"]');
    expect((field.element as HTMLInputElement).value).toBe("A 默认值");
    await field.setValue("上一报表的手工输入");
    await wrapper.setProps({ reportId: "B" });
    await vi.waitFor(() => expect(wrapper.text()).toContain("报表 B"));
    expect((wrapper.find('input[placeholder="输入关键字"]').element as HTMLInputElement).value).toBe("B 默认值");
    await wrapper.setProps({ paramDefs: [] });
    expect(wrapper.findComponent(ReportParamPanel).exists()).toBe(false);
  });

  it("元数据默认值进入首载请求，显式参数覆盖默认值", async () => {
    const load = vi.fn().mockResolvedValue({});
    const fetcher = createReportSource({ A: { template: templateOf("带参数", "模板默认"), load } });
    const wrapper = track(mount(ReportPreview, {
      props: { reportId: "A", fetcher }
    }));
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    expect(load.mock.calls[0]![0]).toMatchObject({ reportId: "A", params: { keyword: "模板默认" } });
    expect((wrapper.find('input[placeholder="输入关键字"]').element as HTMLInputElement).value).toBe("模板默认");
    await wrapper.setProps({ params: { keyword: "宿主参数" } });
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(load.mock.calls[1]![0]).toMatchObject({ reportId: "A", params: { keyword: "宿主参数" } });
    expect((wrapper.find('input[placeholder="输入关键字"]').element as HTMLInputElement).value).toBe("宿主参数");
  });

  it("显式 paramDefs=[] 从首载关闭自动参数面板", async () => {
    const fetcher = createLocalFetcher({ A: { template: templateOf("无面板", "默认值") } });
    const wrapper = track(mount(ReportPreview, { props: { reportId: "A", fetcher, paramDefs: [] } }));
    await vi.waitFor(() => expect(wrapper.text()).toContain("无面板"));
    expect(wrapper.findComponent(ReportParamPanel).exists()).toBe(false);
  });

  it("保留缺必填参数也首载的行为；用户查询时才拦截缺失值", async () => {
    const load = vi.fn().mockResolvedValue({});
    const onError = vi.fn();
    const fetcher = createReportSource({ A: { template: templateOf("首载结果"), load } });
    const wrapper = track(mount(ReportPreview, { props: { reportId: "A", fetcher, onError } }));
    await vi.waitFor(() => expect(wrapper.text()).toContain("首载结果"));
    expect(load).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
    const query = wrapper.findComponent(ReportParamPanel).findAll("button").find((button) => button.text().includes("查"))!;
    await query.trigger("click");
    expect(load).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("关键字"), { code: "param" });
  });
});

describe("数据源结构化错误", () => {
  it.each(["config", "validate", "fetch"] as const)("source %s 错误保留分类进入 error 事件", async (code) => {
    const reports: ReportRegistry = code === "config" ? {} : {
      A: {
        template: templateOf("错误报表"),
        load: code === "fetch"
          ? async () => { throw new Error("业务接口拒绝"); }
          : async () => ({ rows: true }) as unknown as DatasetRows
      }
    };
    const onError = vi.fn();
    const wrapper = track(mount(ReportPreview, {
      props: { reportId: "A", fetcher: createReportSource(reports), onError }
    }));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError.mock.calls[0]![1]).toMatchObject({ code });
    expect(wrapper.find(".mrp-error").exists()).toBe(true);
    expect(wrapper.find(".mrp-retry").exists()).toBe(true);
  });
});

describe("计划告警统一通道", () => {
  it.each(["source", "raw"] as const)("%s 的 2001 页告警只触发一次事件和日志", async (mode) => {
    const pages: ReportTemplate["pages"] = Array.from({ length: 2001 }, () => ({
      widthMm: 210,
      heightMm: 100,
      components: []
    }));
    const fetcher: PlanFetcher = mode === "source"
      ? createReportSource({ BIG: { template: { pages } } })
      : async () => ({
        schemaVersion: "test",
        pages: pages.map((page) => ({
          pageWidthMm: page.widthMm,
          pageHeightMm: page.heightMm,
          components: []
        }))
      });
    const logger = { warn: vi.fn(), info: vi.fn() };
    const onWarning = vi.fn();
    const onLoaded = vi.fn();
    track(mount(ReportPreview, {
      props: { reportId: "BIG", fetcher, onWarning, onLoaded },
      global: { plugins: [[machReportPlugin, { config: { defaults: { logger }, presets: {} } }]] }
    }));
    await vi.waitFor(() => expect(onLoaded).toHaveBeenCalledWith(2001));
    expect(onWarning).toHaveBeenCalledOnce();
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining("2001"));
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("warning 回调同步 reload 时，旧大计划不能覆盖第二次结果或触发 loaded", async () => {
    const large: RenderPlan = {
      schemaVersion: "test",
      pages: Array.from({ length: 2001 }, () => ({
        pageWidthMm: 210,
        pageHeightMm: 100,
        components: []
      }))
    };
    const fetcher = vi.fn<PlanFetcher>()
      .mockResolvedValueOnce(large)
      .mockResolvedValueOnce(planOf("第二次查询的小计划"));
    const logger = { warn: vi.fn(), info: vi.fn() };
    const onLoaded = vi.fn();
    let reloaded!: Promise<void>;
    const onWarning = vi.fn(() => {
      reloaded = (wrapper.vm as unknown as { reload(): Promise<void> }).reload();
    });
    const wrapper = track(mount(ReportPreview, {
      props: { reportId: "BIG", fetcher, onWarning, onLoaded },
      global: { plugins: [[machReportPlugin, { config: { defaults: { logger }, presets: {} } }]] }
    }));
    await vi.waitFor(() => expect(wrapper.text()).toContain("第二次查询的小计划"));
    await reloaded;
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(onWarning).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(onLoaded.mock.calls).toEqual([[1]]);
    expect(wrapper.findAll(".mr-page")).toHaveLength(1);
  });
});
