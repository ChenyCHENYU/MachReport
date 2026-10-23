import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, reactive } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineReportTemplate, type ReportTemplateDocument } from "../../index";
import { useCanvasViewport } from "../useCanvasViewport";
import { CANVAS_MM_TO_PX } from "../canvas-commands";

function fixture(repeated = true): ReportTemplateDocument {
  return defineReportTemplate({ id: "viewport", name: "标签视口", template: { ...(repeated ? { repeat: { dataset: "labels" } } : {}), pages: [{ widthMm: repeated ? 80 : 210, heightMm: repeated ? 55 : 297, components: [] }] } });
}
function harness(document = fixture()) {
  let notify: (() => void) | undefined;
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { notify = callback; } observe() {} disconnect = disconnect; });
  const props = reactive({ document, pageIndex: 0 });
  let viewport!: ReturnType<typeof useCanvasViewport>;
  const wrapper = mount(defineComponent({ setup() { viewport = useCanvasViewport(props); return () => h("div", { ref: viewport.viewport }); } }));
  async function measure(width: number, height: number) {
    Object.defineProperties(wrapper.element, {
      clientWidth: { configurable: true, value: width }, clientHeight: { configurable: true, value: height },
      scrollWidth: { configurable: true, value: width }, scrollHeight: { configurable: true, value: height },
    });
    notify?.(); await flushPromises();
  }
  return { props, wrapper, viewport, measure, disconnect };
}
afterEach(() => vi.unstubAllGlobals());
describe("label canvas viewport intent", () => {
  it("fits a visible label to the actual host viewport, caps at 200%, and refits paper changes until manual zoom", async () => {
    const { props, wrapper, viewport, measure, disconnect } = harness();
    expect(viewport.zoom.value).toBe(.8); // Hidden/zero-sized mount must wait for a measurable viewport.
    await measure(1000, 600); expect(viewport.zoom.value).toBe(2);
    await measure(600, 400); expect(viewport.zoom.value).toBeCloseTo(360 / (55 * CANVAS_MM_TO_PX));
    props.document.template.pages[0]!.heightMm = 100; await flushPromises();
    expect(viewport.zoom.value).toBeCloseTo(360 / (100 * CANVAS_MM_TO_PX));
    viewport.setZoom(1.25);
    props.document.template.pages[0]!.heightMm = 120; await flushPromises(); await measure(900, 600);
    expect(viewport.zoom.value).toBe(1.25);
    wrapper.unmount(); expect(disconnect).toHaveBeenCalledOnce();
  });
  it("explicit fit remains a user choice and a new template gets its own initial label fit", async () => {
    const { props, wrapper, viewport, measure } = harness();
    await measure(600, 400); viewport.fit("width"); const chosen = viewport.zoom.value;
    props.document.template.pages[0]!.heightMm = 100; await flushPromises(); await measure(1000, 700);
    expect(viewport.zoom.value).toBe(chosen);
    props.document = { ...fixture(), id: "new-label" }; await flushPromises(); expect(viewport.zoom.value).toBe(2);
    wrapper.unmount();
  });
  it("ordinary A4 and wide reports keep 80% and are not automatically resized", async () => {
    const { props, wrapper, viewport, measure } = harness(fixture(false));
    await measure(1000, 600); expect(viewport.zoom.value).toBe(.8);
    props.document.template.pages[0]!.layout = "wide"; props.document.template.pages[0]!.widthMm = 1200;
    await measure(600, 400); expect(viewport.zoom.value).toBe(.8);
    viewport.fit("page"); expect(viewport.zoom.value).toBeLessThan(.8); wrapper.unmount();
  });
});
