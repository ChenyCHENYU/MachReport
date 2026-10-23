import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { createTableTemplate, defineReportTemplate } from "../../index";
import ReportTemplateEditor from "../ReportTemplateEditor.vue";
function label() { return defineReportTemplate({ id: "label-navigation", name: "标签", template: { repeat: { dataset: "labels" }, pages: [{ widthMm: 80, heightMm: 55, components: [{ kind: "text", leftMm: 3, topMm: 3, widthMm: 50, heightMm: 8, text: "PRODUCT" }] }] } }); }
function table() { return defineReportTemplate({ id: "table-navigation", name: "日报", template: createTableTemplate({ columns: [{ field: "id", header: "编号" }] }) }); }
function tab(wrapper: VueWrapper, name: string) { return wrapper.findAll('[role="tab"]').find(item => item.text() === name)!; }
function editor(document = label()) { return mount(ReportTemplateEditor, { props: { modelValue: document, datasets: { labels: [{}] } }, global: { stubs: { ReportPreview: true, ExcelBindingWizard: true } } }); }
describe("label-aware inspector navigation", () => {
  it("starts in component properties, removes inapplicable fields, and keyboards through only visible tabs", async () => {
    const wrapper = editor();
    expect(tab(wrapper, "组件").attributes("aria-selected")).toBe("true"); expect(tab(wrapper, "字段")).toBeUndefined();
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(4); expect(wrapper.text()).not.toContain("没有匹配的列");
    await tab(wrapper, "组件").trigger("keydown", { key: "ArrowLeft" }); expect(tab(wrapper, "高级").attributes("aria-selected")).toBe("true");
    await tab(wrapper, "高级").trigger("keydown", { key: "Home" }); expect(tab(wrapper, "组件").attributes("aria-selected")).toBe("true");
    await tab(wrapper, "组件").trigger("keydown", { key: "ArrowRight" }); expect(tab(wrapper, "模板").attributes("aria-selected")).toBe("true"); wrapper.unmount();
  });
  it("returns from tools to component on labels, while list reports retain the fields default", async () => {
    const wrapper = editor(); await tab(wrapper, "工具").trigger("click"); await flushPromises();
    await wrapper.findAll(".mr-designer-mode button").find(item => item.text() === "预览")!.trigger("click");
    expect(tab(wrapper, "组件").attributes("aria-selected")).toBe("true"); wrapper.unmount();
    const ordinary = editor(table()); expect(tab(ordinary, "字段").attributes("aria-selected")).toBe("true");
    await tab(ordinary, "工具").trigger("click"); await flushPromises();
    await ordinary.findAll(".mr-designer-mode button").find(item => item.text() === "预览")!.trigger("click");
    expect(tab(ordinary, "字段").attributes("aria-selected")).toBe("true"); ordinary.unmount();
  });
  it("a host replacement only redirects a disappearing fields tab, preserving other chosen sections", async () => {
    const wrapper = editor(table());
    await wrapper.setProps({ modelValue: label() }); await flushPromises(); expect(tab(wrapper, "组件").attributes("aria-selected")).toBe("true");
    for (const section of ["模板", "高级", "工具"]) {
      await wrapper.setProps({ modelValue: table() }); await flushPromises(); await tab(wrapper, section).trigger("click");
      await wrapper.setProps({ modelValue: label() }); await flushPromises(); expect(tab(wrapper, section).attributes("aria-selected")).toBe("true");
    }
    expect(wrapper.emitted("update:modelValue")).toBeUndefined(); wrapper.unmount();
  });
});
