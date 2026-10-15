import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { effectScope } from "vue";
import type { RenderPlan } from "@agile-team/mach-report";
import ReportPreview from "../ReportPreview.vue";
import { useZoom } from "../composables/useZoom";

const wrappers: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  vi.restoreAllMocks();
  localStorage.removeItem("mach-report:ui");
  localStorage.removeItem("mach-report:ui:wide");
});

function widePlan(): RenderPlan {
  return {
    schemaVersion: "wide-preview-test",
    pages: [{
      layout: "wide", pageWidthMm: 2500, pageHeightMm: 297,
      components: [
        { kind: "text", leftMm: 2400, topMm: 10, widthMm: 90, heightMm: 10, text: "远右命中" },
        { kind: "text", leftMm: 2400, topMm: 30, widthMm: 90, heightMm: 10, text: "远右命中" }
      ]
    }]
  };
}

async function mountWide() {
  const wrapper = mount(ReportPreview, {
    props: { reportId: "wide", fetcher: async () => widePlan(), showExport: false, showPdfWindow: false },
    attachTo: document.body
  });
  wrappers.push(wrapper);
  await vi.waitFor(() => expect(wrapper.find(".mr-page").exists()).toBe(true));
  return wrapper;
}

describe("宽表预览", () => {
  it("默认实际字号，纸张与宽表分别恢复缩放偏好", async () => {
    localStorage.setItem("mach-report:ui", JSON.stringify({ zoomMode: 150 }));
    const wrapper = await mountWide();
    expect(wrapper.classes()).toContain("mrp-wide-report");
    expect(wrapper.find(".mrp-scale-inner").attributes("style")).toContain("scale(1)");
    await wrapper.findAll("button").find((button) => button.text() === "150%")!.trigger("click");
    await vi.waitFor(() => expect(JSON.parse(localStorage.getItem("mach-report:ui:wide")!).zoomMode).toBe(150));
    expect(JSON.parse(localStorage.getItem("mach-report:ui")!).zoomMode).toBe(150);
    wrapper.unmount();
    wrappers.pop();
    const restored = await mountWide();
    expect(restored.find(".mrp-scale-inner").attributes("style")).toContain("scale(1.5)");
  });

  it("适宽以最宽页计算，超宽表不受30%下限限制", async () => {
    const plan = widePlan();
    plan.pages.unshift({ pageWidthMm: 210, pageHeightMm: 297, components: [] });
    const wrapper = mount(ReportPreview, {
      props: { reportId: "mixed", fetcher: async () => plan, autoLoad: false, showExport: false, showPdfWindow: false }
    });
    wrappers.push(wrapper);
    Object.defineProperty(wrapper.find(".mrp-body").element, "clientWidth", { value: 1000 });
    await (wrapper.vm as unknown as { reload(): Promise<void> }).reload();
    const expected = 952 / (2500 * 96 / 25.4);
    await vi.waitFor(() => {
      const transform = wrapper.find(".mrp-scale-inner").attributes("style")!;
      expect(Number(transform.match(/scale\(([^)]+)\)/)![1])).toBeCloseTo(expected);
    });
    expect(expected).toBeLessThan(0.3);
  });

  it("搜索及同页下一处命中会滚动到远右单元格", async () => {
    const scroll = vi.fn();
    vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(scroll);
    const wrapper = await mountWide();
    await wrapper.find('button[aria-label="内容搜索"]').trigger("click");
    await wrapper.find("input.mrp-search-input").setValue("远右命中");
    await vi.waitFor(() => expect(wrapper.find(".mrp-search-count").text()).toBe("1/2"));
    await vi.waitFor(() => expect(scroll).toHaveBeenCalledOnce());
    expect(scroll.mock.contexts[0]).toBe(wrapper.findAll("mark")[0]!.element);
    await wrapper.findAll("button").find((button) => button.text() === "›")!.trigger("click");
    await vi.waitFor(() => expect(wrapper.find(".mrp-search-count").text()).toBe("2/2"));
    await vi.waitFor(() => expect(scroll).toHaveBeenCalledTimes(2));
    expect(scroll.mock.contexts[1]).toBe(wrapper.findAll("mark")[1]!.element);
  });
});

describe("缩放边界与取消", () => {
  it("手动缩放取消排队的适宽，异常百分比不会污染状态，卸载取消rAF", () => {
    let frame: FrameRequestCallback | undefined;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => { frame = callback; return 7; });
    const cancel = vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    const viewport = document.createElement("div");
    Object.defineProperty(viewport, "clientWidth", { value: 1000 });
    const scope = effectScope();
    const state = scope.run(() => useZoom(() => ({ viewport, pageWidthPx: 10000 })))!;
    state.applyFitZoom();
    state.setZoom(100);
    expect(cancel).toHaveBeenCalledWith(7);
    frame?.(0);
    expect(state.zoom.value).toBe(1);
    state.setZoom(Number.NaN);
    state.setZoom(Infinity);
    expect(state.zoom.value).toBe(1);
    state.setZoom(0);
    expect(state.zoom.value).toBe(0.3);
    state.setZoom(999);
    expect(state.zoom.value).toBe(3);
    state.setZoom("fit");
    scope.stop();
    expect(cancel).toHaveBeenCalledTimes(2);
  });
});
