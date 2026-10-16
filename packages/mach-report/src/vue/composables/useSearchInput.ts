import { nextTick, ref, watch } from "vue";

/** Search controls own their focus and keys; the report viewport keeps page navigation. */
export function useSearchInput(host: {
  visible(): boolean;
  navigate(direction: 1 | -1): void;
  close(): void;
}) {
  const input = ref<HTMLInputElement | null>(null);
  const toggle = ref<HTMLButtonElement | null>(null);
  function focus(): void { input.value?.focus(); input.value?.select(); }
  watch(host.visible, (visible) => { if (visible) void nextTick(focus); });
  function close(): void {
    host.close();
    void nextTick(() => toggle.value?.focus());
  }
  function onKeydown(event: KeyboardEvent): void {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key !== "Enter" && event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") close();
    else host.navigate(event.shiftKey ? -1 : 1);
  }
  return { input, toggle, focus, close, onKeydown };
}
