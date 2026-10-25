import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ChartBindingInspector from "../ChartBindingInspector.vue";
import { defineReportTemplate } from "../../source/template-registry";
import { createTableTemplate } from "../../builder/table-template";
import ReportTemplateEditor from "../ReportTemplateEditor.vue";
import { nextTick } from "vue";
describe("chart field binding designer", () => {
  it("edits shared binding declarations and exposes category/measure choices without JSON", async () => {
    const wrapper = mount(ChartBindingInspector, { props: { component: { kind: "chart", leftMm: 0, topMm: 0, widthMm: 100, heightMm: 60,
      chartBinding: { dataset: "detail", categoryField: "shift", measures: [{ op: "sum", field: "qty" }], type: "bar" } },
      schemas: { detail: { fields: [{ field: "shift", type: "text", label: "班别" }, { field: "qty", type: "number", label: "产重" }] } } } });
    expect(wrapper.text()).toContain("产重");
    await wrapper.find('select[aria-label="聚合方式"]').setValue("avg");
    expect(wrapper.emitted("change")?.[0]?.[0]).toMatchObject({ measures: [{ field: "qty", op: "avg" }] });
    await wrapper.find('button').trigger("click");
    expect((wrapper.emitted("change")?.at(-1)?.[0] as { measures: unknown[] }).measures).toHaveLength(2);
    wrapper.unmount();
  });
  it("inserts a chart through the real editor and preserves undo/redo and preview source", async () => {
    const document = defineReportTemplate({ id: "chart-designer", name: "Chart", template: createTableTemplate({ columns: [{ header: "分类", field: "field" }, { header: "数值", field: "value" }] }) });
    const wrapper = mount(ReportTemplateEditor, { props: { modelValue: document, datasets: { detail: [{ field: "甲", value: 3 }] } } });
    const controller = wrapper.vm as unknown as { insertComponent: (component: Record<string, unknown>) => boolean };
    expect(controller.insertComponent({ kind: "chart", leftMm: 10, topMm: 100, widthMm: 100, heightMm: 60, chartBinding: { dataset: "detail", categoryField: "field", measures: [{ field: "value", op: "sum" }], type: "line" } })).toBe(true);
    const next = wrapper.emitted("update:modelValue")?.at(-1)?.[0] as { template: { pages: { components: { kind: string }[] }[] } };
    expect(next.template.pages[0]!.components.at(-1)!.kind).toBe("chart");
    await nextTick();
    await wrapper.get('button[aria-label="撤销"]').trigger("click");
    const undone = wrapper.emitted("update:modelValue")?.at(-1)?.[0] as typeof next;
    expect(undone.template.pages[0]!.components.some(item => item.kind === "chart")).toBe(false);
    await wrapper.get('button[aria-label="重做"]').trigger("click");
    const redone = wrapper.emitted("update:modelValue")?.at(-1)?.[0] as typeof next;
    expect(redone.template.pages[0]!.components.at(-1)!.kind).toBe("chart");
    wrapper.unmount();
  });
  it("uses explicit decimal schema fields and makes weighted-average configuration operable", async () => {
    const component = { kind: "chart" as const, leftMm: 0, topMm: 0, widthMm: 100, heightMm: 60, chartBinding: { dataset: "detail", categoryField: "shift", type: "bar" as const, measures: [{ field: "qty", op: "sum" as const }] } };
    const wrapper = mount(ChartBindingInspector, { props: { component, schemas: { detail: { fields: [{ field: "shift", type: "text" }, { field: "qty", type: "decimal" }, { field: "weight", type: "number" }] } } } });
    await wrapper.get('select[aria-label="度量与聚合"]').setValue("qty");
    const decimal = wrapper.emitted("change")?.at(-1)?.[0] as typeof component.chartBinding;
    expect(decimal.measures[0]).toMatchObject({ field: "qty", numeric: "decimal" });
    await wrapper.setProps({ component: { ...component, chartBinding: decimal } });
    await wrapper.get('select[aria-label="聚合方式"]').setValue("weightedAvg");
    const weighted = wrapper.emitted("change")?.at(-1)?.[0] as typeof decimal;
    expect(weighted.measures[0]).toMatchObject({ op: "weightedAvg", weightField: "weight", numeric: "decimal" });
    await wrapper.setProps({ component: { ...component, chartBinding: weighted } });
    expect(wrapper.text()).toContain("权重字段"); wrapper.unmount();
  });
});
