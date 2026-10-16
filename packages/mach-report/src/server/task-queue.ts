import { ReportRuntimeError, throwIfAborted } from "./control";

export type ReportTaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export interface ReportTaskContext { signal: AbortSignal; reportProgress(completed: number, total?: number): void }
export interface ReportTask<T> {
  readonly id: string;
  readonly status: ReportTaskStatus;
  readonly progress: { completed: number; total?: number } | undefined;
  result: Promise<T>;
  cancel(reason?: unknown): void;
}
export interface ReportTaskQueue {
  readonly active: number;
  readonly pending: number;
  enqueue<T>(run: (context: ReportTaskContext) => T | Promise<T>, options?: { id?: string; signal?: AbortSignal }): ReportTask<T>;
  /** 关闭后拒绝新任务并取消排队任务；运行任务按参数发送取消信号。 */
  close(options?: { cancelRunning?: boolean }): void;
}
interface QueueEntry { start(): void; cancel(reason?: unknown): void }

/** 有界、无重试的进程内任务队列；取消不会提前归还仍在执行的 CPU 任务并发槽位。 */
export function createReportTaskQueue(options: { concurrency?: number; maxQueued?: number } = {}): ReportTaskQueue {
  const concurrency = options.concurrency ?? 1;
  const maxQueued = options.maxQueued ?? 20;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || !Number.isSafeInteger(maxQueued) || maxQueued < 0) throw new ReportRuntimeError("budget", "队列并发应为正整数，排队上限应为非负整数");
  const pending: QueueEntry[] = [];
  const running = new Set<QueueEntry>();
  const ids = new Set<string>();
  let closed = false;
  let sequence = 0;
  const drain = () => {
    while (!closed && running.size < concurrency && pending.length) pending.shift()!.start();
  };
  const enqueue = <T>(run: (context: ReportTaskContext) => T | Promise<T>, request: { id?: string; signal?: AbortSignal } = {}): ReportTask<T> => {
    if (closed) throw new ReportRuntimeError("closed", "任务队列已关闭");
    throwIfAborted(request.signal);
    if (running.size >= concurrency && pending.length >= maxQueued) throw new ReportRuntimeError("queue-full", "报表任务队列已满");
    const id = request.id ?? `report-${++sequence}`;
    if (ids.has(id)) throw new ReportRuntimeError("queue-full", "任务 ID 正在执行或排队");
    const controller = new AbortController();
    let status: ReportTaskStatus = "queued";
    let progress: ReportTask<T>["progress"];
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const result = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    const clean = () => { request.signal?.removeEventListener("abort", externalAbort); ids.delete(id); };
    const cancel = (reason?: unknown) => {
      if (status !== "queued" && status !== "running") return;
      const queued = status === "queued";
      status = "cancelled"; controller.abort(reason);
      try { throwIfAborted(controller.signal); } catch (error) { reject(error); }
      if (queued) { const index = pending.indexOf(entry); if (index >= 0) pending.splice(index, 1); clean(); drain(); }
    };
    const externalAbort = () => cancel(request.signal?.reason);
    const reportProgress = (completed: number, total?: number) => {
      if (status !== "running") return;
      if (!Number.isFinite(completed) || completed < 0 || total !== undefined && (!Number.isFinite(total) || total < completed)) return;
      progress = { completed, ...(total === undefined ? {} : { total }) };
    };
    const entry: QueueEntry = {
      cancel,
      start: () => {
        if (status !== "queued") return;
        status = "running"; running.add(entry);
        Promise.resolve().then(() => { throwIfAborted(controller.signal); return run({ signal: controller.signal, reportProgress }); }).then(
          (value) => { if (status === "running") { status = "completed"; resolve(value); } },
          (error) => { if (status === "running") { status = "failed"; reject(error); } }
        ).finally(() => { running.delete(entry); clean(); drain(); });
      }
    };
    ids.add(id); request.signal?.addEventListener("abort", externalAbort, { once: true });
    if (request.signal?.aborted) cancel(request.signal.reason);
    else if (running.size < concurrency) entry.start();
    else pending.push(entry);
    return { id, get status() { return status; }, get progress() { return progress; }, result, cancel };
  };
  return {
    get active() { return running.size; }, get pending() { return pending.length; }, enqueue,
    close: (request = {}) => {
      closed = true;
      for (const entry of [...pending]) entry.cancel(new ReportRuntimeError("closed", "任务队列已关闭"));
      if (request.cancelRunning) for (const entry of running) entry.cancel(new ReportRuntimeError("closed", "任务队列已关闭"));
    }
  };
}
