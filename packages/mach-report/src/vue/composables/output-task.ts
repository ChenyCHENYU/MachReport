import type { ReportPreviewTask, ReportPreviewTaskStage } from "../guards";

let sequence = 0;
export interface OutputRun {
  controller: AbortController;
  task: ReportPreviewTask;
  start(): void;
  update(stage: ReportPreviewTaskStage, completed?: number, total?: number): void;
  finish(status?: "completed" | "cancelled" | "failed"): void;
}
export function createOutputRun(kind: "export" | "print", observer?: (task: Readonly<ReportPreviewTask>) => void): OutputRun {
  const controller = new AbortController();
  let task: ReportPreviewTask = { taskId: `mr-output-${Date.now().toString(36)}-${++sequence}`, kind, stage: kind === "print" ? "print" : "encode", status: "running", cancellable: true };
  function emit(): void { try { observer?.(Object.freeze({ ...task })); } catch { /* Observer failure is isolated. */ } }
  return {
    controller,
    get task() { return task; },
    start: emit,
    update(stage, completed, total): void {
      if (controller.signal.aborted || task.status !== "running") return;
      task = { ...task, stage, completed, total }; emit();
    },
    finish(status = "completed"): void {
      if (task.status !== "running") return;
      task = { ...task, status, cancellable: false }; emit();
      if (status === "cancelled") controller.abort();
    }
  };
}
