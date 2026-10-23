import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { effectScope, ref } from "vue";
import { defineReportTemplate, type ReportTemplateDocument } from "../../index";
import { useTemplateCanvas } from "../useTemplateCanvas";
import TemplateDesignCanvas from "../TemplateDesignCanvas.vue";
import CanvasComponentInspector from "../CanvasComponentInspector.vue";

function fixture(): ReportTemplateDocument {
  const columns = [{ field: "id", header: "编号", widthMm: 20 }, { field: "amount", header: "金额", widthMm: 20 }];
  return defineReportTemplate({ id: "flow", name: "区域模板", template: { pages: [{ widthMm: 40, heightMm: 100, layout: "wide", flow: { bands: [{ componentIds: ["title"], topMm: 0, heightMm: 6 }, { componentIds: ["record"], topMm: 6, heightMm: 6 }, { componentIds: ["rows"], topMm: 12, heightMm: 6 }] }, components: [
    { kind: "text", nid: "title", leftMm: 0, topMm: 0, widthMm: 40, heightMm: 6, text: "原始标题" },
    { kind: "list", id: "record", leftMm: 0, topMm: 6, widthMm: 40, rowHeightMm: 6, header: false, cardinality: "record", dataset: "info", columns },
    { kind: "list", id: "rows", leftMm: 0, topMm: 12, widthMm: 40, rowHeightMm: 6, header: false, dataset: "rows", columns },
  ] }] } });
}
describe("region-managed design geometry", () => {
  it("blocks geometry commands before a transaction while content/style mutations and selection remain available", () => {
    const scope = effectScope(), draft = ref(fixture());
    const transaction = vi.fn((change: (document: ReportTemplateDocument) => void) => { const next = JSON.parse(JSON.stringify(draft.value)) as ReportTemplateDocument; change(next); draft.value = next; return true; });
    const canvas = scope.run(() => useTemplateCanvas(draft, transaction))!;
    canvas.select({ pageIndex: 0, componentIndex: 0 });
    canvas.geometry({ leftMm: 4, topMm: 4, widthMm: 20, heightMm: 8 }); canvas.insert("rect"); canvas.remove(); canvas.duplicate(); canvas.reorder(1);
    canvas.select({ pageIndex: 0, componentIndex: 1, additive: true }); canvas.select({ pageIndex: 0, componentIndex: 2, additive: true });
    canvas.align("right"); canvas.distribute("vertical");
    expect(canvas.geometryDisabled.value).toBe(true); expect(transaction).not.toHaveBeenCalled(); expect(canvas.selections.value).toHaveLength(3);
    canvas.select({ pageIndex: 0, componentIndex: 0 }); canvas.mutate(component => { if (component.kind === "text") component.text = "可修改标题"; });
    expect(transaction).toHaveBeenCalledTimes(1); expect(draft.value.template.pages[0]!.components[0]).toMatchObject({ text: "可修改标题", topMm: 0 });
    scope.stop();
  });
  it("keeps flow selection and field inspection without enabling pointer, keyboard, or resize geometry", async () => {
    const wrapper = mount(TemplateDesignCanvas, { props: { document: fixture(), pageIndex: 0, selection: { pageIndex: 0, componentIndex: 1 }, datasets: { info: [{ id: "INFO-1", amount: 0 }, { id: "INFO-2", amount: 9 }], rows: [{ id: "ROW-1", amount: 1 }, { id: "ROW-2", amount: 2 }] } } });
    const record = wrapper.get('[data-canvas-component="1"]');
    await record.trigger("pointerdown", { button: 0, clientX: 1, clientY: 1 });
    await record.trigger("keydown", { key: "ArrowDown" });
    expect(wrapper.emitted("select")).toHaveLength(1); expect(wrapper.emitted("geometry")).toBeUndefined();
    expect(wrapper.findAll(".mr-canvas-resize, .mr-canvas-column-handle")).toHaveLength(0);
    expect(wrapper.findAll(".is-header")).toHaveLength(0);
    expect(wrapper.text()).toContain("INFO-1"); expect(wrapper.text()).not.toContain("INFO-2"); expect(wrapper.text()).not.toContain("ROW-2");
    const style = (record.element as HTMLElement).style;
    expect(parseFloat(style.height)).toBeCloseTo(parseFloat(style.top), 5); // Both are exactly 6 mm, independent of viewport zoom.
    wrapper.unmount();
  });
  it("disables only the inspector's position and page anchors, retaining text and style controls", async () => {
    const wrapper = mount(CanvasComponentInspector, { props: { component: fixture().template.pages[0]!.components[0]!, geometryDisabled: true } });
    const dimensions = wrapper.get(".mr-component-position").findAll("input");
    expect(dimensions.every(input => input.attributes("disabled") !== undefined)).toBe(true);
    expect(wrapper.get(".mr-component-position select").attributes("disabled")).toBeDefined();
    await dimensions[0]!.trigger("change"); expect(wrapper.emitted("geometry")).toBeUndefined();
    expect(wrapper.get("textarea").attributes("disabled")).toBeUndefined();
    await wrapper.get("textarea").setValue("业务标题"); await wrapper.get("textarea").trigger("change");
    expect(wrapper.emitted("patch")?.[0]).toEqual([{ text: "业务标题" }]);
    wrapper.unmount();
  });
});
