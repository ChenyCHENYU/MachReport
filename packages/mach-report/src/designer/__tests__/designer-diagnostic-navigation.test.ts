import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTableTemplate, defineReportTemplate } from "../../index";
import ReportTemplateEditor from "../ReportTemplateEditor.vue";
import TemplateReviewPanel from "../TemplateReviewPanel.vue";
import ParamEditor from "../ParamEditor.vue";
import RuleEditor from "../RuleEditor.vue";
import { createTemplateDraftStorage, type TemplateDraftStorage } from "../draft-storage";
import type { TemplateEditorController } from "../useTemplateEditor";

const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).forEach(close => close()); vi.useRealTimers(); });
function fixture() {
  const template = createTableTemplate({ columns: [{ field: "heat", header: "炉号" }, { field: "energy", header: "用电" }] });
  template.params = [{ field: "plant", type: "text" }, { field: "month", type: "month" }];
  const list = template.pages[0]!.components[0]!;
  if (list.kind !== "list") throw new Error("Fixture must contain a list");
  list.computed = [{ field: "total", expression: { field: "energy" } }, { field: "other", expression: { field: "energy" } }];
  template.pages.push({ widthMm: 100, heightMm: 200, components: [] });
  return defineReportTemplate({ id: "daily", name: "日报", template });
}
async function mounted(draftStorage?: TemplateDraftStorage) {
  const wrapper = mount(ReportTemplateEditor, { props: { modelValue: fixture(), draftStorage }, attachTo: document.body, global: { stubs: { ReportPreview: true, TemplateDesignCanvas: true } } });
  cleanup.push(() => wrapper.unmount());
  await flushPromises();
  const controller = wrapper.vm as unknown as TemplateEditorController;
  expect(controller.openPanel).toBeTypeOf("function");
  controller.openPanel!("review");
  await vi.dynamicImportSettled(); await flushPromises();
  return wrapper;
}
describe("diagnose, correct and return to the same queue", () => {
  it("locates a page change and restores the review queue scroll and focus", async () => {
    vi.useFakeTimers();
    const wrapper = await mounted();
    const next = fixture().template;
    next.pages[1]!.widthMm = 120;
    const controller = wrapper.vm as unknown as TemplateEditorController;
    expect(controller.applyTemplate).toBeTypeOf("function");
    expect(controller.applyTemplate!(next)).toBe(true);
    await flushPromises();
    const review = wrapper.getComponent(TemplateReviewPanel);
    await review.findAll("button").find(button => button.text() === "运行检查")!.trigger("click");
    await vi.runAllTimersAsync(); await flushPromises();
    const source = review.findAll(".mr-review-list li").find(row => row.text().includes("pages[1].widthMm"))!.get("button");
    const content = wrapper.get(".mr-designer-tool-content").element;
    content.scrollTop = 140;
    (review.get("select").element as HTMLElement).focus();
    expect(document.activeElement).not.toBe(source.element);
    await source.trigger("click"); await flushPromises();
    expect(document.activeElement?.getAttribute("data-mr-control")).toBe("page-widthMm");
    expect((document.activeElement as HTMLInputElement).value).toBe("120");
    content.scrollTop = 0;
    await wrapper.findAll("button").find(button => button.text().includes("返回检查列表"))!.trigger("click");
    expect(wrapper.getComponent(TemplateReviewPanel).element).toBe(review.element);
    expect(content.scrollTop).toBe(140);
    expect(document.activeElement).toBe(source.element);
  });
  it("opens the exact parameter row and control without creating content changes", async () => {
    const wrapper = await mounted();
    wrapper.getComponent(TemplateReviewPanel).vm.$emit("locate", { path: '$.template.params["month"].type' });
    await vi.dynamicImportSettled(); await flushPromises();
    const form = wrapper.getComponent(ParamEditor);
    expect(form.get('input[data-mr-control="field"]').element).toHaveProperty("value", "month");
    expect(document.activeElement?.getAttribute("data-mr-control")).toBe("type");
    expect(wrapper.vm.pendingLocalChanges).toBe(false);
  });
  it("routes calculations to the existing rule editor while preserving unapplied edits", async () => {
    const wrapper = await mounted();
    const review = wrapper.getComponent(TemplateReviewPanel);
    review.vm.$emit("locate", { path: "$.template.pages[0].components[0].computed[0].expression.field", field: "energy" });
    await vi.dynamicImportSettled(); await flushPromises();
    const rules = wrapper.getComponent(RuleEditor);
    const target = rules.findAll("input").find(input => (input.element as HTMLInputElement).value === "total")!;
    await target.setValue("draft-total");
    review.vm.$emit("locate", { path: "$.template.pages[0].components[0].computed[1]" });
    await flushPromises();
    expect(rules.findAll("input").some(input => (input.element as HTMLInputElement).value === "other")).toBe(true);
    review.vm.$emit("locate", { path: "$.template.pages[0].components[0].computed[0]" });
    await flushPromises();
    expect(rules.findAll("input").some(input => (input.element as HTMLInputElement).value === "draft-total")).toBe(true);
    expect(wrapper.vm.pendingLocalChanges).toBe(true);
  });
  it("explains deleted changes instead of offering a stale destination", async () => {
    vi.useFakeTimers();
    const previous = fixture(), current = fixture();
    current.template.params!.splice(1, 1);
    const wrapper = mount(TemplateReviewPanel, { props: { document: current, previous } });
    cleanup.push(() => wrapper.unmount());
    await wrapper.findAll("button").find(button => button.text() === "运行检查")!.trigger("click");
    await vi.runAllTimersAsync(); await flushPromises();
    const row = wrapper.findAll(".mr-review-list li").find(row => row.text().includes('params["month"]'))!;
    expect(row.text()).toContain("已删除，仅保留变更记录");
    expect(row.find("button").exists()).toBe(false);
  });
  it("focuses an unfocused issue trigger before notifying a standalone consumer", async () => {
    vi.useFakeTimers();
    let observed: Element | null = null;
    const wrapper = mount(TemplateReviewPanel, { props: { document: fixture(), dataSchemas: { detail: { fields: [] } }, onLocate: () => { observed = document.activeElement; } }, attachTo: document.body });
    const other = document.createElement("button"); document.body.append(other);
    cleanup.push(() => { wrapper.unmount(); other.remove(); });
    await wrapper.findAll("button").find(button => button.text() === "运行检查")!.trigger("click");
    await vi.runAllTimersAsync(); await flushPromises();
    const issue = wrapper.findAll(".mr-review-list li").find(row => row.text().includes("缺少字段 heat"))!.get("button");
    other.focus();
    expect(document.activeElement).not.toBe(issue.element);
    await issue.trigger("click");
    expect(observed).toBe(issue.element); expect(document.activeElement).toBe(issue.element);
  });
  it.each([
    ['$.template.params["month"].type', "params", "month"],
    ["$.template.pages[0].components[0].computed[1]", "rules", "other"],
  ])("resumes the clean %s task without storing business rows", async (path, tool, field) => {
    const values = new Map<string, string>();
    const draftStorage = { scope: "cursor-test", rememberView: true, adapter: createTemplateDraftStorage({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } }) };
    const first = await mounted(draftStorage);
    first.getComponent(TemplateReviewPanel).vm.$emit("locate", { path });
    await vi.dynamicImportSettled(); await flushPromises();
    window.dispatchEvent(new Event("pagehide")); await flushPromises(); first.unmount();
    const raw = [...values.entries()].find(([key]) => key.endsWith(":view"))?.[1];
    expect(raw).toContain(field); expect(first.vm.pendingLocalChanges).toBe(false);
    const next = await mounted(draftStorage);
    await next.findAll("button").find(button => button.text() === "继续上次位置")!.trigger("click");
    await vi.dynamicImportSettled(); await flushPromises();
    const form = tool === "params" ? next.getComponent(ParamEditor) : next.getComponent(RuleEditor);
    expect(form.findAll("input").some(input => (input.element as HTMLInputElement).value === field)).toBe(true);
    expect(next.vm.pendingLocalChanges).toBe(false);
  });
});
