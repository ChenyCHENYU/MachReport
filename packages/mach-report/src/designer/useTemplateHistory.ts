import { computed, ref } from "vue";

/** Bounded private snapshots include invalid form state so an undo can recover it. */
export function useTemplateHistory(initial: string, budget = { entries: 100, bytes: 16 * 1024 * 1024 }) {
  const frames = ref([initial]);
  const cursor = ref(0);
  const canUndo = computed(() => cursor.value > 0);
  const canRedo = computed(() => cursor.value + 1 < frames.value.length);
  const current = computed(() => frames.value[cursor.value]);
  function reset(snapshot: string): void { frames.value = [snapshot]; cursor.value = 0; }
  function record(snapshot: string): void {
    if (frames.value[cursor.value] === snapshot) return;
    const next = frames.value.slice(0, cursor.value + 1); next.push(snapshot);
    let bytes = next.reduce((sum, frame) => sum + frame.length * 2, 0);
    while (next.length > 1 && (next.length > budget.entries || bytes > budget.bytes)) bytes -= next.shift()!.length * 2;
    frames.value = next; cursor.value = frames.value.length - 1;
  }
  function move(delta: -1 | 1): string | undefined {
    if (delta < 0 ? !canUndo.value : !canRedo.value) return;
    cursor.value += delta; return frames.value[cursor.value];
  }
  return { canUndo, canRedo, current, reset, record, move };
}
