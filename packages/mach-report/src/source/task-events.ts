/** 阶段事件只包含可序列化值；不表示估算百分比，也不包含业务数据。 */
export interface ReportTaskEvent {
  taskId: string;
  correlationId?: string;
  stage: "query" | "validate" | "layout" | "assets" | "encode";
  status: "started" | "completed" | "failed";
  reportId?: string;
  completed?: number;
  total?: number;
}
export type ReportTaskObserver = (event: ReportTaskEvent) => void;
export interface ReportTaskMonitoring {
  taskId?: string;
  correlationId?: string;
  onEvent?: ReportTaskObserver;
}
let sequence = 0;
export function reportTaskId(): string { return `report-${Date.now()}-${++sequence}`; }
/** 观测不参与任务事务；取消后不允许迟到事件重新改变宿主的任务状态。 */
export function notifyReportTaskEvent(observer: ReportTaskObserver | undefined, event: ReportTaskEvent, signal?: AbortSignal): void {
  if (signal?.aborted) return;
  try {
    const observed: unknown = observer?.({ ...event });
    // TypeScript允许async函数赋给void回调；也隔离其异步拒绝，避免unhandledRejection。
    if (observed && typeof (observed as PromiseLike<unknown>).then === "function") void Promise.resolve(observed).catch(() => {});
  } catch { /* 遥测回调失败不得破坏报表或二进制输出。 */ }
}
export function createReportTaskReporter(input: ReportTaskMonitoring & { signal?: AbortSignal }) {
  const taskId = input.taskId ?? reportTaskId();
  const emit = (stage: ReportTaskEvent["stage"], status: ReportTaskEvent["status"], reportId?: string) => {
    notifyReportTaskEvent(input.onEvent, { taskId, ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }), stage, status, ...(reportId === undefined ? {} : { reportId }) }, input.signal);
  };
  return {
    taskId,
    progress(stage: ReportTaskEvent["stage"], completed: number, total: number): void {
      notifyReportTaskEvent(input.onEvent, { taskId, ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }), stage, status: "started", completed, total }, input.signal);
    },
    async run<T>(stage: ReportTaskEvent["stage"], operation: () => T | Promise<T>, reportId?: string): Promise<T> {
      emit(stage, "started", reportId);
      try { const result = await operation(); emit(stage, "completed", reportId); return result; }
      catch (error) { emit(stage, "failed", reportId); throw error; }
    },
    runSync<T>(stage: ReportTaskEvent["stage"], operation: () => T, reportId?: string): T {
      emit(stage, "started", reportId);
      try { const result = operation(); emit(stage, "completed", reportId); return result; }
      catch (error) { emit(stage, "failed", reportId); throw error; }
    }
  };
}
