import { computed, ref, watch } from "vue";
import type { DatasetContract, ListComponent } from "@agile-team/mach-report";
import type { useTemplateEditor } from "./useTemplateEditor";
import type { useTemplateInspector } from "./useTemplateInspector";
import { useTemplateCanvas } from "./useTemplateCanvas";
import {
  addCanvasHeaderRow,
  mergeCanvasHeader,
  splitCanvasHeader,
  moveCanvasColumn,
  type CanvasInsertKind,
  type CanvasSelection,
} from "./canvas-commands";
import type { HeaderCommand } from "./canvas-commands";
/** 画布、字段与工具定位统一在包内协调；宿主只提供模板和业务契约。 */
export function useTemplateWorkspace(
  editor: ReturnType<typeof useTemplateEditor>,
  inspector: ReturnType<typeof useTemplateInspector>,
  schemas: () => Record<string, DatasetContract> | undefined,
) {
  const { draft, lists, selected, activeList, blocked, jsonPending, error } =
    editor;
  const { section, activeIndex } = inspector;
  const canvas = useTemplateCanvas(draft, editor.transaction);
  const {
    mode,
    selection: canvasSelection,
    pageIndex: canvasPage,
    active: canvasActive,
  } = canvas;
  const tool = ref<"excel" | "rules" | "review" | "params">("excel");
  const visitedTools = ref(new Set<string>());
  watch([section, tool], () => {
    if (section.value === "tools")
      visitedTools.value = new Set([...visitedTools.value, tool.value]);
  });
  watch(canvasSelection, (next) => {
    if (!next) return;
    const index = lists.value.findIndex(
      (item) =>
        item.pageIndex === next.pageIndex &&
        item.componentIndex === next.componentIndex,
    );
    if (index >= 0) selected.value = index;
  });
  watch([activeIndex, selected, mode, section], () => {
    if (mode.value !== "design" || section.value !== "fields") return;
    const location = lists.value[selected.value];
    if (location && (canvasSelection.value?.pageIndex !== location.pageIndex || canvasSelection.value.componentIndex !== location.componentIndex)) canvas.select({ pageIndex: location.pageIndex, componentIndex: location.componentIndex });
  });
  const editDisabled = computed(
    () => editor.editingReadonly.value || blocked.value || jsonPending.value,
  );
  const dataSchema = computed(
    () => schemas()?.[activeList.value?.dataset ?? ""],
  );
  function setMode(next: "design" | "preview"): void {
    mode.value = next;
    if (section.value === "tools") section.value = next === "design" ? "component" : "fields";
  }
  function chooseCanvas(selection: CanvasSelection): void {
    if (
      !draft.value.template.pages[selection.pageIndex]?.components[
        selection.componentIndex
      ]
    )
      return;
    canvas.select(selection);
    const component =
      draft.value.template.pages[selection.pageIndex]?.components[
        selection.componentIndex
      ];
    if (component?.kind === "list") {
      const index = lists.value.findIndex(
        (item) =>
          item.pageIndex === selection.pageIndex &&
          item.componentIndex === selection.componentIndex,
      );
      if (index >= 0) selected.value = index;
      section.value = "fields";
    } else section.value = "component";
  }
  function insertComponent(event: Event): void {
    const target = event.target as HTMLSelectElement;
    if (target.value) {
      canvas.insert(target.value as CanvasInsertKind);
      mode.value = "design";
      section.value = "component";
      target.value = "";
    }
  }
  function patchCanvas(patch: Record<string, unknown>): void {
    if (draft.value.template.pages[canvasPage.value]?.flow && ["leftMm", "topMm", "widthMm", "heightMm", "pageAnchor", "grid"].some(key => key in patch)) return;
    canvas.mutate((component, document) => {
      if (
        component.kind !== "list" &&
        patch.pageAnchor !== component.pageAnchor
      ) {
        const page = document.template.pages[canvasSelection.value!.pageIndex]!;
        if (patch.pageAnchor === "header")
          component.topMm = page.marginTopMm ?? 0;
        if (patch.pageAnchor === "footer")
          component.topMm = Math.max(
            0,
            page.heightMm - (page.marginBottomMm ?? 0) - component.heightMm,
          );
      }
      const target = component as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete target[key];
        else target[key] = value;
      }
    });
  }
  function changeList(next: ListComponent): void {
    const location = lists.value[selected.value];
    if (location)
      editor.transaction((document) => {
        document.template.pages[location.pageIndex]!.components[
          location.componentIndex
        ] = next;
      });
  }
  function moveColumn(delta: -1 | 1): void {
    const list = activeList.value;
    if (!list || draft.value.template.pages[lists.value[selected.value]?.pageIndex ?? -1]?.flow) return;
    const next = JSON.parse(JSON.stringify(list)) as ListComponent;
    try {
      if (
        moveCanvasColumn(next, activeIndex.value, activeIndex.value + delta)
      ) {
        changeList(next);
        inspector.activate(activeIndex.value + delta);
      }
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    }
  }
  function headerCommand(command: HeaderCommand): void {
    const location = lists.value[selected.value];
    if (!location || draft.value.template.pages[location.pageIndex]?.flow) return;
    editor.transaction((document) => {
      const list =
        document.template.pages[location.pageIndex]!.components[
          location.componentIndex
        ];
      if (list?.kind !== "list") return;
      if (command.action === "add") addCanvasHeaderRow(list);
      else if (command.action === "merge")
        mergeCanvasHeader(list, command.row, command.first, command.last);
      else splitCanvasHeader(list, command.row, command.first);
    });
  }
  function locateReview(location: {
    path?: string;
    pageIndex?: number;
    componentIndex?: number;
    field?: string;
  }): void {
    const path = /\.pages\[(\d+)\]\.components\[(\d+)\]/.exec(location.path ?? "");
    const pageIndex = location.pageIndex ?? (path ? Number(path[1]) : undefined);
    const componentIndex = location.componentIndex ?? (path ? Number(path[2]) : undefined);
    if (pageIndex === undefined || componentIndex === undefined) return;
    mode.value = "design";
    chooseCanvas({ pageIndex, componentIndex });
    if (location.field) {
      const index = activeList.value?.columns.findIndex(
        (column) => column.field === location.field,
      );
      if (index !== undefined && index >= 0) inspector.activate(index);
    }
  }

  return {
    mode,
    setMode,
    canvasSelection,
    canvasPage,
    canvasActive,
    tool,
    visitedTools,
    editDisabled,
    dataSchema,
    chooseCanvas,
    insertComponent,
    patchCanvas,
    changeList,
    moveColumn,
    headerCommand,
    locateReview,
    canvas,
  };
}
