import { computed, ref, watch, type Ref } from "vue";
import { useCanvasSelection } from "./useCanvasSelection";
import {
  parseReportTemplate,
  type ReportTemplateDocument,
  type TemplateComponent,
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
  const geometryDisabled = computed(() => !!draft.value.template.pages[selection.value?.pageIndex ?? pageIndex.value]?.flow);
  const multi = useCanvasSelection(draft, selection, change => geometryDisabled.value ? false : transaction(change));
  const active = computed(() =>
    selectedComponent(draft.value, selection.value),
  );
  watch(pageIndex, (page) => {
    if (selection.value?.pageIndex !== page) { selection.value = undefined; multi.selections.value = []; }
  });
  watch(draft, () => {
    if (!active.value) selection.value = undefined;
    multi.selections.value = multi.selections.value.filter(item => !!selectedComponent(draft.value, item));
    if (!draft.value.template.pages[pageIndex.value]) pageIndex.value = 0;
  });
  function select(next: CanvasSelection): void {
    multi.select(next);
    pageIndex.value = next.pageIndex;
  }
  function mutate(
    change: (
      component: TemplateComponent,
      document: ReportTemplateDocument,
    ) => void,
  ): boolean {
    const selected = selection.value;
    if (!selected || multi.locked(selected)) return false;
    return transaction((document) => {
      const component = selectedComponent(document, selected);
      if (component) change(component, document);
    });
  }
  function geometry(next: CanvasGeometry): void {
    if (geometryDisabled.value) return;
    mutate((component, document) => {
      const page = document.template.pages[selection.value!.pageIndex]!;
      setCanvasGeometry(
        component,
        constrainGeometry(next, page, component.kind === "list"),
      );
    });
  }
  function insert(kind: CanvasInsertKind): void {
    insertComponent(createCanvasComponent(kind));
  }
  function insertComponent(component: TemplateComponent): boolean {
    if (draft.value.template.pages[pageIndex.value]?.flow || component.kind === "list" && draft.value.template.repeat) return false;
    let index = -1;
    const page = pageIndex.value;
    const inserted = transaction((document) => {
        const components = document.template.pages[page]!.components;
        components.push(component);
        index = components.length - 1;
        // The public insertion entry accepts host values; validate and detach before geometry mutates them.
        const owned = parseReportTemplate(document).template.pages[page]!.components[index]!;
        setCanvasGeometry(owned, constrainGeometry(componentGeometry(owned), document.template.pages[page]!, owned.kind === "list"));
        if (owned.kind === "qrcode") owned.widthMm = owned.heightMm = Math.min(owned.widthMm, owned.heightMm);
        components[index] = owned;
      });
    if (inserted) select({ pageIndex: page, componentIndex: index });
    return inserted;
  }
  function remove(): void {
    if (geometryDisabled.value) return;
    const selected = selection.value;
    if (
      selected && !multi.locked(selected) &&
      transaction((document) => {
        document.template.pages[selected.pageIndex]!.components.splice(
          selected.componentIndex,
          1,
        );
      })
    ) {
      multi.remap(selected.pageIndex, selected.componentIndex); selection.value = undefined;
    }
  }
  function duplicate(): void {
    if (geometryDisabled.value) return;
    const selected = selection.value;
    if (!selected) return;
    let index = -1;
    if (
      transaction((document) => {
        const page = document.template.pages[selected.pageIndex]!,
          // 模板已通过纯JSON文档校验；兼容旧门户，且不把Vue响应式代理传给原生克隆API。
          component = JSON.parse(JSON.stringify(selectedComponent(document, selected)!)) as TemplateComponent;
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
    if (geometryDisabled.value) return;
    const selected = selection.value;
    if (!selected || multi.locked(selected)) return;
    const next = selected.componentIndex + delta;
    if (!draft.value.template.pages[selected.pageIndex]?.components[next])
      return;
    if (
      transaction((document) => {
        const list = document.template.pages[selected.pageIndex]!.components;
        list.splice(next, 0, list.splice(selected.componentIndex, 1)[0]!);
      })
    ) {
      multi.remap(selected.pageIndex, selected.componentIndex, next);
      select({ pageIndex: selected.pageIndex, componentIndex: next });
    }
  }
  return {
    ...multi,
    mode,
    selection,
    pageIndex,
    active,
    geometryDisabled,
    select,
    mutate,
    geometry,
    insert,
    insertComponent,
    remove,
    duplicate,
    reorder,
  };
}
