import { describe, it, expect } from "vitest";
import { reactive } from "vue";
import { mount } from "@vue/test-utils";
import RuleEditor from "../RuleEditor.vue";
import ReportExpressionEditor from "../ReportExpressionEditor.vue";
import ReportPredicateEditor from "../ReportPredicateEditor.vue";
import { useRuleEditor } from "../useRuleEditor";
import { DEFAULT_RULE_EDITOR_MESSAGES as m } from "../rule-messages";
import type { ListComponent } from "../../layout/list-model";
import type { ReportPredicate } from "../../processing/predicate";
const condition: ReportPredicate = { all: [{ field: "input", op: ">=", right: { field: "output" }, valueType: "decimal" }, { field: "output", op: "between", values: [0, 10], valueType: "decimal" }] };
const list = (): ListComponent => ({ kind: "list", dataset: "detail", topMm: 0, leftMm: 0, widthMm: 100, columns: [{ header: "入", field: "input", widthMm: 50 }, { header: "出", field: "output", widthMm: 50 }] });
describe("composed condition and true function editor", () => {
  it("applies, reloads and removes composed style and visibility conditions without flattening their structure", () => {
    const props = reactive({ list: list(), datasets: { detail: [{ input: "4", output: "3" }] } });
    const editor = useRuleEditor(props, value => { props.list = value; });
    editor.setCondition(condition); editor.applyCondition();
    expect(props.list.columns[0]?.rules?.[0]?.when).toEqual(condition);
    editor.loadCondition(0); expect(editor.condition.value).toEqual(condition);
    editor.effect.value = "rowVisibility"; editor.loadCondition(-1); editor.setCondition(condition); editor.applyCondition();
    expect(props.list.rowVisibleWhen).toEqual(condition);
    editor.loadCondition(-1); expect(editor.condition.value).toEqual(condition);
    editor.applyCondition(true); expect(props.list.rowVisibleWhen).toBeUndefined();
  });
  it("retains unapplied composed conditions while switching between columns and restores a clean draft", () => {
    const props = reactive({ list: list() }); const editor = useRuleEditor(props, value => { props.list = value; });
    editor.setCondition(condition); editor.column.value = "output"; editor.loadCondition(-1);
    editor.column.value = "input"; editor.loadCondition(-1); expect(editor.condition.value).toEqual(condition);
    editor.resetDraft(); expect(editor.pendingLocalChanges.value).toBe(false);
  });
  it("lets users add AND/OR/NOT and field-to-field comparisons through named controls", async () => {
    const wrapper = mount(ReportPredicateEditor, { props: { modelValue: { field: "input", op: ">", value: 0 }, fields: [{ field: "input", label: "入" }, { field: "output", label: "出" }], messages: m } });
    await wrapper.get('select[aria-label="比较值"]').setValue("field");
    expect(wrapper.emitted("update:modelValue")?.at(-1)?.[0]).toMatchObject({ right: { field: "input" } });
    await wrapper.get('select[aria-label="条件组合"]').setValue("all");
    expect(wrapper.emitted("update:modelValue")?.at(-1)?.[0]).toMatchObject({ all: [{ field: "input" }] });
    wrapper.unmount();
  });
  it("offers only supported function arities and attaches a real IF predicate with lazy branch hints", async () => {
    const wrapper = mount(ReportExpressionEditor, { props: { modelValue: { op: "add", args: [{ value: 2 }, { value: 3 }, { value: 4 }] }, fields: [{ field: "input", label: "入" }], messages: m } });
    await wrapper.get('select[aria-label="运算"]').setValue("abs");
    expect(wrapper.emitted("update:modelValue")?.at(-1)?.[0]).toEqual({ op: "abs", args: [{ value: 2 }] });
    await wrapper.get('select[aria-label="运算"]').setValue("if");
    expect(wrapper.emitted("update:modelValue")?.at(-1)?.[0]).toMatchObject({ op: "if", args: [{ value: 2 }, { value: 3 }], condition: { field: "input", op: ">", value: 0 } });
    wrapper.unmount();
  });
  it("renders grouped rules through the ordinary designer panel with explicit accessible controls", async () => {
    const value = list(); value.columns[0]!.rules = [{ when: condition, style: { bold: true } }];
    const wrapper = mount(RuleEditor, { props: { list: value } });
    const buttons = wrapper.findAll('[role="tab"]'); await buttons.find(button => button.text().includes(m.conditions))!.trigger("click");
    expect(wrapper.findAll("select").every(control => !!control.attributes("aria-label"))).toBe(true);
    expect(wrapper.text()).toContain(m.conditionGroup); wrapper.unmount();
  });
});
