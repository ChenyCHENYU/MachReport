import { computed, ref, watch, type Ref } from "vue";
import { useCanvasSelection } from "./useCanvasSelection";
import { placeCanvasComponent } from "./canvas-placement";
import { canvasSelectionDelta, copyCanvasComponent, translateCanvasSelection } from "./canvas-selection-commands";
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
  options: { mode?(): "design" | "preview" | undefined; onModeChange?(mode: "design" | "preview"): void } = {},
) {
  const localMode = ref<"design" | "preview">("preview");
  const mode = computed({ get: () => options.mode?.() ?? localMode.value, set: (value: "design" | "preview") => {
    if (options.mode?.() === undefined) localMode.value = value;
    options.onModeChange?.(value);
  } });
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
  watch(() => draft.value.id, () => { selection.value = undefined; multi.selections.value = []; pageIndex.value = 0; });
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
    const current = active.value;
    if (multi.locked(selection.value)) return;
    if (current && multi.movable.value.length > 1 && next.widthMm === current.widthMm && next.heightMm === componentGeometry(current).heightMm) {
      move(next.leftMm - current.leftMm, next.topMm - current.topMm);
      return;
    }
    mutate((component, document) => {
      const page = document.template.pages[selection.value!.pageIndex]!;
      setCanvasGeometry(
        component,
        constrainGeometry(next, page, component.kind === "list"),
      );
    });
  }
  function move(x: number, y: number): void {
    if (geometryDisabled.value || !multi.movable.value.length) return;
    const selections = multi.movable.value.slice();
    const delta = canvasSelectionDelta(draft.value, selections, x, y);
    if (!delta.x && !delta.y) return;
    transaction(document => translateCanvasSelection(document, selections, delta.x, delta.y));
  }
  const insertedOnNewPage = ref(false);
  function insert(kind: CanvasInsertKind): void {
    insertPlaced(createCanvasComponent(kind));
  }
  function insertPlaced(component: TemplateComponent): boolean {
    if (draft.value.template.pages[pageIndex.value]?.flow || component.kind === "list" && draft.value.template.repeat) return false;
    let next = pageIndex.value, index = -1, newPage = false;
    const inserted = transaction(document => {
      // 解析建立自有副本，避免宿主对象与模板共享引用。
      const owned = JSON.parse(JSON.stringify(component)) as TemplateComponent;
      const placement = placeCanvasComponent(document, next, owned);
      next = placement.pageIndex; newPage = placement.newPage;
      index = document.template.pages[next]!.components.length - 1;
    });
    if (inserted) { insertedOnNewPage.value = newPage; select({ pageIndex: next, componentIndex: index }); }
    return inserted;
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
    const selected = multi.movable.value.slice().sort((a, b) => b.componentIndex - a.componentIndex);
    if (!selected.length) return;
    if (!transaction(document => { for (const item of selected) document.template.pages[item.pageIndex]!.components.splice(item.componentIndex, 1); })) return;
    for (const item of selected) multi.remap(item.pageIndex, item.componentIndex);
    selection.value = multi.selections.value.at(-1);
  }
  function duplicate(): void {
    if (geometryDisabled.value) return;
    const selected = multi.movable.value.slice().sort((a, b) => a.componentIndex - b.componentIndex);
    if (!selected.length) return;
    const delta = canvasSelectionDelta(draft.value, selected, 4, 4), copies: CanvasSelection[] = [];
    if (!transaction(document => {
      for (const item of selected) {
        const page = document.template.pages[item.pageIndex]!;
        const component = copyCanvasComponent(selectedComponent(document, item)!);
        const box = componentGeometry(component);
        setCanvasGeometry(component, { ...box, leftMm: box.leftMm + delta.x, topMm: box.topMm + delta.y });
        page.components.push(component);
        copies.push({ pageIndex: item.pageIndex, componentIndex: page.components.length - 1 });
      }
    })) return;
    multi.selections.value = copies; selection.value = copies.at(-1);
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
    move,
    insert,
    insertPlaced,
    insertedOnNewPage,
    insertComponent,
    remove,
    duplicate,
    reorder,
  };
}
