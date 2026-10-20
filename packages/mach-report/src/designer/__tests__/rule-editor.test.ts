import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, reactive } from "vue";
import { describe, expect, it, vi } from "vitest";
import { useRuleEditor, type RuleEditorOptions } from "../useRuleEditor";
import RuleEditor from "../RuleEditor.vue";
import ReportExpressionEditor from "../ReportExpressionEditor.vue";
import { DEFAULT_RULE_EDITOR_MESSAGES } from "../rule-messages";
import { computeDataset } from "../../analytics/computed";
import { evalStyleRule } from "../../format";
import type { ListComponent } from "../../layout/paginate";
function component(): ListComponent {
  return {
    kind: "list",
    dataset: "detail",
    leftMm: 0,
    topMm: 0,
    widthMm: 100,
    columns: [
      { field: "qty", header: "数量", widthMm: 50 },
      { field: "price", header: "单价", widthMm: 50 },
    ],
  };
}
function setup(extra: Partial<RuleEditorOptions> = {}) {
  const props = reactive<RuleEditorOptions>({
    list: component(),
    datasets: {
      detail: [
        { qty: 2, price: 3 },
        { qty: 0, price: null },
      ],
    },
    ...extra,
  });
  const change = vi.fn((list: ListComponent) => {
    props.list = list;
  });
  let editor!: ReturnType<typeof useRuleEditor>;
  const wrapper = mount(
    defineComponent({
      setup() {
        editor = useRuleEditor(props, change);
        return () => h("div");
      },
    }),
  );
  return { props, change, editor, wrapper };
}
describe("declarative rule editor", () => {
  it("builds, checks, applies and removes computed columns without mutating source values", async () => {
    const { props, change, editor, wrapper } = setup();
    editor.formula.value = {
      field: "amount",
      expression: {
        op: "multiply",
        args: [{ field: "qty" }, { field: "price" }],
      },
    };
    editor.check();
    expect(editor.preview.value.map((item) => item.value)).toEqual([6, null]);
    editor.applyComputed();
    await nextTick();
    expect(change).toHaveBeenCalledTimes(1);
    expect(props.list.computed?.[0]?.field).toBe("amount");
    expect(props.list.columns.at(-1)).toMatchObject({
      field: "amount",
      editable: false,
    });
    expect(props.datasets!.detail![0]!.qty).toBe(2);
    editor.loadComputed("amount");
    editor.removeComputed();
    await nextTick();
    expect(props.list.computed).toEqual([]);
    wrapper.unmount();
  });
  it("blocks circular dependencies and explains sample errors", () => {
    const { editor, change, wrapper } = setup();
    editor.formula.value = { field: "loop", expression: { field: "loop" } };
    expect(editor.diagnostics.value.valid).toBe(false);
    editor.applyComputed();
    expect(change).not.toHaveBeenCalled();
    expect(editor.error.value).toMatch(/循环/);
    editor.formula.value = {
      field: "division",
      expression: { op: "divide", args: [{ value: 1 }, { value: 0 }] },
    };
    editor.check();
    expect(editor.error.value).toMatch(/除以零/);
    wrapper.unmount();
  });
  it("maintains grouping order and validates aggregate weights", async () => {
    const { editor, props, change, wrapper } = setup();
    editor.addGroup();
    editor.currentGroup.value!.field = "qty";
    editor.addAggregate();
    editor.currentGroup.value!.aggregates![0]!.op = "weightedAvg";
    editor.applyGroups();
    expect(change).not.toHaveBeenCalled();
    expect(editor.error.value).toMatch(/权重/);
    editor.currentGroup.value!.aggregates![0]!.weightField = "price";
    editor.addGroup();
    editor.currentGroup.value!.field = "price";
    editor.moveGroup(-1);
    editor.applyGroups();
    await nextTick();
    expect(props.list.groups?.map((group) => group.field)).toEqual([
      "price",
      "qty",
    ]);
    expect(props.list.groupBy).toBeUndefined();
    wrapper.unmount();
  });
  it("applies and removes actual conditional style/cell/row visibility", async () => {
    const { editor, props, wrapper } = setup();
    editor.when.value = { field: "qty", op: ">", value: 0 };
    editor.applyCondition();
    await nextTick();
    expect(props.list.columns[0]!.rules).toHaveLength(1);
    editor.effect.value = "cell";
    editor.loadCondition(-1);
    editor.when.value = { field: "qty", op: ">", value: 0 };
    editor.applyCondition();
    await nextTick();
    expect(props.list.columns[0]!.visibleWhen).toMatchObject({
      field: "qty",
      value: 0,
    });
    editor.effect.value = "rowVisibility";
    editor.applyCondition();
    await nextTick();
    expect(props.list.rowVisibleWhen).toBeDefined();
    editor.applyCondition(true);
    await nextTick();
    expect(props.list.rowVisibleWhen).toBeUndefined();
    wrapper.unmount();
  });
  it("keeps exact decimal thresholds and prevents read-only writes", () => {
    const { editor, change, wrapper } = setup({
      readonly: true,
      datasetSchema: { fields: [{ field: "qty", type: "decimal" }] },
    });
    editor.when.value.field = "qty";
    editor.setThreshold("9007199254740993.01");
    expect(editor.when.value).toMatchObject({
      numeric: "decimal",
      value: "9007199254740993.01",
    });
    expect(evalStyleRule({ qty: "9007199254740994" }, editor.when.value)).toBe(
      true,
    );
    editor.applyCondition();
    editor.applyGroups();
    editor.formula.value.field = "x";
    editor.applyComputed();
    expect(change).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it("renders meaningful forms, keeps previews explicit and emits valid changes", async () => {
    const list = component(),
      wrapper = mount(RuleEditor, {
        props: { list, datasets: { detail: [{ qty: 2, price: 3 }] } },
      });
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(5);
    await wrapper.get('input[aria-label="结果字段"]').setValue("total");
    const apply = wrapper
      .findAll("button")
      .find((button) => button.text() === "应用规则")!;
    expect(apply.attributes("disabled")).toBeUndefined();
    await apply.trigger("click");
    expect(wrapper.emitted("change")![0]![0]).toMatchObject({
      computed: [{ field: "total" }],
    });
    expect(list.computed).toBeUndefined();
    wrapper.unmount();
  });
  it("displays ordinary numeric defaults for new/existing formulas and group aggregates without mutating source", async () => {
    const list = component();
    list.computed = [{ field: "copy", expression: { field: "qty" } }, { field: "exact", numeric: "decimal", expression: { field: "price" } }];
    list.groups = [{ field: "qty", aggregates: [{ field: "price", op: "sum" }, { field: "qty", op: "sum", numeric: "decimal" }] }];
    const wrapper = mount(RuleEditor, { props: { list } });
    const numeric = () => wrapper.findAll('select[aria-label="数值模式"]').map((control) => (control.element as HTMLSelectElement).value);
    expect(numeric()).toEqual(["number"]);
    expect((wrapper.get('select[aria-label="数值模式"]').element as HTMLSelectElement).selectedOptions[0]!.textContent).toBe("普通数值");
    await wrapper.get('select[aria-label="已有规则"]').setValue("copy"); expect(numeric()).toEqual(["number"]);
    await wrapper.get('select[aria-label="已有规则"]').setValue("exact"); expect(numeric()).toEqual(["decimal"]);
    await wrapper.findAll('[role="tab"]')[1]!.trigger("click"); expect(numeric()).toEqual(["number", "decimal"]);
    await wrapper.findAll("button").find((button) => button.text() === "+ 添加聚合")!.trigger("click"); expect(numeric()).toEqual(["number", "decimal", "number"]);
    expect(list.computed[0]!.numeric).toBeUndefined(); expect(list.groups[0]!.aggregates![0]!.numeric).toBeUndefined();
    expect(wrapper.emitted("change")).toBeUndefined(); wrapper.unmount();
  });
  it("gives every rule select an explicit stable accessible name independent of option text", async () => {
    const wrapper = mount(RuleEditor, { props: { list: component(), datasets: { detail: [{ qty: 2, price: 3 }] } } });
    const assertNamed = () => {
      const controls = wrapper.findAll("select");
      expect(controls.length).toBeGreaterThan(0);
      expect(controls.every((control) => !!control.attributes("aria-label")?.trim())).toBe(true);
    };
    expect(wrapper.get('select[aria-label="数值模式"]').attributes("aria-label")).toBe("数值模式");
    assertNamed();
    await wrapper.findAll('[role="tab"]')[1]!.trigger("click");
    await wrapper.findAll("button").find((button) => button.text() === "+ 添加分组")!.trigger("click");
    await wrapper.findAll("button").find((button) => button.text() === "+ 添加聚合")!.trigger("click");
    await wrapper.get('select[aria-label="聚合"]').setValue("weightedAvg");
    expect(wrapper.find('select[aria-label="权重字段"]').exists()).toBe(true);
    assertNamed();
    await wrapper.findAll('[role="tab"]')[2]!.trigger("click");
    assertNamed(); wrapper.unmount();
  });
  it("visual expression builder edits nested arithmetic and aggregates with JSON only", async () => {
    const wrapper = mount(ReportExpressionEditor, {
      props: {
        modelValue: { field: "qty" },
        fields: [{ field: "qty", label: "数量" }],
        messages: DEFAULT_RULE_EDITOR_MESSAGES,
      },
    });
    await wrapper.find("select").setValue("operation");
    const next = wrapper.emitted("update:modelValue")![0]![0] as Parameters<
      typeof computeDataset
    >[1]["fields"][number]["expression"];
    expect(
      computeDataset([{ qty: 2 }], {
        fields: [{ field: "x", expression: next }],
      }).rows[0]!.x,
    ).toBe(2);
    await wrapper.setProps({
      modelValue: {
        aggregate: "weightedAvg",
        field: "qty",
        weightField: "qty",
      },
    });
    expect(wrapper.find('[aria-label="权重字段"]').exists()).toBe(true);
    expect(wrapper.findAll("select").every((control) => !!control.attributes("aria-label")?.trim())).toBe(true);
    wrapper.unmount();
  });
});

it("keeps unapplied computed and condition drafts when navigating rules, and applying groups does not erase them", async () => {
  const original = component(); original.computed = [{ field: "copy", expression: { field: "qty" } }];
  const { editor, props, wrapper } = setup({ list: original });
  editor.formula.value.field = "unapplied"; editor.formula.value.expression = { op: "multiply", args: [{ field: "qty" }, { value: 4 }] };
  editor.loadComputed("copy"); expect(editor.pendingLocalChanges.value).toBe(true);
  editor.loadComputed(""); expect(editor.formula.value.field).toBe("unapplied");
  editor.when.value.value = 99; editor.column.value = "price"; editor.loadCondition(-1); editor.column.value = "qty"; editor.loadCondition(-1);
  expect(editor.when.value.value).toBe(99);
  editor.addGroup(); editor.applyGroups(); await nextTick(); expect(props.list.groups).toHaveLength(1);
  expect(editor.formula.value.field).toBe("unapplied"); expect(editor.when.value.value).toBe(99); expect(editor.pendingLocalChanges.value).toBe(true);
  editor.resetDraft(); expect(editor.pendingLocalChanges.value).toBe(false); wrapper.unmount();
});
