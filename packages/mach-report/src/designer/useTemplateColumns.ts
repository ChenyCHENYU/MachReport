import { computed, ref, type Ref } from "vue";
import {
  resolveGridLayout,
  type ListComponent,
  type ReportTemplateDocument,
} from "@agile-team/mach-report";

export function useTemplateColumns(
  draft: Ref<ReportTemplateDocument>,
  valid: () => boolean,
  canEdit: () => boolean,
  changed: () => void,
) {
  const selected = ref(0);
  const query = ref("");
  const selectedColumns = ref<number[]>([]);
  const lists = computed(() =>
    draft.value.template.pages.flatMap((page, pageIndex) =>
      page.components.flatMap((component, componentIndex) =>
        component.kind === "list"
          ? [{ component, pageIndex, componentIndex }]
          : [],
      ),
    ),
  );
  const activeList = computed<ListComponent | undefined>(
    () => lists.value[selected.value]?.component,
  );
  const headerAlignments = computed(() => {
    const list = activeList.value;
    if (!list) return [];
    // 与分页器一致：正文列样式参与表头基样式，随后按列表、列的表头配置覆盖。
    const styles = list.columns.map(
      (column) =>
        column.headerStyle?.align ??
        column.headerAlign ??
        list.headerStyle?.align ??
        list.headerAlign ??
        column.style?.align ??
        "center",
    );
    if (list.headerGrid && valid()) {
      for (const box of resolveGridLayout(list.headerGrid, list.widthMm, 100)
        .cells) {
        for (
          let index = box.ci;
          index < box.ci + (box.cell.colSpan ?? 1);
          index++
        )
          styles[index] = box.cell.style?.align ?? "left";
      }
    }
    return styles;
  });

  const visibleColumns = computed(() => {
    const terms = query.value
      .trim()
      .toLocaleLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return (activeList.value?.columns ?? []).flatMap((column, index) => {
      const text = `${column.header} ${column.field}`.toLocaleLowerCase();
      return terms.every((term) => text.includes(term))
        ? [{ column, index }]
        : [];
    });
  });
  function toggleColumn(index: number, checked: boolean): void {
    selectedColumns.value = checked
      ? [...new Set([...selectedColumns.value, index])]
      : selectedColumns.value.filter((value) => value !== index);
  }
  function selectVisible(checked: boolean): void {
    for (const item of visibleColumns.value) toggleColumn(item.index, checked);
  }
  function clearSelection(): void {
    selectedColumns.value = [];
  }
  function setColumn(
    index: number,
    key:
      | "header"
      | "field"
      | "widthMm"
      | "align"
      | "headerAlign"
      | "semanticRole"
      | "editable"
      | "hidden",
    value: string | boolean,
  ): void {
    if (!canEdit()) return;
    const column = activeList.value?.columns[index];
    if (!column) return;
    if (
      key === "hidden" &&
      value === true &&
      !activeList.value?.columns.some(
        (item, position) => position !== index && !item.hidden,
      )
    )
      return;
    Object.assign(column, { [key]: key === "widthMm" ? Number(value) : value });
    if (key === "header") updateMergedHeader(index, String(value));
    if (key === "headerAlign")
      updateMergedHeaderAlignment(
        index,
        value as "left" | "center" | "right" | "justify",
      );
    if (key === "widthMm") updateWidths();
    changed();
  }
  function updateWidths(): void {
    const target = lists.value[selected.value];
    if (!target) return;
    const list = target.component,
      page = draft.value.template.pages[target.pageIndex]!;
    const widths = list.columns.map((column) => column.widthMm);
    if (list.headerGrid) list.headerGrid.colWidthsMm = widths;
    if (
      page.layout === "wide" &&
      widths.every((width) => Number.isFinite(width) && width > 0)
    ) {
      list.widthMm = widths.reduce((sum, width) => sum + width, 0);
      page.widthMm =
        Math.max(
          ...page.components.map(
            (component) => component.leftMm + component.widthMm,
          ),
        ) + (page.marginRightMm ?? 0);
    }
  }
  function updateMergedHeader(index: number, text: string): void {
    const list = activeList.value;
    if (!list?.headerGrid) return;
    const boxes = resolveGridLayout(list.headerGrid, list.widthMm, 100).cells;
    const box = boxes
      .filter(({ ci, cell }) => ci <= index && ci + (cell.colSpan ?? 1) > index)
      .slice(-1)[0];
    if (!box) return;
    Object.assign(box.cell, { text, rawText: text, value: text });
    list.columns
      .slice(box.ci, box.ci + (box.cell.colSpan ?? 1))
      .forEach((item) => {
        item.header = text;
      });
  }
  function updateMergedHeaderAlignment(
    index: number,
    align: "left" | "center" | "right" | "justify",
  ): void {
    const list = activeList.value;
    const column = list?.columns[index];
    if (column?.headerStyle?.align !== undefined)
      column.headerStyle = { ...column.headerStyle, align };
    if (!list?.headerGrid) return;
    const boxes = resolveGridLayout(list.headerGrid, list.widthMm, 100).cells;
    const box = boxes
      .filter(({ ci, cell }) => ci <= index && ci + (cell.colSpan ?? 1) > index)
      .slice(-1)[0];
    if (!box) return;
    box.cell.style = { ...box.cell.style, align };
    list.columns
      .slice(box.ci, box.ci + (box.cell.colSpan ?? 1))
      .forEach((item) => {
        item.headerAlign = align;
        if (item.headerStyle?.align !== undefined)
          item.headerStyle = { ...item.headerStyle, align };
      });
  }

  function alignColumns(
    target: "align" | "headerAlign",
    align: "auto" | "left" | "center" | "right" | "justify",
  ): void {
    if (!canEdit() || (target === "headerAlign" && align === "auto")) return;
    for (const index of selectedColumns.value) {
      const column = activeList.value?.columns[index];
      if (!column) continue;
      Object.assign(column, { [target]: align });
      if (target === "headerAlign")
        updateMergedHeaderAlignment(
          index,
          align as "left" | "center" | "right" | "justify",
        );
    }
    changed();
  }
  return {
    selected,
    query,
    selectedColumns,
    lists,
    activeList,
    headerAlignments,
    visibleColumns,
    toggleColumn,
    selectVisible,
    clearSelection,
    setColumn,
    alignColumns,
  };
}
