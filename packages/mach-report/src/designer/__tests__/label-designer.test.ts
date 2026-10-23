import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { defineReportTemplate, validateReportTemplateDocument, type ReportTemplateDocument } from "../../index";
import ReportTemplateEditor from "../ReportTemplateEditor.vue";
import TemplatePageInspector from "../TemplatePageInspector.vue";
import TemplateRepeatInspector from "../TemplateRepeatInspector.vue";
import CanvasComponentInspector from "../CanvasComponentInspector.vue";
import ComponentDataBinding from "../ComponentDataBinding.vue";
import CodeComponentInspector from "../CodeComponentInspector.vue";
import { applyPageCommand, pageOverflow } from "../page-commands";
import { canvasContentSample, canvasRulerMarks } from "../canvas-samples";

function fixture(): ReportTemplateDocument {
  return defineReportTemplate({ id: "label-design", name: "工业标签", revision: "3", template: { pages: [{ widthMm: 80, heightMm: 55, layout: "page", meta: { title: "产品信息" }, components: [{ kind: "text", nid: "title", leftMm: 4, topMm: 4, widthMm: 60, heightMm: 8, text: "PRODUCT", style: { fontSize: 10 } }] }] } });
}
const schemas = { labels: { rowKey: "id", fields: [{ field: "id", label: "产品编码", type: "text" as const }, { field: "weight", label: "重量", type: "number" as const }, { field: "copies", label: "份数", type: "number" as const }] } };
function control(wrapper: Pick<VueWrapper, "findAll">, label: string, selector = "input") { return wrapper.findAll("label").find(item => item.text().startsWith(label))!.get(selector); }
async function tab(wrapper: VueWrapper, name: string) { await wrapper.findAll('[role="tab"]').find(item => item.text() === name)!.trigger("click"); await flushPromises(); }
function latest(wrapper: VueWrapper): ReportTemplateDocument { return wrapper.emitted("update:modelValue")!.at(-1)![0] as ReportTemplateDocument; }
function editor() { return mount(ReportTemplateEditor, { props: { modelValue: fixture(), datasets: { labels: [{ id: "000418", weight: 0, copies: 2 }] }, dataSchemas: schemas }, global: { stubs: { ReportPreview: true } } }); }

describe("工业标签设计工作流", () => {
  it("paper presets, named pages, margins, duplication/deletion and undo remain validated transactions", async () => {
    const wrapper = editor(); await tab(wrapper, "模板");
    await control(wrapper, "纸张规格", "select").setValue("label-80-50");
    expect(latest(wrapper).template.pages[0]).toMatchObject({ widthMm: 80, heightMm: 50 });
    await control(wrapper, "版面名称").setValue("标签正面");
    await control(wrapper, "上边距").setValue("1.5");
    expect(latest(wrapper).template.pages[0]).toMatchObject({ meta: { title: "标签正面" }, marginTopMm: 1.5 });
    await wrapper.findAll("button").find(item => item.text() === "复制版面")!.trigger("click");
    expect(latest(wrapper).template.pages).toHaveLength(2);
    expect(latest(wrapper).template.pages[1]!.components[0]).toMatchObject({ nid: "page-copy-1", text: "PRODUCT" });
    await wrapper.findAll("button").find(item => item.text() === "删除版面")!.trigger("click");
    expect(wrapper.find(".mr-page-confirm").exists()).toBe(true);
    expect(latest(wrapper).template.pages).toHaveLength(2);
    await wrapper.findAll("button").find(item => item.text() === "确认删除")!.trigger("click");
    expect(latest(wrapper).template.pages).toHaveLength(1);
    await wrapper.get('button[aria-label="撤销"]').trigger("click");
    expect(latest(wrapper).template.pages).toHaveLength(2);
    await wrapper.findAll("button").find(item => item.text().includes("新增版面"))!.trigger("click");
    expect(latest(wrapper).template.pages).toHaveLength(3); expect(latest(wrapper).template.pages[2]!.components).toEqual([]);
    expect(latest(wrapper).revision).toBe("3"); expect(validateReportTemplateDocument(latest(wrapper)).ok).toBe(true);
    wrapper.unmount();
  });
  it("record binding renders a real zero with declared precision and prevents disabling an in-use dataset", async () => {
    const wrapper = editor(); await tab(wrapper, "模板");
    await wrapper.get(".mr-repeat-toggle input").setValue(true);
    expect(latest(wrapper).template.repeat).toEqual({ dataset: "labels", copies: 1 });
    await control(wrapper, "份数来源", "select").setValue("field");
    expect(latest(wrapper).template.repeat?.copies).toEqual({ field: "weight" });
    await control(wrapper, "份数字段").setValue("copies");
    await wrapper.findAll("button").find(item => item.text() === "设计")!.trigger("click");
    await wrapper.get('[data-canvas-component="0"]').trigger("click");
    await control(wrapper, "内容来源", "select").setValue("field");
    await control(wrapper, "绑定字段").setValue("weight");
    await control(wrapper, "值格式", "select").setValue("number");
    await control(wrapper, "小数位").setValue("3");
    await control(wrapper, "后缀").setValue(" kg");
    expect(wrapper.get(".mr-canvas-content").text()).toBe("0.000 kg");
    await tab(wrapper, "模板"); expect(wrapper.get(".mr-repeat-toggle input").attributes("disabled")).toBeDefined();
    expect(latest(wrapper).template.repeat?.copies).toEqual({ field: "copies" });
    expect(latest(wrapper).template.pages[0]!.components[0]).toMatchObject({ binding: { field: "weight", format: { kind: "number", digits: 3 }, suffix: " kg" } });
    wrapper.unmount();
  });
  it("symbol insertion, square QR resizing, EAN defaults, and explicit design placeholders are honest", async () => {
    const wrapper = editor(); await tab(wrapper, "组件");
    await wrapper.get('select[aria-label="添加组件"]').setValue("qrcode");
    const inspector = wrapper.getComponent(CanvasComponentInspector);
    await control(inspector, "宽度").setValue("20");
    expect(latest(wrapper).template.pages[0]!.components[1]).toMatchObject({ kind: "qrcode", widthMm: 20, heightMm: 20 });
    expect(wrapper.get(".mr-canvas-code").text()).toContain("MACHREPORT");
    expect(wrapper.get(".mr-canvas-code").find("img").exists()).toBe(false);
    await wrapper.get('select[aria-label="添加组件"]').setValue("barcode");
    await control(wrapper.getComponent(CanvasComponentInspector), "条码制式", "select").setValue("ean8");
    expect(latest(wrapper).template.pages[0]!.components[2]).toMatchObject({ code: { value: "MR20261022" } });
    await control(wrapper.getComponent(CanvasComponentInspector), "固定编码内容", "textarea").setValue("96385074");
    expect(latest(wrapper).template.pages[0]!.components[2]).toMatchObject({ kind: "barcode", code: { symbology: "ean8", value: "96385074", quietZoneModules: 11, showText: true } });
    expect(wrapper.findAll(".mr-canvas-code")).toHaveLength(2); expect(wrapper.findAll(".mr-canvas-ruler")).toHaveLength(2);
    await wrapper.findAll("button").find(item => item.text() === "标尺")!.trigger("click"); expect(wrapper.findAll(".mr-canvas-ruler")).toHaveLength(0);
    wrapper.unmount();
  });
  it("readonly blocks page, repeat, binding, symbols and geometry changes without mutating the document", async () => {
    const wrapper = editor(); await wrapper.setProps({ readonly: true }); await tab(wrapper, "模板");
    expect(wrapper.getComponent(TemplatePageInspector).get("fieldset").attributes("disabled")).toBeDefined();
    expect(wrapper.getComponent(TemplateRepeatInspector).get("fieldset").attributes("disabled")).toBeDefined();
    await tab(wrapper, "组件"); expect(wrapper.get('select[aria-label="添加组件"]').attributes("disabled")).toBeDefined();
    await wrapper.get('select[aria-label="添加组件"]').setValue("qrcode");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined(); wrapper.unmount();
  });
  it("undo of an inserted symbol clears the invalid selection and image bindings expose only supported settings", async () => {
    const wrapper = editor(); await tab(wrapper, "组件");
    await wrapper.get('select[aria-label="添加组件"]').setValue("qrcode");
    expect(wrapper.findAll(".mr-canvas-component.is-selected")).toHaveLength(1);
    await wrapper.get('button[aria-label="撤销"]').trigger("click");
    expect(wrapper.find(".mr-designer-arrange").exists()).toBe(false);
    await wrapper.get('button[aria-label="重做"]').trigger("click");
    expect(wrapper.findAll(".mr-canvas-component.is-selected")).toHaveLength(1);
    expect(wrapper.getComponent(CanvasComponentInspector).props()).toMatchObject({ component: { kind: "qrcode" } });
    wrapper.unmount();
    const image = mount(ComponentDataBinding, { props: { component: { kind: "image", leftMm: 0, topMm: 0, widthMm: 20, heightMm: 10, binding: { field: "logo" } }, repeat: { dataset: "labels" } } });
    expect(image.text()).toContain("PNG/JPEG"); expect(image.find("details").exists()).toBe(false); image.unmount();
  });
  it("repeat cannot be enabled over a wide/dynamic table, and readonly field handlers cannot emit a patch", async () => {
    const document = fixture(); document.template.pages[0]!.layout = "wide";
    const wrapper = mount(TemplateRepeatInspector, { props: { document, schemas } });
    expect(wrapper.get('input[type="checkbox"]').attributes("disabled")).toBeDefined(); expect(wrapper.text()).toContain("固定纸张");
    await wrapper.get('input[type="checkbox"]').setValue(true); expect(wrapper.emitted("change")).toBeUndefined(); wrapper.unmount();
  });
  it("paper warnings preserve user geometry, duplicated flow identities remain valid, and ruler ticks are bounded", () => {
    const document = fixture(), page = document.template.pages[0]!;
    page.widthMm = 30; expect(pageOverflow(page)).toEqual([0]); expect(page.components[0]!.widthMm).toBe(60);
    page.widthMm = 80; page.flow = { bands: [{ componentIds: ["title"], topMm: 4, heightMm: 8 }] };
    expect(applyPageCommand(document, 0, { type: "duplicate" })).toBe(1);
    expect(document.template.pages[1]!.flow!.bands[0]!.componentIds).toEqual(["page-copy-1"]);
    expect(validateReportTemplateDocument(document).ok).toBe(true);
    expect(canvasRulerMarks(1_000_000, .01).length).toBeLessThanOrEqual(201);
  });
  it("design samples use the same literal binding rules, preserve empty/zero and expose missing fields", () => {
    const document = fixture(), component = document.template.pages[0]!.components[0]!;
    if (component.kind !== "text") throw new Error("fixture");
    document.template.repeat = { dataset: "labels" }; component.binding = { field: "serial.number", prefix: "#", emptyText: "—" };
    expect(canvasContentSample(component, document, { labels: [{ "serial.number": 0 }] }).text).toBe("#0");
    expect(canvasContentSample(component, document, { labels: [{ "serial.number": "" }] }).text).toBe("—");
    expect(canvasContentSample(component, document, { labels: [{}] })).toMatchObject({ text: "serial.number", bound: true, error: expect.stringContaining("serial.number") });
    expect(canvasContentSample(component, document, { labels: [] })).toEqual({ text: "serial.number", bound: true });
    const image = { ...component, kind: "image" as const, binding: { field: "logo" } };
    expect(canvasContentSample(image, document, { labels: [{ logo: "https://example.com/image.png" }] })).toMatchObject({ text: "logo", error: "image-binding" });
    expect(canvasContentSample(image, document, { labels: [{ logo: "data:image/png;base64,aA==" }] }).image).toBe("data:image/png;base64,aA==");
  });
  it("legacy symbol content and omitted showText stay consistent with the real encoder", async () => {
    const document = fixture(), component = { kind: "barcode" as const, leftMm: 0, topMm: 0, widthMm: 50, heightMm: 15, fallbackText: "0000418", text: "legacy-fallback" };
    const wrapper = mount(CodeComponentInspector, { props: { component } });
    expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe("0000418");
    expect((wrapper.get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(false);
    expect(canvasContentSample(component, document).text).toBe("0000418");
    await wrapper.setProps({ component: { ...component, code: { value: "", showText: true } } });
    expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe(""); expect((wrapper.get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(true);
    expect(canvasContentSample({ ...component, code: { value: "" } }, document).text).toBe(""); wrapper.unmount();
  });
});
