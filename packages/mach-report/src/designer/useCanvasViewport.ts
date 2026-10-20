import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { ListComponent, ReportTemplateDocument } from "@agile-team/mach-report";
import { CANVAS_MM_TO_PX, componentGeometry, type CanvasSelection } from "./canvas-commands";
interface CanvasViewportOptions { document: ReportTemplateDocument; pageIndex: number; selection?: CanvasSelection; columnIndex?: number }
/** Viewport changes never write the template or trigger pagination. */
export function useCanvasViewport(props: CanvasViewportOptions) {
  const viewport = ref<HTMLElement>(), zoom = ref(.8), fraction = ref(0), width = ref(0);
  const scale = computed(() => zoom.value * CANVAS_MM_TO_PX);
  const page = computed(() => props.document.template.pages[props.pageIndex]!);
  const wide = computed(() => page.value.widthMm * scale.value > width.value - 40);
  let observer: ResizeObserver | undefined;
  function fit(mode: "width" | "page" | "selection"): void {
    const node = viewport.value; if (!node) return;
    let box = { leftMm: 0, topMm: 0, widthMm: page.value.widthMm, heightMm: page.value.heightMm };
    const selected = props.selection?.pageIndex === props.pageIndex ? page.value.components[props.selection.componentIndex] : undefined;
    if (mode === "selection" && selected) box = componentGeometry(selected);
    const horizontal = (node.clientWidth - 40) / (box.widthMm * CANVAS_MM_TO_PX);
    const vertical = (node.clientHeight - 40) / (box.heightMm * CANVAS_MM_TO_PX);
    zoom.value = Math.max(.05, Math.min(2, mode === "width" ? horizontal : Math.min(horizontal, vertical)));
    void nextTick(() => { node.scrollLeft = box.leftMm * scale.value; node.scrollTop = box.topMm * scale.value; });
  }
  function sync(): void {
    const node = viewport.value; if (!node) return;
    width.value = node.clientWidth;
    fraction.value = node.scrollWidth > node.clientWidth ? Math.round(node.scrollLeft / (node.scrollWidth - node.clientWidth) * 100) : 0;
  }
  function navigate(value: number): void {
    const node = viewport.value; if (node) node.scrollLeft = (node.scrollWidth - node.clientWidth) * value / 100;
    fraction.value = value;
  }
  async function reveal(): Promise<void> {
    await nextTick(); const node = viewport.value, selected = props.selection;
    if (!node || selected?.pageIndex !== props.pageIndex) return;
    const component = page.value.components[selected.componentIndex]; if (!component) return;
    const box = componentGeometry(component);
    if (component.kind === "list" && props.columnIndex !== undefined && props.columnIndex >= 0) {
      const list = component as ListComponent;
      box.leftMm += list.columns.slice(0, props.columnIndex).reduce((sum, column) => sum + column.widthMm, 0);
      box.widthMm = list.columns[props.columnIndex]?.widthMm ?? box.widthMm;
    }
    const left = box.leftMm * scale.value, top = box.topMm * scale.value;
    const right = left + box.widthMm * scale.value, bottom = top + box.heightMm * scale.value;
    if (left < node.scrollLeft) node.scrollLeft = left;
    else if (right > node.scrollLeft + node.clientWidth - 40) node.scrollLeft = Math.max(0, Math.min(left, right - node.clientWidth + 40));
    if (top < node.scrollTop) node.scrollTop = top;
    else if (bottom > node.scrollTop + node.clientHeight - 40) node.scrollTop = Math.max(0, Math.min(top, bottom - node.clientHeight + 40));
    sync();
  }
  watch(() => [props.selection, props.columnIndex, props.pageIndex], () => { void reveal(); });
  onMounted(() => { sync(); if (typeof ResizeObserver !== "undefined" && viewport.value) { observer = new ResizeObserver(sync); observer.observe(viewport.value); } });
  onBeforeUnmount(() => observer?.disconnect());
  return { viewport, zoom, scale, page, wide, fraction, fit, sync, navigate };
}
