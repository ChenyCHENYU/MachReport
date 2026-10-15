import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ReportPreview from "../ReportPreview.vue";
import type { PlanFetcher } from "../adapters";
import type { RenderPlan } from "@agile-team/mach-report";

describe("坏数据防御", () => {
  it("卸载后保留的控制器不能再次取数或发出事件", async () => {
    const fetcher = vi.fn<PlanFetcher>(async () => ({ schemaVersion: "t", pages: [] }));
    const onLoaded = vi.fn();
    const onError = vi.fn();
    const wrapper = mount(ReportPreview, {
      props: { reportId: "X", fetcher, autoLoad: false, onLoaded, onError }
    });
    const controller = wrapper.vm as unknown as { reload(): Promise<void>; setParams(values: Record<string, string>): Promise<void> };
    wrapper.unmount();
    await controller.reload();
    await controller.setParams({ date: "2026-10-15" });
    await flushPromises();
    expect(fetcher).not.toHaveBeenCalled();
    expect(onLoaded).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it.each(["reportId", "fetcher"] as const)("加载中移除 %s 后显示错误，旧请求不能恢复加载状态", async (field) => {
    let finish!: (plan: RenderPlan) => void;
    const fetcher = vi.fn<PlanFetcher>(() => new Promise((resolve) => { finish = resolve; }));
    const wrapper = mount(ReportPreview, { props: { reportId: "X", fetcher } });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    await wrapper.setProps(field === "reportId" ? { reportId: null } : { fetcher: null });
    expect(wrapper.find(".mrp-error").exists()).toBe(true);
    finish({ schemaVersion: "t", pages: [] });
    await flushPromises();
    expect(wrapper.find(".mrp-error").exists()).toBe(true);
    wrapper.unmount();
  });

  it.each(["resolve", "reject"] as const)("卸载后请求 %s 不再发出 loaded/error", async (outcome) => {
    let finish!: () => void;
    const readPages = vi.fn();
    const latePlan: RenderPlan = {
      schemaVersion: "t",
      get pages() {
        readPages();
        return [];
      }
    };
    const fetcher: PlanFetcher = () => new Promise((resolve, reject) => {
      finish = () => outcome === "resolve"
        ? resolve(latePlan)
        : reject(new Error("late failure"));
    });
    const onLoaded = vi.fn();
    const onError = vi.fn();
    const wrapper = mount(ReportPreview, { props: { reportId: "X", fetcher, onLoaded, onError } });
    wrapper.unmount();
    finish();
    await flushPromises();
    expect(onLoaded).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(readPages).not.toHaveBeenCalled(); // 卸载后的结果连计划校验也不再执行
  });

  it("fetcher 返回坏计划时给出行级校验错误", async () => {
    const badFetcher = (async () => ({
      schemaVersion: "x",
      pages: [{ pageWidthMm: -1, pageHeightMm: "abc" as unknown as number, components: "oops" as unknown as [] }]
    })) as unknown as PlanFetcher;
    const onError = vi.fn();
    const wrapper = mount(ReportPreview, {
      props: { reportId: "X", fetcher: badFetcher, onError }
    });
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    const msg = String(onError.mock.calls[0]![0]);
    expect(msg).toContain("渲染计划校验失败");
    expect(msg).toContain("$.pages.0");
    expect(wrapper.text()).toContain("校验失败");
  });

  it("未知 kind 走 warning 不阻断渲染", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetcher = (async () => ({
      schemaVersion: "x",
      pages: [
        {
          pageWidthMm: 210,
          pageHeightMm: 297,
          components: [
            { kind: "mystery", leftMm: 0, topMm: 0, widthMm: 40, heightMm: 10, fallbackText: "兜底" }
          ]
        }
      ]
    })) as unknown as PlanFetcher;
    const onLoaded = vi.fn();
    const wrapper = mount(ReportPreview, {
      props: { reportId: "X", fetcher, onLoaded }
    });
    await vi.waitFor(() => expect(onLoaded).toHaveBeenCalled());
    expect(wrapper.text()).toContain("兜底");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
