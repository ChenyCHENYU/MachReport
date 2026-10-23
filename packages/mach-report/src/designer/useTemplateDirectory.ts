import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type Ref,
} from "vue";
import type {
  useTemplateInspector,
  TemplateInspectorSection,
} from "./useTemplateInspector";

type Inspector = ReturnType<typeof useTemplateInspector>;

export function getTemplateColumnCursor(
  indices: number[],
  currentIndex: number,
  key: string,
): number | undefined {
  if (!indices.length) return;
  const current = Math.max(0, indices.indexOf(currentIndex));
  const positions: Record<string, number> = {
    ArrowDown: Math.min(current + 1, indices.length - 1),
    ArrowUp: Math.max(current - 1, 0),
    Home: 0,
    End: indices.length - 1,
  };
  const position = positions[key];
  return position === undefined ? undefined : indices[position];
}

/** 字段目录只占用检查器内部空间；焦点、滚动和外部点击不泄漏到宿主弹窗。 */
export function useTemplateDirectory<T extends { index: number }>(
  inspector: Inspector,
  section: Ref<TemplateInspectorSection>,
  columns: Readonly<Ref<T[]>>,
) {
  const open = ref(false);
  const cursor = ref(inspector.activeIndex.value);
  const trigger = ref<HTMLButtonElement | null>(null);
  const panel = ref<HTMLDivElement | null>(null);
  const search = ref<HTMLInputElement | null>(null);
  const list = ref<HTMLDivElement | null>(null);
  const windowStart = ref(0);
  const windowSize = 100;
  const windowColumns = computed(() => columns.value.slice(windowStart.value, windowStart.value + windowSize));
  function revealWindow(): void {
    const position = Math.max(0, columns.value.findIndex(item => item.index === cursor.value));
    windowStart.value = Math.floor(position / windowSize) * windowSize;
  }
  async function stepWindow(delta: -1 | 1): Promise<void> {
    const next = Math.max(0, Math.min(Math.max(0, columns.value.length - 1), windowStart.value + delta * windowSize));
    cursor.value = columns.value[next]?.index ?? -1;
    revealWindow();
    await nextTick(); revealCursor(true);
  }

  function revealCursor(focus = false): void {
    const viewport = list.value;
    const button = viewport?.querySelector<HTMLButtonElement>(
      `button[data-column-index="${cursor.value}"]`,
    );
    if (!viewport || !button) return;
    if (focus) button.focus({ preventScroll: true });
    const bounds = viewport.getBoundingClientRect(),
      target = button.getBoundingClientRect();
    const top = bounds.top + viewport.clientTop,
      bottom = top + viewport.clientHeight;
    if (target.top < top) viewport.scrollTop += target.top - top;
    else if (target.bottom > bottom)
      viewport.scrollTop += target.bottom - bottom;
  }
  async function close(restoreFocus = false): Promise<void> {
    if (!open.value) return;
    open.value = false;
    if (!restoreFocus) return;
    await nextTick();
    trigger.value?.focus({ preventScroll: true });
  }
  async function toggle(): Promise<void> {
    if (open.value) return close(true);
    const indices = columns.value.map((entry) => entry.index);
    cursor.value = indices.includes(inspector.activeIndex.value)
      ? inspector.activeIndex.value
      : indices[0] ?? -1;
    open.value = true;
    revealWindow();
    await nextTick();
    search.value?.focus({ preventScroll: true });
    revealCursor();
  }
  function choose(index: number): void {
    inspector.activate(index);
    void close(true);
  }
  function escape(event: KeyboardEvent): void {
    if (!open.value || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    event.stopPropagation();
    void close(true);
  }
  async function navigate(event: KeyboardEvent): Promise<void> {
    if (event.isComposing || event.keyCode === 229) return;
    const target = getTemplateColumnCursor(
      columns.value.map((entry) => entry.index),
      cursor.value,
      event.key,
    );
    if (target === undefined) return;
    cursor.value = target;
    revealWindow();
    event.preventDefault();
    await nextTick();
    revealCursor(true);
  }
  async function searchKeydown(event: KeyboardEvent): Promise<void> {
    if (event.isComposing || event.keyCode === 229 || !["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const indices = columns.value.map((entry) => entry.index);
    if (!indices.length) return;
    if (event.key === "Enter") {
      if (indices.includes(cursor.value)) choose(cursor.value);
      return;
    }
    if (event.key === "ArrowUp") cursor.value = indices.at(-1)!;
    revealWindow();
    await nextTick();
    revealCursor(true);
  }
  function outside(event: PointerEvent): void {
    const target = event.target as Node | null;
    if (
      !open.value ||
      panel.value?.contains(target) ||
      trigger.value?.contains(target)
    )
      return;
    void close();
  }
  function leave(event: FocusEvent): void {
    const target = event.relatedTarget as Node | null;
    if (
      !target ||
      panel.value?.contains(target) ||
      trigger.value?.contains(target)
    )
      return;
    void close();
  }
  watch(columns, (value) => {
    if (!value.some((entry) => entry.index === cursor.value))
      cursor.value = value[0]?.index ?? -1;
    revealWindow();
  });
  watch(section, () => {
    void close();
  });
  onMounted(() => document.addEventListener("pointerdown", outside));
  onBeforeUnmount(() => document.removeEventListener("pointerdown", outside));
  return {
    open,
    cursor,
    trigger,
    panel,
    search,
    list,
    windowColumns, windowStart, windowSize, stepWindow,
    toggle,
    close,
    choose,
    escape,
    navigate,
    searchKeydown,
    leave,
  };
}
