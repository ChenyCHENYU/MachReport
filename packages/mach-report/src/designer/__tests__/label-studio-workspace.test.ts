import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import ReportLabelStudio from "../ReportLabelStudio.vue";
import ReportTemplateEditor from "../ReportTemplateEditor.vue";
import CanvasComponentInspector from "../CanvasComponentInspector.vue";
import { type ReportTemplateDocument } from "@agile-team/mach-report";
import { ReportPreview } from "@agile-team/mach-report/vue";
import type { LabelStudioController } from "../useLabelStudio";

const schema = { rowKey: "id", fields: [{ field: "id", type: "text" as const }, { field: "heat", label: "炉号", type: "text" as const, semanticRole: "identifier" as const }, { field: "weight", label: "重量", type: "number" as const }] };
const wrappers: ReturnType<typeof mount>[] = [];
afterEach(async () => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); await vi.dynamicImportSettled(); await flushPromises(); document.body.replaceChildren(); });
function studio() {
  const wrapper = mount(ReportLabelStudio, { props: { rows: [{ id: "1", heat: "00018", weight: 0 }], schema }, attachTo: document.body, global: { stubs: { ReportPreview: true } } });
  wrappers.push(wrapper);
  return wrapper;
}
function latest(wrapper: ReturnType<typeof studio>) { return wrapper.emitted("update:modelValue")!.at(-1)![0] as ReportTemplateDocument; }

it("one design action opens the real canvas and one editor survives preview navigation with undo history", async () => {
  const wrapper = studio(); await flushPromises();
  const editor = wrapper.getComponent(ReportTemplateEditor);
  const instance = editor.vm.$.uid;
  expect(editor.find(".mr-designer-mode").exists()).toBe(false);
  expect(editor.props("capabilities")).toMatchObject({ params: false });
  await wrapper.findAll(".mr-label-bar button").find(button => button.text() === "设计标签")!.trigger("click");
  await flushPromises();
  expect(editor.find(".mr-canvas").isVisible()).toBe(true);
  const original = latest(wrapper).template.pages[0]!.components[0];
  await editor.get('[data-canvas-component="0"]').trigger("click");
  await editor.getComponent(CanvasComponentInspector).get("textarea").setValue("临时标题");
  expect(latest(wrapper).template.pages[0]!.components[0]).toMatchObject({ text: "临时标题" });
  await wrapper.findAll(".mr-label-bar button").find(button => button.text() === "打印预览")!.trigger("click");
  await flushPromises();
  expect(wrapper.getComponent(ReportTemplateEditor).vm.$.uid).toBe(instance);
  await wrapper.findAll(".mr-label-bar button").find(button => button.text() === "设计标签")!.trigger("click");
  await flushPromises();
  const undo = editor.get('button[aria-label="撤销"]');
  expect(undo.attributes("disabled")).toBeUndefined();
  await undo.trigger("click");
  expect(latest(wrapper).template.pages[0]!.components[0]).toEqual(original);
});

it("finished preset changes are a single reversible transaction and selected fields are used", async () => {
  const wrapper = studio(); await flushPromises();
  await wrapper.findAll(".mr-label-presets button").find(button => button.get("strong").text() === "物料卡")!.trigger("click");
  await wrapper.get(".mr-label-apply").trigger("click"); await flushPromises();
  expect(latest(wrapper).template.pages).toHaveLength(1);
  await wrapper.findAll(".mr-label-bar button").find(button => button.text() === "设计标签")!.trigger("click"); await flushPromises();
  await wrapper.getComponent(ReportTemplateEditor).get('button[aria-label="撤销"]').trigger("click");
  expect(latest(wrapper).template.pages).toHaveLength(2);
  expect(wrapper.find('.mr-label-presets button[aria-pressed="true"]').text()).toContain("双版标识");
});

it("content is added through the visible action and can be undone from the same label workspace", async () => {
  const wrapper = studio(); await flushPromises();
  await wrapper.findAll(".mr-label-bar button").find(button => button.text() === "设计标签")!.trigger("click"); await flushPromises();
  const editor = wrapper.getComponent(ReportTemplateEditor);
  const count = () => latest(wrapper).template.pages.reduce((sum, page) => sum + page.components.length, 0);
  const before = count();
  await editor.get(".mr-insert-trigger").trigger("click");
  await editor.findAll(".mr-insert-grid button").find(button => button.get("strong").text() === "说明文字")!.trigger("click");
  expect(count()).toBe(before + 1);
  expect(editor.findAll(".mr-canvas-component.is-selected")).toHaveLength(1);
  await editor.get('button[aria-label="撤销"]').trigger("click");
  expect(count()).toBe(before);
});

it("adding a business field can prepare and generate the real print preview within its text height", async () => {
  const wrapper = studio();
  await wrapper.setProps({ rows: [{ id: "1", heat: "00018", weight: 0, coil: "A001" }], schema: { ...schema, fields: [...schema.fields, { field: "coil", label: "卷号", type: "text" }] } });
  await flushPromises();
  await wrapper.findAll(".mr-label-bar button").find(button => button.text() === "设计标签")!.trigger("click");
  await flushPromises();
  const editor = wrapper.getComponent(ReportTemplateEditor);
  await editor.get(".mr-insert-trigger").trigger("click");
  await editor.get(".mr-insert-field").trigger("click");
  await flushPromises();
  await editor.findAll(".mr-insert-fields button").find(button => button.text().includes("coil"))!.trigger("click");
  const controller = wrapper.vm as unknown as LabelStudioController;
  const prepared = await controller.prepare();
  expect(prepared).toBeDefined();
  const field = prepared!.template.pages.flatMap(page => page.components).find(component => component.kind === "text" && component.binding?.field === "coil");
  expect(field).toMatchObject({ heightMm: 5, style: { fontSize: 8, lineHeight: 1.1, verticalAlign: "middle" } });
  expect(controller.pendingLocalChanges).toBe(false);
  await wrapper.findAll(".mr-label-bar button").find(button => button.text() === "打印预览")!.trigger("click");
  await flushPromises();
  const fetcher = wrapper.getComponent(ReportPreview).props("fetcher")!;
  const plan = await fetcher({ reportIds: ["labels"], params: {} });
  expect(plan.pages.flatMap(page => page.components).some(component => component.text === "卷号  A001")).toBe(true);
  expect(wrapper.find(".mr-label-notice").exists()).toBe(false);
});

it("display-field limits stay visible and users can replace a selected field without losing their choice", async () => {
  const wrapper = studio(); await flushPromises();
  const extraFields = Array.from({ length: 6 }, (_, index) => ({ field: `field${index}`, label: `字段${index}`, type: "text" as const }));
  await wrapper.setProps({ schema: { ...schema, fields: [...schema.fields, ...extraFields] } });
  const options = () => wrapper.findAll(".mr-label-field-options > label").map(label => label.get<HTMLInputElement>("input"));
  for (const option of options().filter(option => !option.element.checked).slice(0, 4)) await option.setValue(true);
  expect(options().filter(option => option.element.checked)).toHaveLength(5);
  expect(options().filter(option => !option.element.checked).every(option => option.attributes("disabled") !== undefined)).toBe(true);
  expect(wrapper.get(".mr-label-fields").text()).toContain("最多显示 5 个字段");
  await options().find(option => option.element.checked)!.setValue(false);
  expect(options().every(option => option.attributes("disabled") === undefined)).toBe(true);
});

it("closing an unsaved quick layout reveals the persistent editor confirmation and cancellation keeps the layout", async () => {
  const wrapper = studio(); await flushPromises();
  await wrapper.findAll(".mr-label-presets button").find(button => button.get("strong").text() === "物料卡")!.trigger("click");
  await wrapper.get(".mr-label-apply").trigger("click"); await flushPromises();
  const controller = wrapper.vm as unknown as { guardChanges(): Promise<boolean> };
  const closing = controller.guardChanges(); await flushPromises();
  const confirmation = wrapper.get(".mr-label-confirm");
  expect(confirmation.isVisible()).toBe(true);
  await confirmation.findAll("button").find(button => button.text() === "继续编辑")!.trigger("click");
  expect(await closing).toBe(false);
  expect(latest(wrapper).template.pages).toHaveLength(1);
});

it("unapplied quick choices participate in one discard decision and restore the applied form on confirmation", async () => {
  const wrapper = studio(); await flushPromises();
  const controller = wrapper.vm as unknown as { pendingLocalChanges: boolean; guardChanges(): Promise<boolean> };
  expect(controller.pendingLocalChanges).toBe(false);
  await wrapper.findAll(".mr-label-presets button").find(button => button.get("strong").text() === "物料卡")!.trigger("click");
  expect(controller.pendingLocalChanges).toBe(true);
  const cancelled = controller.guardChanges(); await flushPromises();
  const keep = wrapper.get(".mr-label-confirm").findAll("button").find(button => button.text() === "继续编辑")!;
  expect(window.document.activeElement).toBe(keep.element);
  await keep.trigger("click"); expect(await cancelled).toBe(false);
  expect(controller.pendingLocalChanges).toBe(true);
  const confirmed = controller.guardChanges(); await flushPromises();
  await wrapper.get(".mr-label-confirm").findAll("button").find(button => button.text() === "丢弃并继续")!.trigger("click");
  expect(await confirmed).toBe(true); await flushPromises();
  expect(controller.pendingLocalChanges).toBe(false);
  expect(wrapper.find('.mr-label-presets button[aria-pressed="true"]').text()).toContain("双版标识");
  expect(latest(wrapper).template.pages).toHaveLength(2);
});

it("mixed applied layout and unapplied branding are discarded together with one visible confirmation", async () => {
  const wrapper = studio(); await flushPromises();
  await wrapper.findAll(".mr-label-presets button").find(button => button.get("strong").text() === "物料卡")!.trigger("click");
  await wrapper.get(".mr-label-apply").trigger("click"); await flushPromises();
  await wrapper.get<HTMLInputElement>(".mr-label-brand input").setValue("未应用品牌");
  const controller = wrapper.vm as unknown as { pendingLocalChanges: boolean; guardChanges(): Promise<boolean> };
  const closing = controller.guardChanges(); await flushPromises();
  expect(wrapper.findAll(".mr-label-confirm")).toHaveLength(1);
  await wrapper.get(".mr-label-confirm").findAll("button").find(button => button.text() === "丢弃并继续")!.trigger("click");
  expect(await closing).toBe(true); await flushPromises();
  expect(wrapper.find(".mr-label-confirm").exists()).toBe(false);
  expect(controller.pendingLocalChanges).toBe(false);
  expect(wrapper.getComponent(ReportTemplateEditor).vm.pendingLocalChanges).toBe(false);
  expect(wrapper.get<HTMLInputElement>(".mr-label-brand input").element.value).toBe("");
  expect(latest(wrapper).template.pages).toHaveLength(2);
});
