import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, reactive } from "vue";
import { describe, expect, it, vi } from "vitest";
import {
  useRuleDataLayout,
  type RuleDataLayoutOptions,
} from "../useRuleDataLayout";
import RuleDataLayout from "../RuleDataLayout.vue";
import { DEFAULT_RULE_EDITOR_MESSAGES } from "../rule-messages";
import { validateReportTemplate } from "../../source/template-registry";
import type { ListComponent } from "../../layout/paginate";
function list(): ListComponent {
  return {
    kind: "list",
    dataset: "master",
    rowKey: "id",
    leftMm: 0,
    topMm: 0,
    widthMm: 100,
    columns: [
      { field: "id", header: "订单", widthMm: 40 },
      { field: "plant", header: "厂区", widthMm: 30 },
      { field: "value", header: "金额", widthMm: 30 },
    ],
  };
}
function setup(mode: "detail" | "matrix") {
  const props = reactive<RuleDataLayoutOptions>({
    mode,
    list: list(),
    messages: DEFAULT_RULE_EDITOR_MESSAGES,
    datasets: {
      master: [{ id: "M1", plant: "P1", shift: "A", value: 10 }],
      child: [{ line: "C1", parent: "M1", qty: 2 }],
    },
    datasetSchemas: {
      child: {
        rowKey: "line",
        fields: [
          { field: "line", type: "text", label: "行号" },
          { field: "parent", type: "text" },
          { field: "qty", type: "number" },
        ],
      },
    },
  });
  const change = vi.fn((next: ListComponent) => {
    props.list = next;
  });
  let editor!: ReturnType<typeof useRuleDataLayout>;
  const wrapper = mount(
    defineComponent({
      setup() {
        editor = useRuleDataLayout(props, change);
        return () => h("div");
      },
    }),
  );
  return { props, change, editor, wrapper };
}
describe("visual keyed detail and matrix configuration", () => {
  it("builds a keyed detail using schema identities and selected fields", async () => {
    const { editor, props, wrapper } = setup("detail");
    editor.enabled.value = true;
    editor.chooseDataset("child");
    editor.detail.value.parentKey = "id";
    editor.detail.value.foreignKey = "parent";
    editor.toggleChildColumn("line", true);
    editor.toggleChildColumn("qty", true);
    editor.apply();
    await nextTick();
    expect(props.list.detail).toMatchObject({
      dataset: "child",
      parentKey: "id",
      foreignKey: "parent",
      rowKey: "line",
      columns: [{ field: "line", header: "行号" }, { field: "qty" }],
    });
    expect(
      validateReportTemplate({
        pages: [{ widthMm: 100, heightMm: 200, components: [props.list] }],
      }).ok,
    ).toBe(true);
    editor.enabled.value = false;
    editor.apply();
    await nextTick();
    expect(props.list.detail).toBeUndefined();
    wrapper.unmount();
  });
  it("configures a saved matrix and verifies sample output without source mutations", async () => {
    const { editor, props, wrapper } = setup("matrix");
    editor.enabled.value = true;
    editor.toggleDimension("rowFields", "plant", true);
    editor.toggleDimension("columnFields", "shift", true);
    editor.addMeasure();
    editor.matrix.value.measures[0]!.field = "value";
    editor.checkMatrix();
    expect(editor.error.value).toBe("");
    expect(editor.preview.value!.rows[0]).toEqual(["P1", 10, 10]);
    editor.apply();
    await nextTick();
    expect(props.list.matrix).toMatchObject({
      rowFields: ["plant"],
      columnFields: ["shift"],
      measures: [{ field: "value", op: "sum" }],
    });
    expect(props.datasets!.master![0]!.value).toBe(10);
    wrapper.unmount();
  });
  it("reports invalid matrix configuration, uses explicit exclusive layout changes and readonly guards", async () => {
    const { editor, props, change, wrapper } = setup("matrix");
    editor.enabled.value = true;
    editor.checkMatrix();
    expect(editor.error.value).toMatch(/矩阵/);
    props.list.groups = [{ field: "plant" }];
    props.list.grandTotal = true;
    editor.toggleDimension("rowFields", "plant", true);
    editor.toggleDimension("columnFields", "shift", true);
    editor.addMeasure();
    editor.matrix.value.measures[0]!.field = "value";
    editor.apply();
    await nextTick();
    expect(props.list.groups).toBeUndefined();
    expect(props.list.grandTotal).toBeUndefined();
    props.readonly = true;
    const count = change.mock.calls.length;
    editor.apply();
    expect(change).toHaveBeenCalledTimes(count);
    wrapper.unmount();
  });
  it("keeps detail and matrix selects explicitly named for keyboard and screen-reader use", async () => {
    for (const mode of ["detail", "matrix"] as const) {
      const wrapper = mount(RuleDataLayout, { props: { mode, list: list(), messages: DEFAULT_RULE_EDITOR_MESSAGES, datasets: { master: [{ plant: "P1", shift: "A", value: 10 }], child: [{ id: "C1", parent: "M1", qty: 0 }] } } });
      await wrapper.find('input[type="checkbox"]').setValue(true);
      if (mode === "matrix") {
        await wrapper.findAll("button").find((button) => button.text() === "+ 添加聚合")!.trigger("click");
        await wrapper.get('select[aria-label="聚合"]').setValue("weightedAvg");
        expect(wrapper.get('select[aria-label="度量字段"]').attributes("aria-label")).toBe("度量字段");
      } else expect(wrapper.get('select[aria-label="明细数据集"]').attributes("aria-label")).toBe("明细数据集");
      const controls = wrapper.findAll("select"); expect(controls.length).toBeGreaterThan(2);
      expect(controls.every((control) => !!control.attributes("aria-label")?.trim())).toBe(true); wrapper.unmount();
    }
  });
  it("renders dataset, keys, selectable fields and actual matrix sample controls", async () => {
    const wrapper = mount(RuleDataLayout, {
      props: {
        mode: "matrix",
        list: list(),
        messages: DEFAULT_RULE_EDITOR_MESSAGES,
        datasets: { master: [{ plant: "P1", shift: "A", value: 10 }] },
      },
    });
    await wrapper.find('input[type="checkbox"]').setValue(true);
    expect(wrapper.text()).toContain("行维度");
    expect(wrapper.text()).toContain("列维度");
    expect(
      wrapper.findAll("button").some((button) => button.text() === "样例验算"),
    ).toBe(true);
    await wrapper.findAll("button").find((button) => button.text() === "+ 添加聚合")!.trigger("click");
    expect(wrapper.get(".mr-data-layout__measure").text()).toContain("显示名称");
    wrapper.unmount();
  });
});
