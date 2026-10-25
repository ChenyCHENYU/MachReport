import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref, shallowRef } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import type { RenderPlan } from "@agile-team/mach-report";
import { usePageRendering } from "../composables/usePageRendering";
const wrappers: VueWrapper[] = [];
let frames: Map<number, FrameRequestCallback>, frameId: number;
beforeEach(() => {
  frames = new Map(); frameId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.unstubAllGlobals(); document.body.replaceChildren(); });
function tick(): void {
  const next = frames.entries().next().value as [number, FrameRequestCallback] | undefined;
  if (!next) throw new Error("No scheduled frame");
  frames.delete(next[0]); next[1](0);
}

it("retains a disabled, unfocused editor during scrolling and defers renderer-mode changes until it closes", async () => {
  const root = ref<HTMLElement | null>(null), viewport = ref<HTMLElement | null>(null), query = ref("");
  const editorToken = ref(0), highlighted = vi.fn();
  const current = shallowRef<RenderPlan | null>({ schemaVersion: "1.0", pages: [{ layout: "wide", pageWidthMm: 2000, pageHeightMm: 100,
    components: [{ kind: "rect", leftMm: 0, topMm: 0, widthMm: 2000, heightMm: 100,
      grid: { cells: Array.from({ length: 10 }, (_, row) => Array.from({ length: 120 }, (_, column) => ({ text: `${row}:${column}` }))) } }] }] });
  let api!: ReturnType<typeof usePageRendering>;
  const wrapper = mount(defineComponent({ setup() {
    api = usePageRendering({ plan: current, root, viewport, pages: () => [{ index: 0 }], priority: () => 0, focusToken: () => null,
      editorToken: () => editorToken.value, query: () => query.value, zoom: () => 1, loading: () => "Loading", clear() {}, highlight: highlighted, mounted() {}, ready() {}, error: cause => { throw cause; } });
    return () => h("div", { ref: viewport }, [h("main", { ref: root }, [h("div", { class: "mrp-page-holder", "data-page": "1" })])]);
  } }), { attachTo: document.body });
  wrappers.push(wrapper); await nextTick();
  Object.defineProperties(viewport.value!, { clientWidth: { value: 200 }, clientHeight: { value: 200 } });
  api.prioritize(0); await nextTick();
  expect(wrapper.findAll("td").length).toBeLessThan(200);
  const cell = wrapper.find("td").element, editor = document.createElement("span"), input = document.createElement("input");
  editor.className = "mrp-cell-editor-host"; input.disabled = true; editor.append(input); cell.append(editor);
  let shifted = false;
  viewport.value!.getBoundingClientRect = () => ({ left: shifted ? 7000 : 0, top: 0, width: 200, height: 200 } as DOMRect);
  shifted = true; api.refreshViewport(); tick();
  expect(editor.isConnected).toBe(true);
  query.value = "pending"; await nextTick();
  expect(editor.isConnected).toBe(true); expect(wrapper.findAll("td").length).toBeLessThan(200);
  editor.remove(); editorToken.value++; await nextTick();
  expect(wrapper.findAll("td")).toHaveLength(1200); expect(highlighted).toHaveBeenCalled();
});
