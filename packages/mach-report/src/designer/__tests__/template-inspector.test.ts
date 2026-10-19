import { computed, nextTick, ref } from "vue";
import { describe, expect, it } from "vitest";
import type { ListComponent } from "../../index";
import { useTemplateInspector } from "../useTemplateInspector";

function harness() {
  const list = ref<ListComponent | undefined>({
    kind: "list",
    leftMm: 0,
    topMm: 0,
    widthMm: 1100,
    dataset: "detail",
    columns: Array.from({ length: 55 }, (_, index) => ({
      header: `指标${index}`,
      field: `c${index}`,
      widthMm: 20,
    })),
  });
  const query = ref(""),
    selected = ref(0);
  const visible = computed(
    () =>
      list.value?.columns.flatMap((column, index) =>
        `${column.header} ${column.field}`.includes(query.value)
          ? [{ column, index }]
          : [],
      ) ?? [],
  );
  return {
    list,
    query,
    selected,
    visible,
    inspector: useTemplateInspector(visible, selected, list, query),
  };
}

describe("模板工作台导航状态", () => {
  it("搜索和区域切换保持物理索引，空结果与新模板不显示过期属性", async () => {
    const { list, query, selected, inspector } = harness();
    inspector.activate(54);
    expect(inspector.activeColumn.value?.index).toBe(54);
    query.value = "c5";
    await nextTick();
    expect(inspector.activeColumn.value?.index).toBe(54);
    query.value = "c4";
    await nextTick();
    expect(inspector.activeColumn.value?.index).toBe(4);
    query.value = "missing";
    await nextTick();
    expect(inspector.activeIndex.value).toBe(-1);
    expect(inspector.activeColumn.value).toBeUndefined();
    query.value = "";
    await nextTick();
    inspector.activate(54);
    selected.value = 1;
    await nextTick();
    expect(inspector.activeIndex.value).toBe(0);
    inspector.activate(999);
    expect(inspector.activeIndex.value).toBe(0);
    inspector.activate(54);
    list.value = { ...list.value!, columns: list.value!.columns.slice(0, 2) };
    await nextTick();
    expect(inspector.activeIndex.value).toBe(0);
    list.value = undefined;
    await nextTick();
    expect(inspector.activeColumn.value).toBeUndefined();
  });
  it("编辑搜索命中的表头不会卸载正在输入的属性", async () => {
    const { list, query, visible, inspector } = harness();
    query.value = "指标54";
    await nextTick();
    expect(inspector.activeIndex.value).toBe(54);
    list.value!.columns[54]!.header = "新的名称";
    await nextTick();
    expect(visible.value).toHaveLength(0);
    expect(inspector.activeColumn.value).toMatchObject({
      index: 54,
      column: { header: "新的名称" },
    });
    query.value = "其他名称";
    await nextTick();
    expect(inspector.activeColumn.value).toBeUndefined();
  });
  it("方向键按筛选顺序导航，首末边界不越界且不改变模板", async () => {
    const { list, query, inspector } = harness();
    query.value = "c5";
    await nextTick();
    const snapshot = JSON.stringify(list.value);
    expect(inspector.moveColumn("ArrowUp")).toBe(5);
    expect(inspector.moveColumn("ArrowDown")).toBe(50);
    expect(inspector.moveColumn("End")).toBe(54);
    expect(inspector.moveColumn("ArrowDown")).toBe(54);
    expect(inspector.moveColumn("Home")).toBe(5);
    expect(inspector.moveColumn("Escape")).toBeUndefined();
    expect(JSON.stringify(list.value)).toBe(snapshot);
    query.value = "missing";
    await nextTick();
    expect(inspector.moveColumn("Home")).toBeUndefined();
  });
});
