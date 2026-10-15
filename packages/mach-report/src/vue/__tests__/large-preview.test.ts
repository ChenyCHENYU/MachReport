import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { effectScope, shallowRef } from "vue";
import { renderPage, type PlanComponent, type RenderPlan } from "@agile-team/mach-report";
import ReportPreview from "../ReportPreview.vue";
import { useReportSearch } from "../composables/useReportSearch";
import { highlightTextNodes } from "../composables/useHighlight";
import { usePageWindow } from "../composables/usePageWindow";
import { resolveConfig, defineMachReportConfig } from "../config";

const wrappers: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.removeItem("mach-report:ui");
});

function planOf(count: number, text = (page: number) => `第 ${page + 1} 页`): RenderPlan {
  return {
    schemaVersion: "large-preview-test",
    pages: Array.from({ length: count }, (_, page) => ({
      pageWidthMm: 210, pageHeightMm: 297,
      components: [{ kind: "text", leftMm: 10, topMm: 10, widthMm: 190, heightMm: 10, text: text(page) }]
    }))
  };
}

describe("大计划预览的有界交互", () => {
  it("1000 页正文和缩略图都保持有界，跳到第 700 页实际渲染新内容", async () => {
    const wrapper = mount(ReportPreview, {
      props: { reportId: "large", fetcher: async () => planOf(1000), height: "800px", showExport: false, showPdfWindow: false }
    });
    wrappers.push(wrapper);
    await vi.waitFor(() => expect(wrapper.find(".mr-page").exists()).toBe(true));
    expect(wrapper.findAll(".mrp-page-holder").length).toBeLessThanOrEqual(4);
    const controller = wrapper.vm as unknown as { gotoPage(page: number): void };
    controller.gotoPage(700);
    await vi.waitFor(() => expect(wrapper.find('[data-page="700"] .mr-page').text()).toContain("第 700 页"));
    expect(wrapper.find('[data-page="1"]').exists()).toBe(false);
    const button = wrapper.findAll("button").find((entry) => entry.text().includes("缩略图"))!;
    await button.trigger("click");
    await vi.waitFor(() => expect(wrapper.findAll("[data-thumb]").length).toBeGreaterThan(0));
    expect(wrapper.findAll("[data-thumb]").length).toBeLessThanOrEqual(7);
    const sidebar = wrapper.find(".mrp-thumbs").element as HTMLElement;
    sidebar.scrollTop = 500 * 192;
    await wrapper.find(".mrp-thumbs").trigger("scroll");
    await vi.waitFor(() => expect(wrapper.find('[data-thumb="1"]').exists()).toBe(false));
    expect(wrapper.findAll("[data-thumb]").length).toBeLessThanOrEqual(7);
    await button.trigger("click");
    expect(wrapper.findAll("[data-thumb]")).toHaveLength(0);
  });

  it("分片扫描可取消，旧输入/换计划/卸载不会发布过期结果或跳页", async () => {
    vi.useFakeTimers();
    const scope = effectScope();
    const plan = shallowRef<RenderPlan | null>(planOf(5000, () => "钢"));
    const goto = vi.fn();
    const search = scope.run(() => useReportSearch({
      plan, gotoPage: goto, debounceMs: 0, highlight: () => 0, clearHighlights: () => {}
    }))!;
    search.onInput("钢");
    await vi.advanceTimersByTimeAsync(0);
    expect(search.searching.value).toBe(true);
    expect(search.matchCount.value).toBe(0);
    search.onInput("不存在");
    expect(search.query.value).toBe("不存在");
    expect(search.matchCount.value).toBe(0);
    search.onNav(1);
    expect(goto).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(search.query.value).toBe("不存在");
    expect(search.matchCount.value).toBe(0);
    expect(goto).not.toHaveBeenCalled();
    search.onInput("钢");
    await vi.advanceTimersByTimeAsync(0);
    plan.value = planOf(1, () => "新数据");
    await vi.runAllTimersAsync();
    expect(search.query.value).toBe("");
    expect(goto).not.toHaveBeenCalled();
    search.onInput("新数据");
    scope.stop();
    await vi.runAllTimersAsync();
    expect(goto).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("100 万次重复文本命中按页累计，前后循环导航保持精确", async () => {
    vi.useFakeTimers();
    const scope = effectScope();
    const plan = shallowRef<RenderPlan | null>(planOf(1000, () => "钢".repeat(1000)));
    const goto = vi.fn();
    const search = scope.run(() => useReportSearch({
      plan, gotoPage: goto, debounceMs: 0, highlight: () => 0, clearHighlights: () => {}
    }))!;
    search.onInput("钢");
    await vi.runAllTimersAsync();
    expect(search.matchCount.value).toBe(1000000);
    expect(goto).toHaveBeenLastCalledWith(1);
    search.onNav(-1);
    expect(search.matchIndex.value).toBe(999999);
    expect(goto).toHaveBeenLastCalledWith(1000);
    search.onNav(1);
    expect(search.matchIndex.value).toBe(0);
    expect(goto).toHaveBeenLastCalledWith(1);
    scope.stop();
  });

  it("只搜索实际显示的折行/富文本/子组件文字，忽略未显示的原始文本", async () => {
    vi.useFakeTimers();
    const scope = effectScope();
    const source = planOf(1);
    const text = source.pages[0]!.components[0]!;
    text.text = "隐藏钢";
    text.lines = ["钢", "钢"];
    source.pages[0]!.components.push({
      ...text, lines: undefined,
      richParagraphs: [{ segments: [{ text: "钢" }, { kind: "field", field: "钢" }] }]
    }, {
      kind: "rect", leftMm: 10, topMm: 20, widthMm: 100, heightMm: 20,
      grid: { cells: [[{ text: "钢", children: [{ ...text, lines: undefined, text: "钢" }] }]] }
    });
    const search = scope.run(() => useReportSearch({
      plan: shallowRef(source), gotoPage: () => {}, debounceMs: 0, highlight: () => 0, clearHighlights: () => {}
    }))!;
    search.onInput("钢");
    await vi.runAllTimersAsync();
    expect(search.matchCount.value).toBe(6);
    search.onInput("隐藏");
    await vi.runAllTimersAsync();
    expect(search.matchCount.value).toBe(0);
    scope.stop();
  });

  it("图片/文本/网格/未知占位的搜索计数与真实DOM高亮一致", async () => {
    vi.useFakeTimers();
    const scope = effectScope();
    const source = planOf(1);
    const base = { leftMm: 10, topMm: 10, widthMm: 100, heightMm: 10 };
    source.pages[0]!.components = [
      { ...base, kind: "text", text: "钢", grid: { cells: [[{ text: "隐藏钢" }]] } },
      { ...base, kind: "chart", imageData: "data:image/png;base64,iVBORw0KGgo=", grid: { cells: [[{ text: "隐藏钢" }]] } },
      { ...base, kind: "rect", grid: { cells: [[{ text: "钢", children: [{ ...base, kind: "text", text: "钢" }] }]] } },
      { ...base, kind: "custom", fallbackText: "钢" } as unknown as PlanComponent,
      { ...base, kind: "line", fallbackText: "隐藏钢" }
    ];
    const page = renderPage(source.pages[0]!, 96, {}, document);
    const search = scope.run(() => useReportSearch({
      plan: shallowRef(source), gotoPage: () => {}, debounceMs: 0, highlight: highlightTextNodes, clearHighlights: () => {}
    }))!;
    try {
      search.onInput("钢");
      await vi.runAllTimersAsync();
      expect(search.matchCount.value).toBe(4);
      expect(highlightTextNodes(page, "钢")).toBe(search.matchCount.value);
      search.onInput("隐藏");
      await vi.runAllTimersAsync();
      expect(search.matchCount.value).toBe(0);
    } finally {
      scope.stop();
    }
  });

  it("卸载取消正文 scroll rAF，随后旧回调不触发 DOM 读取或状态变更", () => {
    const scope = effectScope();
    const raf = vi.spyOn(globalThis, "requestAnimationFrame").mockReturnValue(123);
    const cancel = vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    const window = scope.run(() => usePageWindow(shallowRef(planOf(1000)), shallowRef(1)))!;
    const handler = window.makeScrollHandler(shallowRef(1), shallowRef(1000));
    handler(document.createElement("div"));
    expect(raf).toHaveBeenCalledOnce();
    scope.stop();
    expect(cancel).toHaveBeenCalledWith(123);
  });

  it("preview 按字段继承并限制异常值，默认不需要消费方传配置", () => {
    const config = defineMachReportConfig({
      defaults: { preview: { overscanPages: 2, searchDebounceMs: 350 }, xlsx: { sheetName: (i) => `报表${i + 1}` } },
      presets: { quick: { preview: { searchDebounceMs: 0 } } }, defaultPreset: "quick"
    });
    expect(resolveConfig(config).preview).toEqual({ overscanPages: 2, searchDebounceMs: 0 });
    expect(resolveConfig(config).xlsx.sheetName?.(0)).toBe("报表1");
    expect(resolveConfig(null).preview).toEqual({ overscanPages: 1, searchDebounceMs: 200 });
    expect(resolveConfig(defineMachReportConfig({ defaults: { preview: { overscanPages: -9, searchDebounceMs: Number.NaN } } })).preview)
      .toEqual({ overscanPages: 0, searchDebounceMs: 200 });
    expect(resolveConfig(defineMachReportConfig({ defaults: { preview: { overscanPages: 1000, searchDebounceMs: 10000 } } })).preview)
      .toEqual({ overscanPages: 10, searchDebounceMs: 2000 });
  });

  it("搜索零命中显示 0/0", async () => {
    const wrapper = mount(ReportPreview, {
      props: { reportId: "empty-search", fetcher: async () => planOf(1), showExport: false, showPdfWindow: false }
    });
    wrappers.push(wrapper);
    await vi.waitFor(() => expect(wrapper.find(".mr-page").exists()).toBe(true));
    await wrapper.find('button[aria-label="内容搜索"]').trigger("click");
    await wrapper.find("input.mrp-search-input").setValue("不存在");
    await vi.waitFor(() => expect(wrapper.find(".mrp-search-count").text()).toBe("0/0"));
  });
});
