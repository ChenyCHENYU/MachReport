import { computed, nextTick, ref } from "vue";
import { describe, expect, it } from "vitest";
import type { ListComponent } from "../../index";
import { useTemplateInspector } from "../useTemplateInspector";
import { getTemplateColumnCursor } from "../useTemplateDirectory";

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
    inspector: useTemplateInspector(selected, list),
  };
}

describe("模板工作台导航状态", () => {
  it("搜索取消保留物理索引，区域与新模板不显示过期属性", async () => {
    const { list, query, selected, inspector } = harness();
    inspector.activate(54);
    expect(inspector.activeColumn.value?.index).toBe(54);
    query.value = "c5";
    await nextTick();
    expect(inspector.activeColumn.value?.index).toBe(54);
    query.value = "c4";
    await nextTick();
    expect(inspector.activeColumn.value?.index).toBe(54);
    query.value = "missing";
    await nextTick();
    expect(inspector.activeIndex.value).toBe(54);
    expect(inspector.activeColumn.value?.index).toBe(54);
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
    inspector.activate(54);
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
    expect(inspector.activeColumn.value?.index).toBe(54);
  });
  it("前后字段沿完整物理列导航，不受保留的目录搜索限制", async () => {
    const { list, query, inspector } = harness();
    query.value = "c5";
    await nextTick();
    inspector.activate(5);
    inspector.stepColumn(1);
    expect(inspector.activeColumn.value?.index).toBe(6);
    inspector.stepColumn(-1);
    expect(inspector.activeColumn.value?.index).toBe(5);
    inspector.activate(54);
    inspector.stepColumn(1);
    expect(inspector.activeColumn.value?.index).toBe(54);
    query.value = "";
    await nextTick();
    inspector.activate(0);
    inspector.stepColumn(-1);
    expect(inspector.activeColumn.value?.index).toBe(0);
    list.value = undefined;
    await nextTick();
    inspector.stepColumn(1);
    expect(inspector.activeColumn.value).toBeUndefined();
  });
  it("目录候选按筛选顺序导航但不提交活动字段，首末边界不越界", async () => {
    const { list, query, visible, inspector } = harness();
    query.value = "c5";
    await nextTick();
    const snapshot = JSON.stringify(list.value),
      indices = visible.value.map((entry) => entry.index);
    expect(getTemplateColumnCursor(indices, 5, "ArrowUp")).toBe(5);
    expect(getTemplateColumnCursor(indices, 5, "ArrowDown")).toBe(50);
    expect(getTemplateColumnCursor(indices, 50, "End")).toBe(54);
    expect(getTemplateColumnCursor(indices, 54, "ArrowDown")).toBe(54);
    expect(getTemplateColumnCursor(indices, 54, "Home")).toBe(5);
    expect(getTemplateColumnCursor(indices, 5, "Escape")).toBeUndefined();
    expect(getTemplateColumnCursor([], 5, "Home")).toBeUndefined();
    expect(inspector.activeIndex.value).toBe(0);
    expect(JSON.stringify(list.value)).toBe(snapshot);
  });
});
