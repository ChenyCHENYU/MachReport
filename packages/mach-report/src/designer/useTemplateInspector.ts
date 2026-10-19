import { computed, ref, watch, type Ref } from "vue";
import type { ListComponent } from "@agile-team/mach-report";

export type TemplateInspectorSection =
  | "fields"
  | "component"
  | "template"
  | "tools"
  | "advanced";

/** 已选字段独立于目录的临时搜索与候选焦点，取消挑选不会丢失当前属性。 */
export function useTemplateInspector(
  selectedList: Ref<number>,
  list: Readonly<Ref<ListComponent | undefined>>,
) {
  const section = ref<TemplateInspectorSection>("fields");
  const firstIndex = () => (list.value?.columns.length ? 0 : -1);
  const activeIndex = ref(firstIndex());
  const activeColumn = computed(() => {
    const column = list.value?.columns[activeIndex.value];
    return column ? { column, index: activeIndex.value } : undefined;
  });
  watch(selectedList, () => {
    activeIndex.value = firstIndex();
  });
  watch(list, (value) => {
    if (!value?.columns[activeIndex.value]) activeIndex.value = firstIndex();
  });
  function activate(index: number): void {
    if (list.value?.columns[index]) activeIndex.value = index;
  }
  function stepColumn(delta: -1 | 1): void {
    const count = list.value?.columns.length ?? 0;
    if (count)
      activeIndex.value = Math.max(
        0,
        Math.min(count - 1, activeIndex.value + delta),
      );
  }
  return { section, activeIndex, activeColumn, activate, stepColumn };
}
