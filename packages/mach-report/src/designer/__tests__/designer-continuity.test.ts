import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, effectScope, h, ref } from "vue";
import { describe, expect, it } from "vitest";
import { createTableTemplate, defineReportTemplate, paginateTemplate, type ListComponent, type ReportTemplateDocument } from "../../index";
import { renderComponent } from "../../render/dom";
import CanvasPrimitivePreview from "../CanvasPrimitivePreview.vue";
import ReportTemplateEditor from "../ReportTemplateEditor.vue";
import TemplateDesignCanvas from "../TemplateDesignCanvas.vue";
import { useTemplateCanvas } from "../useTemplateCanvas";
import { prepareCanvasFields } from "../canvas-field-insertion";

function document(): ReportTemplateDocument {
  return defineReportTemplate({ id: "continuous-designer", name: "连续设计", template: { pages: [{ widthMm: 100, heightMm: 100, components: [
    { kind: "text", leftMm: 10, topMm: 10, widthMm: 20, heightMm: 10, text: "A" },
    { kind: "text", leftMm: 50, topMm: 30, widthMm: 20, heightMm: 10, text: "B" },
    { kind: "text", leftMm: 20, topMm: 70, widthMm: 20, heightMm: 10, text: "C" },
  ] }] } });
}
function canvasHarness() {
  const scope = effectScope(), draft = ref(document()); let transactions = 0;
  const canvas = scope.run(() => useTemplateCanvas(draft, change => {
    const next = JSON.parse(JSON.stringify(draft.value)) as ReportTemplateDocument;
    change(next); draft.value = next; transactions++; return true;
  }))!;
  const select = (index: number, additive = false) => canvas.select({ pageIndex: 0, componentIndex: index, additive });
  const wrapper = mount(defineComponent({ setup: () => () => h(TemplateDesignCanvas, {
    document: draft.value, pageIndex: 0, selection: canvas.selection.value, selections: canvas.selections.value,
    locked: canvas.locked, onSelect: canvas.select, onGeometry: canvas.geometry, onMove: canvas.move, onDelete: canvas.remove, onDuplicate: canvas.duplicate,
  }) }));
  return { canvas, draft, select, wrapper, transactions: () => transactions, close: () => { wrapper.unmount(); scope.stop(); } };
}

describe("continuous multi-selection commands", () => {
  it("moves the whole group with one bounded delta, keeps relative geometry, and skips locked members", async () => {
    const f = canvasHarness(); f.select(2); f.canvas.toggleLock(); f.select(0); f.select(1, true); f.select(2, true); await flushPromises();
    const node = f.wrapper.get('[data-canvas-component="0"]');
    node.element.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 10, clientY: 10 }));
    for (let index = 0; index < 100; index++) window.dispatchEvent(new PointerEvent("pointermove", { clientX: 1000, clientY: 1000 }));
    expect(f.transactions()).toBe(0);
    window.dispatchEvent(new PointerEvent("pointerup")); await flushPromises();
    expect(f.transactions()).toBe(1); expect(f.canvas.selections.value).toHaveLength(3);
    expect(f.draft.value.template.pages[0]!.components.map(item => [item.leftMm, item.topMm])).toEqual([[40, 70], [80, 90], [20, 70]]);
    f.close();
  });
  it("Escape restores every hot node and emits no transaction", async () => {
    const f = canvasHarness(); f.select(0); f.select(1, true); await flushPromises();
    const nodes = f.wrapper.findAll('[data-canvas-component]'), initial = nodes.map(node => node.attributes("style"));
    nodes[0]!.element.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 0, clientY: 0 }));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 50, clientY: 50 }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    window.dispatchEvent(new PointerEvent("pointerup"));
    expect(f.transactions()).toBe(0); expect(nodes.map(node => node.attributes("style"))).toEqual(initial); f.close();
  });
  it("duplicates/deletes unlocked members together and keyboard nudges preserve the selection", async () => {
    const f = canvasHarness(); f.select(2); f.canvas.toggleLock(); f.select(0); f.select(1, true); f.select(2, true); await flushPromises();
    await f.wrapper.get('[data-canvas-component="0"]').trigger("keydown", { key: "ArrowRight", shiftKey: true });
    expect(f.transactions()).toBe(1); expect(f.draft.value.template.pages[0]!.components.map(item => item.leftMm)).toEqual([15, 55, 20]);
    f.canvas.duplicate(); await flushPromises();
    expect(f.transactions()).toBe(2); expect(f.draft.value.template.pages[0]!.components).toHaveLength(5);
    expect(f.canvas.selections.value.map(item => item.componentIndex)).toEqual([3, 4]);
    const copies = f.draft.value.template.pages[0]!.components.slice(3);
    expect(copies.map(item => [item.leftMm, item.topMm])).toEqual([[19, 14], [59, 34]]);
    await f.wrapper.get('[data-canvas-component="3"]').trigger("keydown", { key: "Delete" });
    expect(f.transactions()).toBe(3); expect(f.draft.value.template.pages[0]!.components).toHaveLength(3);
    expect(f.canvas.locked({ pageIndex: 0, componentIndex: 2 })).toBe(true); f.close();
  });
  it("restores the entire group and its selection with one undo/redo frame", async () => {
    const wrapper = mount(ReportTemplateEditor, { props: { modelValue: document(), mode: "design" }, global: { stubs: { ReportPreview: true } } });
    const canvas = wrapper.getComponent(TemplateDesignCanvas);
    await canvas.get('[data-canvas-component="0"]').trigger("pointerdown", { button: 1 });
    await canvas.get('[data-canvas-component="1"]').trigger("pointerdown", { button: 1, ctrlKey: true });
    await canvas.get('[data-canvas-component="0"]').trigger("keydown", { key: "ArrowRight" });
    const positions = () => (wrapper.emitted("update:modelValue")!.at(-1)![0] as ReportTemplateDocument).template.pages[0]!.components.map(item => item.leftMm);
    expect(positions()).toEqual([10.5, 50.5, 20]);
    await wrapper.get('button[aria-label="撤销"]').trigger("click");
    expect(positions()).toEqual([10, 50, 20]); expect(canvas.findAll(".is-selected")).toHaveLength(2);
    await wrapper.get('button[aria-label="重做"]').trigger("click");
    expect(positions()).toEqual([10.5, 50.5, 20]); expect(canvas.findAll(".is-selected")).toHaveLength(2); wrapper.unmount();
  });
});

describe("design/output parity", () => {
  it("renders a real bounded chart and refreshes the same visual from changed source values", async () => {
    const component = { kind: "chart" as const, leftMm: 10, topMm: 10, widthMm: 90, heightMm: 50,
      chartBinding: { dataset: "detail", categoryField: "shift", measures: [{ field: "weight", op: "sum" as const }], type: "bar" as const } };
    const rows = Array.from({ length: 150 }, () => ({ shift: "甲", weight: 1 }));
    const wrapper = mount(CanvasPrimitivePreview, { props: { component, datasets: { detail: rows }, zoom: .8, sampleLabel: "设计样本" } });
    await flushPromises();
    expect(wrapper.get(".mr-canvas-primitive-sample").text()).toBe("设计样本 · 100 / 150");
    expect(wrapper.findAll(".mr-kind-rect").length).toBeGreaterThan(0);
    expect(wrapper.text()).toContain("100");
    await wrapper.setProps({ datasets: { detail: [{ shift: "乙", weight: 42 }] } });
    expect(wrapper.text()).toContain("乙"); expect(wrapper.text()).toContain("42");
    const actual = paginateTemplate({ pages: [{ widthMm: 110, heightMm: 80, components: [component] }] }, { detail: [{ shift: "乙", weight: 42 }] });
    expect(actual.chartComponents).toBe(wrapper.findAll(".mr-canvas-primitive-content > .mr-comp").length); wrapper.unmount();
  });
  it("uses the exact shared DOM renderer for shapes and rich text styling", async () => {
    for (const kind of ["rect", "ellipse", "line", "text"] as const) {
      const component = { kind, leftMm: 10, topMm: 20, widthMm: 30, heightMm: 15, text: "标题", lineDirection: "up" as const, style: { rotateDeg: 15, color: "#123456", backgroundColor: "#eff6ff", borderColor: "#2563eb", bold: true, italic: true, fontSize: 10, align: "center" as const } };
      const wrapper = mount(CanvasPrimitivePreview, { props: { component, zoom: 1.25, sampleLabel: "设计样本" } });
      await flushPromises();
      const expected = renderComponent({ ...component, leftMm: 0, topMm: 0 }, 120, {}, window.document);
      expect(wrapper.get(".mr-canvas-primitive-content").element.innerHTML).toBe(expected.outerHTML); wrapper.unmount();
    }
  });
});

describe("persistent designer viewports", () => {
  it("retains canvas zoom/scroll/selection through preview/tools and resets them for another template", async () => {
    const wrapper = mount(ReportTemplateEditor, { props: { modelValue: document() }, global: { stubs: { ReportPreview: true } } });
    const mode = () => wrapper.findAll(".mr-designer-mode button");
    await mode()[0]!.trigger("click");
    const canvas = wrapper.getComponent(TemplateDesignCanvas), identity = canvas.vm.$.uid;
    await canvas.get('.mr-canvas-toolbar select').setValue("1.25");
    const viewport = canvas.get('.mr-canvas-scroll').element;
    await canvas.get('[data-canvas-component="1"]').trigger("pointerdown", { button: 1 }); await flushPromises();
    viewport.scrollLeft = 23; viewport.scrollTop = 44;
    await mode()[1]!.trigger("click"); expect(canvas.attributes("style")).toContain("display: none");
    await wrapper.findAll('[role="tab"]').find(tab => tab.text() === "工具")!.trigger("click");
    await mode()[0]!.trigger("click");
    expect(wrapper.getComponent(TemplateDesignCanvas).vm.$.uid).toBe(identity);
    expect(canvas.get('.mr-canvas-toolbar select').element).toHaveProperty("value", "1.25");
    expect(viewport.scrollLeft).toBe(23); expect(viewport.scrollTop).toBe(44);
    expect(canvas.get('[data-canvas-component="1"]').attributes("aria-pressed")).toBe("true");
    await wrapper.setProps({ modelValue: { ...document(), id: "different-template" } }); await flushPromises();
    expect(wrapper.getComponent(TemplateDesignCanvas).vm.$.uid).not.toBe(identity);
    expect(wrapper.get('.mr-canvas-toolbar select').element).toHaveProperty("value", "0.8");
    expect(wrapper.findAll('.mr-canvas-component.is-selected')).toHaveLength(0); wrapper.unmount();
  });
});

describe("bulk field insertion", () => {
  const fields = [{ field: "heat", type: "text" as const, label: "炉号" }, { field: "weight", type: "number" as const, label: "重量" }, { field: "energy", type: "number" as const, label: "电量" }];
  it("preflights fixed/wide column widths and keeps equal added columns plus merged header geometry", () => {
    for (const layout of ["page", "wide"] as const) {
      const source = defineReportTemplate({ id: "bulk-columns", name: "字段", template: createTableTemplate({ layout, columns: [{ field: "heat", header: "炉号" }] }) });
      const before = JSON.stringify(source), index = source.template.pages[0]!.components.findIndex(item => item.kind === "list");
      const result = prepareCanvasFields(source, 0, fields.slice(1), { pageIndex: 0, componentIndex: index }, "too large")!;
      const list = result.document.template.pages[0]!.components[index] as ListComponent;
      expect(list.columns.slice(1).map(item => item.widthMm)).toEqual([list.columns[1]!.widthMm, list.columns[1]!.widthMm]);
      expect(result.widthAfter).toBe(layout === "wide" ? result.widthBefore + 56 : result.widthBefore);
      expect(JSON.stringify(source)).toBe(before);
    }
  });
  it("confirms all field/page impacts before mutating, then supports one undo/redo", async () => {
    const source = defineReportTemplate({ id: "bulk-label", name: "标签", template: { repeat: { dataset: "detail" }, pages: [{ widthMm: 50, heightMm: 12, components: [] }] } });
    const wrapper = mount(ReportTemplateEditor, { props: { modelValue: source, dataSchemas: { detail: { fields } } }, global: { stubs: { ReportPreview: true } } });
    await wrapper.get('.mr-insert-trigger').trigger('click'); await wrapper.get('.mr-insert-field').trigger('click');
    for (const name of ["重量", "电量"]) await wrapper.get(`input[aria-label="选择字段 ${name}"]`).setValue(true);
    await wrapper.get('.mr-insert-batch button').trigger('click');
    expect(wrapper.get('.mr-insert-confirm').text()).toContain("添加 2 个字段");
    expect(wrapper.get('.mr-insert-confirm').text()).toContain("每份标签 1 → 2");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    await wrapper.get('.mr-insert-confirm-action').trigger('click');
    const latest = () => wrapper.emitted("update:modelValue")!.at(-1)![0] as ReportTemplateDocument;
    expect(latest().template.pages.flatMap(page => page.components).map(item => item.kind === "list" ? undefined : item.binding?.field)).toEqual(["weight", "energy"]);
    await wrapper.get('button[aria-label="撤销"]').trigger('click'); expect(latest().template.pages).toHaveLength(1); expect(latest().template.pages[0]!.components).toHaveLength(0);
    await wrapper.get('button[aria-label="重做"]').trigger('click'); expect(latest().template.pages).toHaveLength(2); wrapper.unmount();
  });
});
