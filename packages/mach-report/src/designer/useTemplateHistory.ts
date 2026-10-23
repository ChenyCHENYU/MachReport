import { computed, ref, shallowRef } from "vue";
import { applyHistoryFrame, createHistoryFrame, historyFrameBytes, type HistoryFrame } from "./history-patch";

/** Session-only coordinates are bounded and never serialized into a report document. */
export interface TemplateHistoryContext { pageIndex: number; componentIndex?: number }
type ContextFrame = HistoryFrame & { view?: { before: TemplateHistoryContext; after: TemplateHistoryContext } };
const frameBytes = (frame: ContextFrame) => historyFrameBytes(frame) + (frame.view ? 64 : 0);
const withContext = (frame: HistoryFrame, context?: TemplateHistoryContext): ContextFrame => context ? { ...frame, view: { before: { ...context }, after: { ...context } } } : frame;

/** Private reversible deltas retain invalid input too; checkpoints bound reconstruction work. */
export function useTemplateHistory(initial: string, budget = { entries: 100, bytes: 16 * 1024 * 1024 }) {
  if (![budget.entries, budget.bytes].every((item) => Number.isSafeInteger(item) && item > 0)) throw new RangeError("History budgets must be positive safe integers");
  const frames = shallowRef<ContextFrame[]>([{ kind: "snapshot", value: initial }]);
  const cursor = ref(0);
  const value = ref(initial);
  const canUndo = computed(() => cursor.value > 0);
  const canRedo = computed(() => cursor.value + 1 < frames.value.length);
  const current = computed(() => value.value);
  const retainedBytes = computed(() => frames.value.reduce((sum, frame) => sum + frameBytes(frame), 0));
  const context = shallowRef<TemplateHistoryContext>();
  function reset(snapshot: string, nextContext?: TemplateHistoryContext): void {
    frames.value = [withContext({ kind: "snapshot", value: snapshot }, nextContext)]; cursor.value = 0; value.value = snapshot; context.value = nextContext;
  }
  function at(index: number): string {
    let checkpoint = index;
    while (checkpoint > 0 && frames.value[checkpoint]!.kind !== "snapshot") checkpoint--;
    let result = "";
    for (; checkpoint <= index; checkpoint++) result = applyHistoryFrame(result, frames.value[checkpoint]!);
    return result;
  }
  function prune(next: ContextFrame[]): ContextFrame[] {
    let bytes = next.reduce((sum, frame) => sum + frameBytes(frame), 0);
    while (next.length > 1 && (next.length > budget.entries || bytes > budget.bytes)) {
      const first = next[0] as Extract<HistoryFrame, { kind: "snapshot" }>;
      const second = next[1]!;
      const replacement = withContext({ kind: "snapshot", value: applyHistoryFrame(first.value, second) }, second.view?.after);
      bytes += frameBytes(replacement) - frameBytes(first) - frameBytes(second);
      next.splice(0, 2, replacement);
    }
    return next;
  }
  function annotate(nextContext?: TemplateHistoryContext): void {
    if (!nextContext) return;
    const next = frames.value.slice();
    const current = next[cursor.value]!;
    next[cursor.value] = current.view ? { ...current, view: { before: current.view.before, after: { ...nextContext } } } : withContext(current, nextContext);
    frames.value = next;
  }
  function record(snapshot: string, nextContext?: TemplateHistoryContext): boolean {
    if (value.value === snapshot) return false;
    const next = frames.value.slice(0, cursor.value + 1);
    next.push(withContext(createHistoryFrame(value.value, snapshot, next.length % 20 === 0), nextContext));
    frames.value = prune(next); cursor.value = frames.value.length - 1; value.value = snapshot;
    return true;
  }
  function move(delta: -1 | 1): string | undefined {
    if (delta < 0 ? !canUndo.value : !canRedo.value) return;
    const frame = frames.value[cursor.value]!;
    context.value = delta < 0 ? frame.view?.before : frames.value[cursor.value + 1]?.view?.after;
    if (delta < 0 && frame.kind === "patch") value.value = applyHistoryFrame(value.value, frame, true);
    else if (delta > 0) value.value = applyHistoryFrame(value.value, frames.value[cursor.value + 1]!);
    else value.value = at(cursor.value - 1);
    cursor.value += delta;
    return value.value;
  }
  return { canUndo, canRedo, current, context, retainedBytes, reset, record, move, annotate };
}
