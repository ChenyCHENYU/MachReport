import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref, shallowRef } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import type { RenderPlan } from "@agile-team/mach-report";
import { usePageRendering } from "../composables/usePageRendering";

const wrappers: VueWrapper[] = [];
let frames: Map<number, FrameRequestCallback>;
let frameId: number;
beforeEach(() => {
  frames = new Map(); frameId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});
afterEach(() => { wrappers.splice(0).forEach((wrapper) => wrapper.unmount()); vi.unstubAllGlobals(); document.body.replaceChildren(); });
function plan(prefix = "A"): RenderPlan {
  return { schemaVersion: "pages", pages: Array.from({ length: 4 }, (_, index) => ({ pageWidthMm: 100, pageHeightMm: 50 + index, components: [{ kind: "rect", leftMm: 1, topMm: 1, widthMm: 80, heightMm: 20, grid: { colWidthsMm: [40, 40], cells: [[{ text: `${prefix}-${index}`, colSpan: 2 }]] } }] })) };
}
async function fixture(priorityPage = 0) {
  const current = shallowRef<RenderPlan | null>(plan());
  const visible = shallowRef([0, 1, 2]);
  const priority = ref(priorityPage), query = ref(""), focusToken = ref(0);
  const root = ref<HTMLElement | null>(null);
  const mounted = vi.fn(), ready = vi.fn(), clear = vi.fn(), error = vi.fn();
  const highlight = vi.fn((element: HTMLElement) => element.setAttribute("data-query", query.value));
  let api!: ReturnType<typeof usePageRendering>;
  const wrapper = mount(defineComponent({ setup() {
    api = usePageRendering({ plan: current, root, pages: () => visible.value.map((index) => ({ index })), priority: () => priority.value, focusToken: () => focusToken.value, query: () => query.value, zoom: () => 0.5, loading: () => "正在呈现报表", clear, highlight, mounted, ready, error });
    return () => h("main", { ref: root }, visible.value.map((index) => h("div", { key: index, class: "mrp-page-holder", "data-page": index + 1 })));
  } }), { attachTo: document.body });
  wrappers.push(wrapper); await nextTick();
  return { api, wrapper, current, visible, priority, query, focusToken, mounted, ready, clear, highlight, error };
}
function tick(): void {
  const next = frames.entries().next().value as [number, FrameRequestCallback] | undefined;
  if (!next) throw new Error("No scheduled frame");
  frames.delete(next[0]); next[1](0);
}

describe("incremental page rendering", () => {
  it("renders priority synchronously, fixes placeholder geometry and mounts exactly one other page per frame", async () => {
    const { wrapper, mounted } = await fixture(1);
    expect(wrapper.findAll(".mr-page")).toHaveLength(1);
    expect(wrapper.find('[data-page="2"] .mr-page').text()).toBe("A-1");
    const first = wrapper.find<HTMLElement>('[data-page="1"]');
    expect(Number.parseFloat(first.element.style.width)).toBeCloseTo(100 * 96 / 25.4);
    expect(Number.parseFloat(first.element.style.height)).toBeCloseTo(50 * 96 / 25.4);
    expect(first.attributes("aria-busy")).toBe("true");
    expect(first.find(".mrp-page-loading").text()).toBe("正在呈现报表");
    tick(); expect(wrapper.findAll(".mr-page")).toHaveLength(2);
    expect(first.attributes("aria-busy")).toBeUndefined();
    expect(first.find("td").attributes("colspan")).toBe("2");
    tick(); expect(wrapper.findAll(".mr-page")).toHaveLength(3);
    expect(mounted).toHaveBeenCalledTimes(3); expect(frames.size).toBe(0);
  });
  it("keeps cached DOM and active controls, re-highlights only changed queries and adds no synchronous background work", async () => {
    const { wrapper, query, focusToken, highlight, clear, visible } = await fixture();
    tick(); tick();
    const element = wrapper.find('[data-page="1"] .mr-page').element;
    const input = document.createElement("input"); element.append(input); input.focus();
    highlight.mockClear();
    focusToken.value++; await nextTick();
    expect(highlight).not.toHaveBeenCalled();
    query.value = "new"; await nextTick();
    expect(highlight).toHaveBeenCalledTimes(3); expect(clear).toHaveBeenCalledTimes(3);
    expect(wrapper.find('[data-page="1"] .mr-page').element).toBe(element);
    expect(document.activeElement).toBe(input);
    visible.value = [0, 1, 2, 3]; await nextTick();
    expect(wrapper.findAll(".mr-page")).toHaveLength(3);
    expect(wrapper.find('[data-page="4"]').attributes("aria-busy")).toBe("true");
    tick(); expect(wrapper.findAll(".mr-page")).toHaveLength(4);
  });
  it("invalidates queued frames on plan replacement and query changes without losing the newer scheduled frame", async () => {
    const { wrapper, current, query } = await fixture();
    const stale = [...frames.values()][0]!;
    current.value = plan("B"); query.value = "latest"; await nextTick();
    expect(wrapper.find('[data-page="1"] .mr-page').text()).toBe("B-0");
    stale(0); expect(frames.size).toBe(1);
    expect(wrapper.findAll(".mr-page")).toHaveLength(1);
    tick();
    expect(wrapper.find('[data-page="2"] .mr-page').text()).toBe("B-1");
    expect(wrapper.find('[data-page="2"] .mr-page').attributes("data-query")).toBe("latest");
  });
  it("cancels queued pages removed from the window and all late work after unmount", async () => {
    const { wrapper, visible, priority, mounted } = await fixture();
    const stale = [...frames.values()][0]!;
    const detached = wrapper.find('[data-page="2"]').element;
    visible.value = [3]; priority.value = 3; await nextTick();
    expect(wrapper.find('[data-page="4"] .mr-page').text()).toBe("A-3");
    stale(0); expect(detached.querySelector(".mr-page")).toBeNull();
    visible.value = [2, 3]; await nextTick();
    const late = [...frames.values()][0]!;
    const count = mounted.mock.calls.length;
    wrapper.unmount();
    expect(frames.size).toBe(0); late(0);
    expect(mounted).toHaveBeenCalledTimes(count);
  });
  it("clears loading and reports a failed background page instead of leaving a permanent busy placeholder", async () => {
    const { wrapper, highlight, error } = await fixture();
    highlight.mockImplementationOnce(() => { throw new Error("page rendering failed"); });
    tick();
    const failed = wrapper.find('[data-page="2"]');
    expect(failed.attributes("aria-busy")).toBeUndefined();
    expect(failed.find(".mrp-page-loading").exists()).toBe(false);
    expect(failed.find('[role="alert"]').text()).toBe("page rendering failed");
    expect(error).toHaveBeenCalledOnce();
  });
  it("makes an explicit keyboard/page target ready by nextTick even while search priority points elsewhere", async () => {
    const { api, wrapper } = await fixture();
    expect(wrapper.find('[data-page="3"] .mr-page').exists()).toBe(false);
    api.prioritize(2); await nextTick();
    expect(wrapper.find('[data-page="3"] .mr-page').text()).toBe("A-2");
    expect(wrapper.find('[data-page="2"] .mr-page').exists()).toBe(false);
    expect(frames.size).toBe(1);
  });
});
