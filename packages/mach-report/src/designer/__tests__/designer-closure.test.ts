import { flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTableTemplate, defineReportTemplate, type ListComponent } from "../../index";
import TemplateReviewPanel from "../TemplateReviewPanel.vue";
import RuleEditor from "../RuleEditor.vue";
import ReportTemplateEditor from "../ReportTemplateEditor.vue";
import TemplateDesignCanvas from "../TemplateDesignCanvas.vue";
function document() {
  return defineReportTemplate({ id: "closure", name: "Closure", template: createTableTemplate({ layout: "wide", columns: [{ field: "id", header: "编号", semanticRole: "identifier", align: "auto" }, { field: "qty", header: "重量", semanticRole: "measure", align: "auto", format: { kind: "number", digits: 3 } }] }) });
}
function list(): ListComponent { return document().template.pages[0]!.components.find(item => item.kind === "list") as ListComponent; }
const schemas = { detail: { fields: [{ field: "id", type: "text" as const }, { field: "qty", type: "number" as const, unit: "kg" }] } };
afterEach(() => vi.useRealTimers());
async function run(wrapper: ReturnType<typeof mount>) {
  await wrapper.findAll("button").find(button => button.text() === "运行检查")!.trigger("click");
  await vi.waitFor(() => expect(wrapper.attributes("aria-busy")).toBe("false"), { timeout: 1000, interval: 5 }); await flushPromises();
}
describe("designer review and local draft closure", () => {
  it("invalidates every reviewed input and the tested scope, never showing a previous green summary", async () => {
    const datasets = reactive({ detail: Array.from({ length: 25 }, (_, i) => ({ id: String(i), qty: i })) });
    const wrapper = mount(TemplateReviewPanel, { props: { document: document(), datasets, dataSchemas: schemas, formats: ["pdf"] } });
    await run(wrapper); expect(wrapper.get(".mr-review-summary").text()).toContain("0 错误");
    expect(wrapper.get(".mr-review-scope").text()).toContain("20 行");
    await wrapper.get("select").setValue("-1"); expect(wrapper.find(".mr-review-summary").exists()).toBe(false); expect(wrapper.get(".mr-review-stale").text()).toContain("旧结果已失效");
    await run(wrapper); expect(wrapper.get(".mr-review-scope").text()).toContain("25 行");
    for (const change of [
      () => wrapper.setProps({ previous: document() }),
      () => wrapper.setProps({ document: { ...document(), name: "Changed" } }),
      () => wrapper.setProps({ dataSchemas: { detail: { fields: [{ field: "qty", type: "number", min: 0 }] } } }),
      () => wrapper.setProps({ formats: ["xlsx"] }),
      async () => { datasets.detail[0]!.qty = -1; await flushPromises(); },
    ]) {
      await change(); expect(wrapper.find(".mr-review-summary").exists()).toBe(false); await run(wrapper);
    }
    expect(wrapper.get(".mr-review-summary").text()).toContain("2 错误"); expect(wrapper.text()).toContain("数值超出范围"); wrapper.unmount();
  });
  it("confirmation changes require a new review and a replaced scheduled run cannot publish stale results", async () => {
    const previous = document(), next = document(); (next.template.pages[0]!.components.find(item => item.kind === "list") as ListComponent).columns.pop();
    const wrapper = mount(TemplateReviewPanel, { props: { document: next, previous, datasets: { detail: [{ id: "a", qty: 1 }] } } });
    await run(wrapper); await wrapper.get('.mr-review-ack input[type="checkbox"]').setValue(true);
    expect(wrapper.find(".mr-review-summary").exists()).toBe(false); await run(wrapper);
    expect(wrapper.get(".mr-review-summary").text()).toContain("0 错误");
    vi.useFakeTimers(); await wrapper.findAll("button").find(button => button.text() === "运行检查")!.trigger("click");
    await wrapper.setProps({ document: document() }); await vi.runAllTimersAsync();
    expect(wrapper.find(".mr-review-summary").exists()).toBe(false); expect(wrapper.attributes("aria-busy")).toBe("false"); wrapper.unmount();
  });
  it("binds compatibility acknowledgement to the current document and baseline while retaining it across sample data changes", async () => {
    const previous = reactive(document()), next = reactive(document());
    (next.template.pages[0]!.components.find(item => item.kind === "list") as ListComponent).columns.pop();
    const datasets = reactive({ detail: [{ id: "a", qty: 1 }] });
    const wrapper = mount(TemplateReviewPanel, { props: { document: next, previous, datasets } });
    const checked = () => (wrapper.get('.mr-review-ack input[type="checkbox"]').element as HTMLInputElement).checked;
    await run(wrapper); await wrapper.get('.mr-review-ack input[type="checkbox"]').setValue(true); await run(wrapper);
    expect(wrapper.get(".mr-review-summary").text()).toContain("0 错误");
    datasets.detail[0]!.qty = 2; await flushPromises();
    expect(checked()).toBe(true); expect(wrapper.find(".mr-review-summary").exists()).toBe(false);
    await run(wrapper); expect(wrapper.get(".mr-review-summary").text()).toContain("0 错误");
    (next.template.pages[0]!.components.find(item => item.kind === "list") as ListComponent).columns[0]!.header = "新业务列";
    await flushPromises(); expect(checked()).toBe(false); expect(wrapper.find(".mr-review-summary").exists()).toBe(false);
    await run(wrapper); expect(wrapper.text()).toContain("需要明确确认兼容性");
    await wrapper.get('.mr-review-ack input[type="checkbox"]').setValue(true); await run(wrapper);
    expect(wrapper.get(".mr-review-summary").text()).toContain("0 错误");
    (previous.template.pages[0]!.components.find(item => item.kind === "list") as ListComponent).columns.push({ field: "extra", header: "新增基线字段", widthMm: 10 });
    await flushPromises(); expect(checked()).toBe(false); expect(wrapper.find(".mr-review-summary").exists()).toBe(false);
    await run(wrapper); expect(wrapper.text()).toContain("需要明确确认兼容性"); wrapper.unmount();
  });
  it("preserves unapplied formula, grouping, detail and matrix drafts across tabs and guards the host editor", async () => {
    const wrapper = mount(ReportTemplateEditor, { props: { modelValue: document(), datasets: { detail: [{ id: "a", qty: 2 }] }, dataSchemas: schemas }, global: { stubs: { ReportPreview: true } } });
    await wrapper.findAll('[role="tab"]').find(button => button.text() === "工具")!.trigger("click"); await flushPromises();
    await wrapper.findAll("button").find(button => button.text() === "计算与规则")!.trigger("click"); await flushPromises(); await vi.dynamicImportSettled();
    const rules = wrapper.getComponent(RuleEditor);
    await rules.get('input[aria-label="结果字段"]').setValue("pending_total");
    expect((wrapper.vm as unknown as { pendingLocalChanges: boolean }).pendingLocalChanges).toBe(true);
    await wrapper.findAll('[role="tab"]').find(button => button.text() === "模板")!.trigger("click");
    await wrapper.findAll('[role="tab"]').find(button => button.text() === "工具")!.trigger("click");
    expect((rules.get('input[aria-label="结果字段"]').element as HTMLInputElement).value).toBe("pending_total");
    const guard = (wrapper.vm as unknown as { guardChanges(): Promise<boolean> }).guardChanges(); await flushPromises();
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(true); await wrapper.findAll('[role="alertdialog"] button')[0]!.trigger("click"); expect(await guard).toBe(false);
    await rules.findAll("button").find(button => button.text() === "恢复工具草稿")!.trigger("click");
    expect((wrapper.vm as unknown as { pendingLocalChanges: boolean }).pendingLocalChanges).toBe(false); wrapper.unmount();
  });
  it("searches explicit metadata and explains actual source and engine results without mutating data", async () => {
    const data = { detail: [{ id: "a", qty: 2 }, { id: "b", qty: null }] };
    const wrapper = mount(RuleEditor, { props: { list: list(), datasets: data, datasetSchema: schemas.detail } });
    await wrapper.get('input[aria-label="搜索字段、类型或单位"]').setValue("kg");
    expect(wrapper.findAll(".mr-rule-editor__field-list button")).toHaveLength(1); expect(wrapper.get(".mr-rule-editor__field-list").text()).toContain("3 小数位");
    await wrapper.get('input[aria-label="结果字段"]').setValue("copy");
    await wrapper.get(".mr-rule-editor__field-list button").trigger("click");
    await wrapper.findAll("button").find(button => button.text() === "样例验算")!.trigger("click");
    expect(wrapper.get(".mr-rule-editor__explanation").text()).toContain("qty = 2"); expect(wrapper.get(".mr-rule-editor__explanation").text()).toContain("空值依规则保留");
    await wrapper.get('input[aria-label="结果字段"]').setValue("changed"); expect(wrapper.get(".mr-rule-editor__explanation").text()).toContain("修改后请重新验算");
    expect(data.detail[0]!.qty).toBe(2); expect(wrapper.emitted("change")).toBeUndefined(); wrapper.unmount();
  });
  it("canvas samples immediately use production alignment, precision, zero and conditional styles", () => {
    const doc = document(), component = doc.template.pages[0]!.components.find(item => item.kind === "list") as ListComponent;
    component.columns[1]!.rules = [{ when: { field: "qty", op: ">", value: 1 }, style: { color: "#b91c1c", bold: true } }];
    const wrapper = mount(TemplateDesignCanvas, { props: { document: doc, pageIndex: 0, datasets: { detail: [{ id: "0001", qty: 2 }, { id: "0002", qty: 0 }, { id: "0003", qty: null }, { id: "0004", qty: 5 }] } } });
    const rows = wrapper.findAll(".mr-canvas-table-row:not(.is-header)"); expect(rows).toHaveLength(3);
    expect(rows[0]!.findAll("div")[0]!.attributes("style")).toContain("text-align: center");
    expect(rows[0]!.findAll("div")[1]!.text()).toBe("2.000"); expect(rows[0]!.findAll("div")[1]!.attributes("style")).toContain("text-align: right");
    expect(rows[1]!.text()).toContain("0.000"); expect(rows[2]!.findAll("div")[1]!.text()).toBe(""); wrapper.unmount();
  });
});
