import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { createTableTemplate, defineReportTemplate } from "../../index";
import ReportTemplateEditor from "../ReportTemplateEditor.vue";
import TemplateDesignCanvas from "../TemplateDesignCanvas.vue";
import CanvasComponentInspector from "../CanvasComponentInspector.vue";
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
  it("undo/redo restore the edited face and component even after navigating elsewhere", async () => {
    const document = label();
    document.template.pages[0]!.meta = { title: "正面" };
    document.template.pages.push({ widthMm: 80, heightMm: 55, meta: { title: "背面" }, components: [{ kind: "text", leftMm: 3, topMm: 3, widthMm: 50, heightMm: 8, text: "BACK" }] });
    const wrapper = editor(document);
    await wrapper.findAll(".mr-designer-mode button").find(item => item.text() === "设计")!.trigger("click");
    const pageControl = () => wrapper.findAll("label").find(item => item.text().startsWith("页"))!.get("select");
    expect(pageControl().findAll("option").map(item => item.text())).toEqual(["正面", "背面"]);
    await wrapper.get('[data-canvas-component="0"]').trigger("click");
    await wrapper.getComponent(CanvasComponentInspector).get("textarea").setValue("FRONT EDIT");
    await pageControl().setValue("1"); await wrapper.get('[data-canvas-component="0"]').trigger("click");
    await wrapper.getComponent(CanvasComponentInspector).get("textarea").setValue("BACK EDIT");
    await pageControl().setValue("0");
    await wrapper.get('button[aria-label="撤销"]').trigger("click");
    expect(wrapper.getComponent(TemplateDesignCanvas).props("pageIndex")).toBe(1);
    expect(wrapper.getComponent(CanvasComponentInspector).get("textarea").element.value).toBe("BACK");
    await wrapper.get('button[aria-label="撤销"]').trigger("click");
    expect(wrapper.getComponent(TemplateDesignCanvas).props("pageIndex")).toBe(0);
    expect(wrapper.getComponent(CanvasComponentInspector).get("textarea").element.value).toBe("PRODUCT");
    await wrapper.get('button[aria-label="重做"]').trigger("click");
    expect(wrapper.getComponent(TemplateDesignCanvas).props("pageIndex")).toBe(0);
    expect(wrapper.getComponent(CanvasComponentInspector).get("textarea").element.value).toBe("FRONT EDIT");
    await wrapper.get('button[aria-label="重做"]').trigger("click");
    expect(wrapper.getComponent(TemplateDesignCanvas).props("pageIndex")).toBe(1);
    expect(wrapper.getComponent(CanvasComponentInspector).get("textarea").element.value).toBe("BACK EDIT");
    expect(wrapper.get('.mr-component-position').attributes("open")).toBeUndefined();
    expect(wrapper.get('.mr-component-content').text()).toContain("内容来源");
    wrapper.unmount();
  });
  it("copying and deleting a face undo to the correct named page without a stale selection", async () => {
    const document = label(); document.template.pages[0]!.meta = { title: "正面" };
    document.template.pages.push({ widthMm: 80, heightMm: 55, meta: { title: "背面" }, components: [] });
    const wrapper = editor(document); await tab(wrapper, "模板").trigger("click");
    const selected = () => wrapper.find(".mr-page-list > button[aria-pressed=true]");
    await wrapper.findAll("button").find(item => item.text() === "复制版面")!.trigger("click");
    expect(selected().text()).toContain("2正面");
    await wrapper.get('button[aria-label="撤销"]').trigger("click"); expect(selected().text()).toContain("1正面");
    await wrapper.get('button[aria-label="重做"]').trigger("click"); expect(selected().text()).toContain("2正面");
    await wrapper.findAll("button").find(item => item.text() === "删除版面")!.trigger("click");
    await wrapper.findAll("button").find(item => item.text() === "确认删除")!.trigger("click");
    expect(selected().text()).toContain("2背面");
    await wrapper.get('button[aria-label="撤销"]').trigger("click"); expect(selected().text()).toContain("2正面");
    expect(wrapper.find(".mr-designer-arrange").exists()).toBe(false);
    wrapper.unmount();
  });
  it("names bound fields and symbol kinds with the provided messages, keeping advanced controls discoverable", async () => {
    const document = label();
    document.template.pages[0]!.components.push({ kind: "qrcode", leftMm: 58, topMm: 30, widthMm: 20, heightMm: 20, binding: { field: "trace" } });
    const wrapper = editor(document);
    await wrapper.setProps({ dataSchemas: { labels: { fields: [{ field: "trace", label: "产品追溯码", type: "text" }] } }, messages: { insertQrcode: "QR Symbol", codeAdvancedSettings: "Encoding options" } });
    const directory = wrapper.findAll("label").find(item => item.text().startsWith("组件目录"))!.get("select");
    expect(directory.findAll("option").at(-1)!.text()).toBe("2 · QR Symbol · 产品追溯码");
    await directory.setValue("1");
    const advanced = wrapper.get(".mr-code-advanced");
    expect(advanced.attributes("open")).toBeUndefined(); expect(advanced.get("summary").text()).toBe("Encoding options");
    expect(advanced.text()).toContain("留白（模块）");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    wrapper.unmount();
  });
});
