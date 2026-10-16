import { shallowRef } from "vue";
import type { ReportPreviewTask, ReportPreviewTaskStage } from "../guards";

let taskSequence = 0;
export function usePreviewTask(onTask: (task: Readonly<ReportPreviewTask>) => void) {
  const state = shallowRef<Readonly<ReportPreviewTask> | null>(null);
  const observed = new Set<string>();
  let cancelCurrent: (() => void) | null = null;
  function publish(value: ReportPreviewTask): void {
    state.value = Object.freeze(value);
    try { onTask(state.value); } catch { /* An observer cannot fail the operation. */ }
  }
  function start(kind: ReportPreviewTask["kind"], stage: ReportPreviewTaskStage, cancel: () => void) {
    const taskId = `mr-task-${Date.now().toString(36)}-${++taskSequence}`;
    observed.add(taskId);
    cancelCurrent = cancel;
    publish({ taskId, kind, stage, status: "running", cancellable: true });
    function update(next: ReportPreviewTaskStage, completed?: number, total?: number): void {
      if (state.value?.taskId !== taskId || state.value.status !== "running") return;
      publish({ ...state.value, stage: next, completed, total });
    }
    function finish(status: Exclude<ReportPreviewTask["status"], "running"> = "completed"): void {
      if (state.value?.taskId !== taskId || state.value.status !== "running") return;
      cancelCurrent = null;
      publish({ ...state.value, status, cancellable: false });
    }
    return { taskId, update, finish };
  }
  function cancel(): void {
    if (state.value?.status !== "running") return;
    const action = cancelCurrent; cancelCurrent = null;
    publish({ ...state.value, status: "cancelled", cancellable: false });
    action?.();
  }
  function receive(task: Readonly<ReportPreviewTask>, cancel: () => void): void {
    if (state.value?.taskId !== task.taskId && (task.status !== "running" || observed.has(task.taskId))) return;
    observed.add(task.taskId);
    if (observed.size > 100) observed.delete(observed.values().next().value!);
    cancelCurrent = task.status === "running" ? cancel : null;
    publish({ ...task });
  }
  return { state, start, cancel, receive };
}
