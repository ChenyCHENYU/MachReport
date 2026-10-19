import { computed, ref, watch, type Ref } from "vue";
import type {
  ReportTemplateDocument,
  TemplateComponent,
} from "@agile-team/mach-report";
import {
  componentGeometry,
  constrainGeometry,
  createCanvasComponent,
  selectedComponent,
  setCanvasGeometry,
  type CanvasGeometry,
  type CanvasInsertKind,
  type CanvasSelection,
} from "./canvas-commands";

export type TemplateTransaction = (
  change: (document: ReportTemplateDocument) => void,
) => boolean;
/** 画布选择与草稿命令隔离；热拖动只改变画布本地样式，提交才验证和记入历史。 */
export function useTemplateCanvas(
  draft: Ref<ReportTemplateDocument>,
  transaction: TemplateTransaction,
) {
  const mode = ref<"design" | "preview">("preview");
  const selection = ref<CanvasSelection>();
  const pageIndex = ref(0);
  const active = computed(() =>
    selectedComponent(draft.value, selection.value),
  );
  watch(draft, () => {
    if (!active.value) selection.value = undefined;
    if (!draft.value.template.pages[pageIndex.value]) pageIndex.value = 0;
  });
  function select(next: CanvasSelection): void {
    selection.value = next;
    pageIndex.value = next.pageIndex;
  }
  function mutate(
    change: (
      component: TemplateComponent,
      document: ReportTemplateDocument,
    ) => void,
  ): boolean {
    const selected = selection.value;
    if (!selected) return false;
    return transaction((document) => {
      const component = selectedComponent(document, selected);
      if (component) change(component, document);
    });
  }
  function geometry(next: CanvasGeometry): void {
    mutate((component, document) => {
      const page = document.template.pages[selection.value!.pageIndex]!;
      setCanvasGeometry(
        component,
        constrainGeometry(next, page, component.kind === "list"),
      );
    });
  }
  function insert(kind: CanvasInsertKind): void {
    let index = -1;
    const page = pageIndex.value;
    if (
      transaction((document) => {
        const components = document.template.pages[page]!.components;
        components.push(createCanvasComponent(kind));
        index = components.length - 1;
      })
    )
      select({ pageIndex: page, componentIndex: index });
  }
  function remove(): void {
    const selected = selection.value;
    if (
      selected &&
      transaction((document) => {
        document.template.pages[selected.pageIndex]!.components.splice(
          selected.componentIndex,
          1,
        );
      })
    )
      selection.value = undefined;
  }
  function duplicate(): void {
    const selected = selection.value;
    if (!selected) return;
    let index = -1;
    if (
      transaction((document) => {
        const page = document.template.pages[selected.pageIndex]!,
          component = structuredClone(selectedComponent(document, selected)!);
        const next = componentGeometry(component);
        next.leftMm += 4;
        next.topMm += 4;
        setCanvasGeometry(
          component,
          constrainGeometry(next, page, component.kind === "list"),
        );
        if (component.kind === "list") delete component.id;
        else {
          delete component.nid;
          delete component.rkey;
        }
        page.components.push(component);
        index = page.components.length - 1;
      })
    )
      select({ pageIndex: selected.pageIndex, componentIndex: index });
  }
  function reorder(delta: -1 | 1): void {
    const selected = selection.value;
    if (!selected) return;
    const next = selected.componentIndex + delta;
    if (!draft.value.template.pages[selected.pageIndex]?.components[next])
      return;
    if (
      transaction((document) => {
        const list = document.template.pages[selected.pageIndex]!.components;
        list.splice(next, 0, list.splice(selected.componentIndex, 1)[0]!);
      })
    )
      select({ pageIndex: selected.pageIndex, componentIndex: next });
  }
  return {
    mode,
    selection,
    pageIndex,
    active,
    select,
    mutate,
    geometry,
    insert,
    remove,
    duplicate,
    reorder,
  };
}
