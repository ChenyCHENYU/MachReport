import { computed, ref, watch, type Ref } from "vue";
import type { ListComponent } from "@agile-team/mach-report";

type ColumnEntry = { column: ListComponent["columns"][number]; index: number };
export type TemplateInspectorSection = "fields" | "template" | "advanced";

/** 导航属于工作台视图状态，不参与模板历史、保存或业务字段索引。 */
export function useTemplateInspector(
  columns: Readonly<Ref<ColumnEntry[]>>,
  selectedList: Ref<number>,
  list: Readonly<Ref<ListComponent | undefined>>,
  query: Ref<string>,
) {
  const section = ref<TemplateInspectorSection>("fields");
  const activeIndex = ref(columns.value[0]?.index ?? -1);
  const activeColumn = computed(() => {
    const column = list.value?.columns[activeIndex.value];
    return column ? { column, index: activeIndex.value } : undefined;
  });
  // 编辑表头可能令当前行不再匹配搜索；保留属性焦点，直到用户更换查询或区域。
  watch(query, () => {
    if (!columns.value.some((entry) => entry.index === activeIndex.value))
      activeIndex.value = columns.value[0]?.index ?? -1;
  });
  watch(selectedList, () => {
    activeIndex.value = columns.value[0]?.index ?? -1;
  });
  watch(list, (value) => {
    if (!value?.columns[activeIndex.value])
      activeIndex.value = columns.value[0]?.index ?? -1;
  });

  function activate(index: number): void {
    if (columns.value.some((entry) => entry.index === index))
      activeIndex.value = index;
  }
  function moveColumn(key: string): number | undefined {
    const entries = columns.value;
    if (!entries.length) return;
    const current = Math.max(
      0,
      entries.findIndex((entry) => entry.index === activeIndex.value),
    );
    const positions: Record<string, number> = {
      ArrowDown: Math.min(current + 1, entries.length - 1),
      ArrowUp: Math.max(current - 1, 0),
      Home: 0,
      End: entries.length - 1,
    };
    const target = positions[key];
    if (target === undefined) return;
    activeIndex.value = entries[target]!.index;
    return activeIndex.value;
  }
  return { section, activeIndex, activeColumn, activate, moveColumn };
}
