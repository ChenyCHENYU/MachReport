import { computed, nextTick, onBeforeUnmount, ref, watch, type Ref } from "vue";
import { visibleScrollBounds } from "./designer-focus";

const MAX_OPTIONS_HEIGHT = 230, FOOTER_HEIGHT = 36, GAP = 4;
export function fieldPopupPlacement(anchor: Pick<DOMRect, "top" | "bottom">, bounds: { top: number; bottom: number }): { above: boolean; optionsHeight: number } {
  const below = Math.max(0, bounds.bottom - anchor.bottom - GAP), before = Math.max(0, anchor.top - bounds.top - GAP);
  const above = below < MAX_OPTIONS_HEIGHT + FOOTER_HEIGHT && before > below;
  return { above, optionsHeight: Math.max(24, Math.min(MAX_OPTIONS_HEIGHT, Math.floor(above ? before : below) - FOOTER_HEIGHT)) };
}

function clippingBounds(input: HTMLElement): { top: number; bottom: number } {
  let top = 0, bottom = window.innerHeight;
  for (let node = input.parentElement; node; node = node.parentElement) {
    if (!/auto|scroll|hidden|clip/.test(getComputedStyle(node).overflowY)) continue;
    const clip = visibleScrollBounds(node);
    top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom);
  }
  return { top, bottom };
}

/** One active field popup owns bounded observers; option scrolling does not remeasure the anchor. */
export function useFieldSelectPopup(input: Ref<HTMLInputElement | undefined>, options: Ref<HTMLElement | undefined>, open: Ref<boolean>) {
  const above = ref(false), optionsHeight = ref(MAX_OPTIONS_HEIGHT);
  const style = computed(() => ({ "--mr-field-options-height": `${optionsHeight.value}px` }));
  let frame: number | undefined, observer: ResizeObserver | undefined, generation = 0;
  async function place(): Promise<void> {
    if (!open.value || !input.value) return;
    const position = fieldPopupPlacement(input.value.getBoundingClientRect(), clippingBounds(input.value));
    above.value = position.above; optionsHeight.value = position.optionsHeight;
    await nextTick();
  }
  function schedule(event?: Event): void {
    if (event?.target instanceof Node && options.value?.contains(event.target)) return;
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => { frame = undefined; void place(); });
  }
  function stop(): void {
    generation++;
    window.removeEventListener("resize", schedule); window.removeEventListener("scroll", schedule, true);
    observer?.disconnect(); observer = undefined;
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
  }
  watch(open, async value => {
    stop();
    const current = generation;
    if (!value) return;
    window.addEventListener("resize", schedule); window.addEventListener("scroll", schedule, true);
    await nextTick();
    if (current !== generation || !open.value || !input.value) return;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => schedule());
      for (let node: HTMLElement | null = input.value; node; node = node.parentElement) observer.observe(node);
    }
    await place();
  });
  onBeforeUnmount(stop);
  return { above, style, place };
}
