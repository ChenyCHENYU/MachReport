import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, reactive } from "vue";
import { describe, expect, it, vi } from "vitest";
import RuleDataLayout from "../RuleDataLayout.vue";
import RuleEditor from "../RuleEditor.vue";
import { useRuleDataLayout, type RuleDataLayoutOptions } from "../useRuleDataLayout";
import { DEFAULT_RULE_EDITOR_MESSAGES } from "../rule-messages";
import type { ListComponent } from "../../layout/paginate";
const list = (): ListComponent => ({ kind: "list", dataset: "cost", leftMm: 0, topMm: 0, widthMm: 100, columns: [{ field: "name", header: "项目", widthMm: 60 }, { field: "amount", header: "金额", widthMm: 40 }], groupBy: { field: "name" }, rowVisibleWhen: { field: "amount", op: ">", value: 0 } });
function setup() {
  const props = reactive<RuleDataLayoutOptions>({ list: list(), mode: "tree", messages: DEFAULT_RULE_EDITOR_MESSAGES, datasets: { cost: [{ id: "R", name: "总计", parentId: null, amount: "999" }, { id: "L", parentId: "R", name: "材料", amount: "0.10" }] } });
  const change = vi.fn((next: ListComponent) => { props.list = next; });
  let editor!: ReturnType<typeof useRuleDataLayout>;
  const wrapper = mount(defineComponent({ setup() { editor = useRuleDataLayout(props, change); return () => h("div"); } }));
  return { editor, props, change, wrapper };
}
describe("explicit hierarchy rule workflow", () => {
  it("checks exact leaf rollups, replaces incompatible rules explicitly and preserves the source", async () => {
    const { editor, props, wrapper } = setup(); editor.enabled.value = true;
    editor.tree.value.parentValues = "leaf-aggregate";
    editor.tree.value.aggregates = [{ field: "amount", op: "sum", numeric: "decimal", digits: 2 }];
    editor.checkTree(); expect(editor.error.value).toBe(""); expect(editor.preview.value!.rows).toEqual([["总计", "0.10"], ["　材料", "0.10"]]);
    expect(props.datasets!.cost![0]!.amount).toBe("999"); expect(editor.pendingLocalChanges.value).toBe(true);
    editor.apply(); await nextTick();
    expect(props.list.tree).toMatchObject({ input: "flat", idField: "id", parentField: "parentId", labelField: "name", parentValues: "leaf-aggregate" });
    expect(props.list.rowKey).toBe("id"); expect(props.list.groupBy).toBeUndefined(); expect(props.list.rowVisibleWhen).toBeUndefined();
    expect(editor.pendingLocalChanges.value).toBe(false); wrapper.unmount();
  });
  it("leaves an invalid rule pending and never applies a partially configured rollup", () => {
    const { editor, change, wrapper } = setup(); editor.enabled.value = true; editor.tree.value.parentValues = "leaf-aggregate";
    editor.apply(); expect(change).not.toHaveBeenCalled(); expect(editor.error.value).toContain("至少需要"); expect(editor.pendingLocalChanges.value).toBe(true);
    editor.tree.value.aggregates = [{ field: "amount", op: "sum" }]; editor.tree.value.parentValues = "source";
    editor.apply(); expect(change.mock.calls[0]![0].tree!.aggregates).toBeUndefined(); wrapper.unmount();
  });
  it("renders discoverable tree fields, nested edit limits and sample actions", async () => {
    const wrapper = mount(RuleDataLayout, { props: { list: list(), mode: "tree", messages: DEFAULT_RULE_EDITOR_MESSAGES, datasets: { cost: [{ id: "R", name: "总计", parentId: null, amount: 1 }] } } });
    await wrapper.get('input[type="checkbox"]').setValue(true);
    expect(wrapper.find('select[aria-label="节点业务键"]').exists()).toBe(true);
    await wrapper.get('select[aria-label="输入结构"]').setValue("nested");
    expect(wrapper.get('input[aria-label="子节点数组字段"]').element).toHaveProperty("value", "children");
    expect(wrapper.text()).toContain("嵌套输入首版只读");
    expect(wrapper.findAll("button").some(button => button.text() === "样例验算")).toBe(true); wrapper.unmount();
  });
  it("retains unapplied tree configuration while switching other rule tools", async () => {
    const wrapper = mount(RuleEditor, { props: { list: list(), datasets: { cost: [{ id: "R", name: "总计", parentId: null }] } } });
    const tab = (text: string) => wrapper.findAll('[role="tab"]').find(item => item.text() === text)!;
    await tab("树形").trigger("click");
    const tree = wrapper.findAllComponents(RuleDataLayout).find(item => item.props("mode") === "tree")!;
    await tree.get('input[type="checkbox"]').setValue(true); await tree.get('input[aria-label="每级缩进 · mm"]').setValue(5);
    await tab("计算").trigger("click"); await tab("树形").trigger("click");
    expect(tree.get('input[aria-label="每级缩进 · mm"]').element).toHaveProperty("value", "5");
    expect(wrapper.vm).toHaveProperty("pendingLocalChanges", true); wrapper.unmount();
  });
});
