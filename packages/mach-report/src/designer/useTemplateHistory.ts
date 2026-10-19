import { computed, ref, shallowRef } from "vue";
import { applyHistoryFrame, createHistoryFrame, historyFrameBytes, type HistoryFrame } from "./history-patch";

/** Private reversible deltas retain invalid input too; checkpoints bound reconstruction work. */
export function useTemplateHistory(initial: string, budget = { entries: 100, bytes: 16 * 1024 * 1024 }) {
  if (![budget.entries, budget.bytes].every((item) => Number.isSafeInteger(item) && item > 0)) throw new RangeError("History budgets must be positive safe integers");
  const frames = shallowRef<HistoryFrame[]>([{ kind: "snapshot", value: initial }]);
  const cursor = ref(0);
  const value = ref(initial);
  const canUndo = computed(() => cursor.value > 0);
  const canRedo = computed(() => cursor.value + 1 < frames.value.length);
  const current = computed(() => value.value);
  const retainedBytes = computed(() => frames.value.reduce((sum, frame) => sum + historyFrameBytes(frame), 0));
  function reset(snapshot: string): void {
    frames.value = [{ kind: "snapshot", value: snapshot }]; cursor.value = 0; value.value = snapshot;
  }
  function at(index: number): string {
    let checkpoint = index;
    while (checkpoint > 0 && frames.value[checkpoint]!.kind !== "snapshot") checkpoint--;
    let result = "";
    for (; checkpoint <= index; checkpoint++) result = applyHistoryFrame(result, frames.value[checkpoint]!);
    return result;
  }
  function prune(next: HistoryFrame[]): HistoryFrame[] {
    let bytes = next.reduce((sum, frame) => sum + historyFrameBytes(frame), 0);
    while (next.length > 1 && (next.length > budget.entries || bytes > budget.bytes)) {
      const first = next[0] as Extract<HistoryFrame, { kind: "snapshot" }>;
      const second = next[1]!;
      const replacement: HistoryFrame = { kind: "snapshot", value: applyHistoryFrame(first.value, second) };
      bytes += historyFrameBytes(replacement) - historyFrameBytes(first) - historyFrameBytes(second);
      next.splice(0, 2, replacement);
    }
    return next;
  }
  function record(snapshot: string): void {
    if (value.value === snapshot) return;
    const next = frames.value.slice(0, cursor.value + 1);
    next.push(createHistoryFrame(value.value, snapshot, next.length % 20 === 0));
    frames.value = prune(next); cursor.value = frames.value.length - 1; value.value = snapshot;
  }
  function move(delta: -1 | 1): string | undefined {
    if (delta < 0 ? !canUndo.value : !canRedo.value) return;
    const frame = frames.value[cursor.value]!;
    if (delta < 0 && frame.kind === "patch") value.value = applyHistoryFrame(value.value, frame, true);
    else if (delta > 0) value.value = applyHistoryFrame(value.value, frames.value[cursor.value + 1]!);
    else value.value = at(cursor.value - 1);
    cursor.value += delta;
    return value.value;
  }
  return { canUndo, canRedo, current, retainedBytes, reset, record, move };
}
