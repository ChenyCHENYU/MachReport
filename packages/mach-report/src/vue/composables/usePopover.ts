import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

/** A local popup closes on pointer/focus leaving it, without stealing outside focus. */
export function usePopover() {
  const opened = ref(false);
  const root = ref<HTMLElement | null>(null);
  const trigger = ref<HTMLButtonElement | null>(null);
  const panel = ref<HTMLElement | null>(null);
  function close(restoreFocus = false): void {
    opened.value = false;
    if (restoreFocus) void nextTick(() => trigger.value?.focus());
  }
  function outside(event: Event): void {
    if (event.target instanceof Node && !root.value?.contains(event.target)) close();
  }
  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || !opened.value || event.isComposing) return;
    event.preventDefault(); event.stopPropagation(); close(true);
  }
  watch(opened, (value) => {
    if (!value) return;
    void nextTick(() => (panel.value?.querySelector<HTMLElement>("input") ?? panel.value?.querySelector<HTMLElement>("button:not(:disabled)"))?.focus());
  });
  onMounted(() => {
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
  });
  onBeforeUnmount(() => {
    document.removeEventListener("pointerdown", outside);
    document.removeEventListener("focusin", outside);
  });
  return { opened, root, trigger, panel, close, onKeydown };
}
