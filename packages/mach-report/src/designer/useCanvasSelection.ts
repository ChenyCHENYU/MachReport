import { computed, ref, watch, type Ref } from "vue";
import type { ReportTemplateDocument } from "@agile-team/mach-report";
import { componentGeometry, selectedComponent, setCanvasGeometry, type CanvasSelection } from "./canvas-commands";
import type { TemplateTransaction } from "./useTemplateCanvas";
export type CanvasAlign = "left" | "center" | "right" | "top" | "middle" | "bottom";
const key = (item: CanvasSelection) => `${item.pageIndex}:${item.componentIndex}`;
/** Selection and temporary position locks stay outside report data; one arrangement creates one undo frame. */
export function useCanvasSelection(draft: Ref<ReportTemplateDocument>, selection: Ref<CanvasSelection | undefined>, transaction: TemplateTransaction) {
  const selections = ref<CanvasSelection[]>([]), locks = ref(new Set<string>());
  watch(() => draft.value.id, () => { selections.value = []; locks.value = new Set(); });
  const locked = (item?: CanvasSelection) => !!item && locks.value.has(key(item));
  function select(next: CanvasSelection): void {
    const clean = { pageIndex: next.pageIndex, componentIndex: next.componentIndex };
    if (next.additive && selections.value.every((item) => item.pageIndex === next.pageIndex)) {
      const exists = selections.value.some((item) => key(item) === key(next));
      selections.value = exists ? selections.value.filter((item) => key(item) !== key(next)) : [...selections.value, clean];
      selection.value = exists ? selections.value.at(-1) : clean;
    } else { selections.value = [clean]; selection.value = clean; }
  }
  const movable = computed(() => selections.value.filter((item) => !locked(item)));
  function toggleLock(): void {
    const next = new Set(locks.value), release = selections.value.every(locked);
    for (const item of selections.value) { if (release) next.delete(key(item)); else next.add(key(item)); }
    locks.value = next;
  }
  function align(axis: CanvasAlign): void {
    if (movable.value.length < 2) return;
    transaction((document) => {
      const items = movable.value.map((item) => selectedComponent(document, item)!).filter(Boolean);
      const boxes = items.map(componentGeometry);
      const left = Math.min(...boxes.map((box) => box.leftMm)), top = Math.min(...boxes.map((box) => box.topMm));
      const right = Math.max(...boxes.map((box) => box.leftMm + box.widthMm)), bottom = Math.max(...boxes.map((box) => box.topMm + box.heightMm));
      items.forEach((item, index) => {
        const box = boxes[index]!;
        const horizontal = { left, center: (left + right - box.widthMm) / 2, right: right - box.widthMm };
        const vertical = { top, middle: (top + bottom - box.heightMm) / 2, bottom: bottom - box.heightMm };
        if (axis in horizontal) box.leftMm = horizontal[axis as keyof typeof horizontal];
        else box.topMm = vertical[axis as keyof typeof vertical];
        setCanvasGeometry(item, box);
      });
    });
  }
  function distribute(axis: "horizontal" | "vertical"): void {
    if (movable.value.length < 3) return;
    transaction((document) => {
      const start = axis === "horizontal" ? "leftMm" : "topMm", size = axis === "horizontal" ? "widthMm" : "heightMm";
      const items = movable.value.map((item) => ({ component: selectedComponent(document, item)!, box: componentGeometry(selectedComponent(document, item)!) })).sort((a, b) => a.box[start] - b.box[start]);
      const first = items[0]!.box[start], last = Math.max(...items.map((item) => item.box[start] + item.box[size]));
      const gap = (last - first - items.reduce((sum, item) => sum + item.box[size], 0)) / (items.length - 1);
      let cursor = first;
      for (const item of items) { item.box[start] = cursor; setCanvasGeometry(item.component, item.box); cursor += item.box[size] + gap; }
    });
  }
  function remap(page: number, from: number, to?: number): void {
    function map(item: CanvasSelection): CanvasSelection | undefined {
      if (item.pageIndex !== page) return item;
      const index = item.componentIndex;
      if (to === undefined) return index === from ? undefined : { ...item, componentIndex: index > from ? index - 1 : index };
      return { ...item, componentIndex: index === from ? to : index === to ? from : index };
    }
    locks.value = new Set([...locks.value].flatMap((value) => { const [pageIndex, componentIndex] = value.split(":").map(Number); const next = map({ pageIndex: pageIndex!, componentIndex: componentIndex! }); return next ? [key(next)] : []; }));
    selections.value = selections.value.flatMap((item) => { const next = map(item); return next ? [next] : []; });
  }
  return { clearLocks: () => { locks.value = new Set(); }, selections, locked, allLocked: computed(() => !!selections.value.length && selections.value.every(locked)), toggleLock, align, distribute, select, remap };
}
