import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, expect, it } from "vitest";
import { createTableTemplate, defineReportTemplate, paginateTemplate, type DatasetContract, type ReportTemplateDocument } from "../../index";
import ReportTemplateEditor from "../ReportTemplateEditor.vue";
import ComponentDataBinding from "../ComponentDataBinding.vue";
import TemplateRepeatInspector from "../TemplateRepeatInspector.vue";

const cleanup: VueWrapper[] = [];
afterEach(() => cleanup.splice(0).forEach(wrapper => wrapper.unmount()));
function editor() {
  const template = createTableTemplate({ layout: "wide", columns: [{ field: "qty", header: "数量" }, { field: "heat", header: "炉号" }] });
  const list = template.pages[0]!.components.find(component => component.kind === "list")!;
  delete list.align;
  list.columns.forEach(column => { delete column.align; delete column.style; });
  const wrapper = mount(ReportTemplateEditor, {
    props: { modelValue: defineReportTemplate({ id: "productivity", name: "生产", template }) },
    global: { stubs: { ReportPreview: true, TemplateDesignCanvas: true } },
  });
  cleanup.push(wrapper);
  return wrapper;
}
it("omitted body alignment selects the same auto policy as layout", () => {
  const wrapper = editor();
  expect(wrapper.get('[role="radiogroup"][aria-label="正文对齐"] [data-align="auto"]').attributes("aria-checked")).toBe("true");
  const result = paginateTemplate((wrapper.props("modelValue") as ReportTemplateDocument).template, { detail: [{ qty: 1, heat: "22W001" }] });
  const cells = result.plan.pages[0]!.components.find(component => component.table?.role === "body")!.grid!.cells[0]!;
  expect(cells.map(cell => cell?.style?.align)).toEqual(["center", "left"]);
  expect(cells.map(cell => cell?.text)).toEqual(["1", "22W001"]);
});
it("record field binding bounds candidates and can reach schema field 2048", async () => {
  const schema: DatasetContract = { fields: Array.from({ length: 2048 }, (_, index) => ({ field: `f${index}`, label: `字段${index}`, type: "number" })) };
  const wrapper = mount(ComponentDataBinding, { props: { component: { kind: "text", leftMm: 0, topMm: 0, widthMm: 30, heightMm: 10, text: "", binding: { field: "legacy" } }, repeat: { dataset: "detail" }, schema } });
  cleanup.push(wrapper);
  expect(wrapper.findAll("option").length).toBeLessThanOrEqual(100);
  const input = wrapper.get('[data-mr-control="binding-field"]');
  expect(input.attributes("role")).toBe("combobox");
  await input.trigger("focus");
  await input.trigger("keydown", { key: "End" });
  await input.trigger("keydown", { key: "Enter" });
  expect(wrapper.emitted("change")?.at(-1)).toEqual([{ field: "f2047" }]);
});
it("keeps practical batch width controls in the existing selected field area", async () => {
  const wrapper = editor();
  await wrapper.get(".mr-designer-field-trigger").trigger("click");
  await wrapper.get('.mr-designer-column-row input[type="checkbox"]').setValue(true);
  expect(wrapper.find('[data-mr-control="batch-width"]').exists()).toBe(true);
});
it("label record keys and copy fields share bounded selectors while retaining legacy values", async () => {
  const schema: DatasetContract = { fields: Array.from({ length: 2048 }, (_, index) => ({ field: `f${index}`, label: `字段${index}`, type: "number" })) };
  const document = defineReportTemplate({ id: "labels", name: "标签", template: { repeat: { dataset: "detail", rowKey: "legacy", copies: { field: "legacyCopies" } }, pages: [{ widthMm: 80, heightMm: 55, components: [] }] } });
  const wrapper = mount(TemplateRepeatInspector, { props: { document, schemas: { detail: schema } } });
  cleanup.push(wrapper);
  const key = wrapper.get('[data-mr-control="repeat-row-key"]');
  expect((key.element as HTMLInputElement).value).toBe("legacy");
  await key.trigger("focus"); await key.trigger("keydown", { key: "End" });
  expect(wrapper.findAll('[role="option"]').length).toBeLessThanOrEqual(100);
  await key.trigger("keydown", { key: "Enter" });
  expect(wrapper.emitted("change")?.at(-1)).toEqual([{ dataset: "detail", rowKey: "f2047", copies: { field: "legacyCopies" } }]);
  const copies = wrapper.get('[data-mr-control="repeat-copies-field"]');
  await copies.trigger("focus"); await copies.trigger("keydown", { key: "End" }); await copies.trigger("keydown", { key: "Enter" });
  expect(wrapper.emitted("change")?.at(-1)).toEqual([{ dataset: "detail", rowKey: "legacy", copies: { field: "f2047" } }]);
  await key.setValue("");
  expect(wrapper.emitted("change")?.at(-1)).toEqual([{ dataset: "detail", copies: { field: "legacyCopies" } }]);
});
