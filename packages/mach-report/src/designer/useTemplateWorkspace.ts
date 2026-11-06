import { computed, nextTick, ref, shallowRef, watch } from "vue";
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
import type { TemplateDraftStorage } from "./draft-storage";
import { useTemplateWorkspaceStorage } from "./useTemplateWorkspaceStorage";
import { componentViewKey, documentViewKey, pageViewKey, provideDesignerCursor, provideDesignerViewport, resolveWorkspaceRule, resolveWorkspaceView, type DesignerWorkspaceView } from "./workspace-view";
import type { DesignerTarget } from "./template-location";
/** 画布、字段与工具定位统一在包内协调；宿主只提供模板和业务契约。 */
export function useTemplateWorkspace(
  editor: ReturnType<typeof useTemplateEditor>,
  inspector: ReturnType<typeof useTemplateInspector>,
  schemas: () => Record<string, DatasetContract> | undefined,
  options: { mode?(): "design" | "preview" | undefined; onModeChange?(mode: "design" | "preview"): void; storage?(): TemplateDraftStorage | undefined; capabilities?(): Partial<Record<string, boolean>> | undefined } = {},
) {
  const { draft, lists, selected, activeList, blocked, jsonPending, error } =
    editor;
  const { section, activeIndex } = inspector;
  const canvas = useTemplateCanvas(draft, editor.transaction, options);
  const {
    mode,
    selection: canvasSelection,
    pageIndex: canvasPage,
    active: canvasActive,
  } = canvas;
  editor.connectHistoryView({
    read: () => ({ pageIndex: canvasPage.value, componentIndex: canvasSelection.value?.pageIndex === canvasPage.value ? canvasSelection.value.componentIndex : undefined, ...(canvas.selections.value.length > 1 ? { componentIndices: canvas.selections.value.map(item => item.componentIndex) } : {}), listIndex: selected.value, fieldIndex: activeIndex.value, section: section.value }),
    restore: (context) => {
      canvasPage.value = Math.max(0, Math.min(draft.value.template.pages.length - 1, context.pageIndex));
      canvas.selection.value = undefined;
      canvas.selections.value = [];
      canvas.clearLocks();
      for (const componentIndex of context.componentIndices ?? []) {
        if (draft.value.template.pages[canvasPage.value]?.components[componentIndex]) canvas.select({ pageIndex: canvasPage.value, componentIndex, additive: true });
      }
      if (context.componentIndex !== undefined && draft.value.template.pages[canvasPage.value]?.components[context.componentIndex])
        canvas.select({ pageIndex: canvasPage.value, componentIndex: context.componentIndex, preserve: true });
      if (context.listIndex !== undefined && lists.value[context.listIndex]) selected.value = context.listIndex;
      if (context.fieldIndex !== undefined) inspector.activate(context.fieldIndex);
      if (context.section) section.value = context.section;
    },
  });
  // A validated command may select its newly inserted page/component after the
  // document transaction returns. Capture that final view once, after rendering.
  watch(editor.historyViewRevision, () => editor.captureHistoryView(), { flush: "post" });
  const tool = ref<"excel" | "rules" | "review" | "params" | "outline" | "reuse">("excel");
  const viewport = provideDesignerViewport();
  const cursor = provideDesignerCursor();
  const diagnosticTarget = shallowRef<DesignerTarget>();
  watch([() => draft.value.id, () => options.storage?.()?.scope], () => {
    viewport.restore(undefined); cursor.value = {}; diagnosticTarget.value = undefined;
  });
  const positionDocumentKey = computed(() => documentViewKey(draft.value));
  const positionSource = computed(() => {
    const list = lists.value[selected.value];
    return list && (section.value === "fields" || section.value === "tools" && tool.value === "rules") ? { pageIndex: list.pageIndex, componentIndex: list.componentIndex } : { pageIndex: canvasPage.value, componentIndex: canvasSelection.value?.pageIndex === canvasPage.value ? canvasSelection.value.componentIndex : undefined };
  });
  const positionPageKey = computed(() => pageViewKey(draft.value.template.pages[positionSource.value.pageIndex]!));
  function readPosition(): DesignerWorkspaceView {
    const { pageIndex, componentIndex } = positionSource.value, page = draft.value.template.pages[pageIndex]!;
    const component = page.components[componentIndex ?? -1];
    const rule = cursor.value.rule;
    return { version: 1, templateId: draft.value.id, documentKey: positionDocumentKey.value, page: { index: pageIndex, key: positionPageKey.value }, componentKey: component ? componentViewKey(component) : undefined, field: component?.kind === "list" ? component.columns[activeIndex.value]?.field : undefined, section: section.value, tool: tool.value, mode: mode.value, viewport: pageIndex === canvasPage.value ? viewport.read() : undefined, paramField: cursor.value.paramField, rule: rule?.key === `rules:${pageIndex}:${componentIndex}` ? rule.target : undefined };
  }
  function restorePositionPanel(view: DesignerWorkspaceView, hasList: boolean): boolean {
    const capabilities = options.capabilities?.() ?? {};
    const allowedSection = view.section !== "advanced" || capabilities.advanced !== false;
    section.value = allowedSection && (view.section !== "fields" || hasList) ? view.section : "template";
    if (capabilities[view.tool] === false) { section.value = "template"; return true; }
    tool.value = view.tool;
    return section.value !== view.section;
  }
  function restorePositionTool(view: DesignerWorkspaceView, changed: boolean): boolean {
    const rule = resolveWorkspaceRule(activeList.value, view.rule, changed);
    const paramField = draft.value.template.params?.some(param => param.field === view.paramField) ? view.paramField : undefined;
    diagnosticTarget.value = { section: section.value, tool: tool.value === "rules" || tool.value === "params" ? tool.value : undefined, paramField, rule };
    return !!view.paramField && !paramField || !!view.rule && !rule;
  }
  async function restorePosition(view: DesignerWorkspaceView, signal: AbortSignal): Promise<boolean | undefined> {
    if (editor.blocked.value || signal.aborted) return;
    const target = resolveWorkspaceView(draft.value, view);
    const listIndex = lists.value.findIndex(item => item.pageIndex === target.pageIndex && item.componentIndex === target.componentIndex);
    if (listIndex >= 0 && listIndex !== selected.value && editor.isToolPending("rules") && !await editor.guardChanges()) return;
    if (signal.aborted) return;
    canvasPage.value = target.pageIndex;
    canvas.selection.value = undefined; canvas.selections.value = []; canvas.clearLocks();
    if (target.componentIndex !== undefined) canvas.select({ pageIndex: target.pageIndex, componentIndex: target.componentIndex });
    if (listIndex >= 0) selected.value = listIndex;
    if (target.fieldIndex !== undefined) inspector.activate(target.fieldIndex);
    const panelAdjusted = restorePositionPanel(view, listIndex >= 0);
    const toolAdjusted = restorePositionTool(view, target.adjusted);
    mode.value = view.mode;
    await nextTick();
    if (!signal.aborted) viewport.restore(target.adjusted ? undefined : view.viewport);
    return target.adjusted || panelAdjusted || toolAdjusted;
  }
  const position = useTemplateWorkspaceStorage({ storage: () => options.storage?.(), id: () => draft.value.id, changed: () => [canvasPage.value, canvasSelection.value, selected.value, activeIndex.value, section.value, tool.value, mode.value, viewport.revision.value, cursor.value], read: readPosition, restore: restorePosition });
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
    if (section.value === "tools") section.value = next === "design" || !lists.value.length ? "component" : "fields";
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
    if (pageIndex === undefined) return;
    if (componentIndex === undefined) { canvasPage.value = pageIndex; section.value = "template"; mode.value = "design"; return; }
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
    position,
    diagnosticTarget,
  };
}
