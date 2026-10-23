import type { ReportRuntimeExecutor } from "../server/types";
import { notifyReportTaskEvent, type ReportTaskObserver } from "../source/task-events";
import { REPORT_WORKER_PROTOCOL, ReportWorkerError, validReportWorkerEvent, validReportWorkerResult, type ReportWorkerRequest, type ReportWorkerResponse } from "./protocol";

export interface ReportWorkerConnection {
  postMessage(value: ReportWorkerRequest): void;
  terminate(): void | number | Promise<void | number>;
  subscribe(message: (value: unknown) => void, error: (error: unknown) => void): () => void;
}
export interface ReportWorkerOptions { timeoutMs?: number }
let sequence = 0;
function abortError(reason?: unknown): Error {
  const error = new Error("报表 Worker 任务已取消"); error.name = "AbortError";
  Object.defineProperty(error, "cause", { value: reason }); return error;
}
function matchingResponse(value: unknown, id: string): ReportWorkerResponse | undefined {
  if (!value || typeof value !== "object") return;
  const response = value as Partial<ReportWorkerResponse>;
  return response.protocol === REPORT_WORKER_PROTOCOL && response.id === id ? response as ReportWorkerResponse : undefined;
}

/** 一个任务一个隔离实例；所有出口在 Promise 完成前终止实例并清理监听器。 */
export function createReportWorkerExecutor(factory: () => ReportWorkerConnection, options: ReportWorkerOptions = {}): ReportRuntimeExecutor {
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) throw new RangeError("Worker timeoutMs 应为正有限数字，且不能超过 2147483647");
  const execute = <T>(operation: ReportWorkerRequest["operation"], input: ReportWorkerRequest["input"], signal?: AbortSignal, onEvent?: ReportTaskObserver): Promise<T> => {
    if (signal?.aborted) return Promise.reject(abortError(signal.reason));
    return new Promise<T>((resolve, reject) => {
      let connection: ReportWorkerConnection;
      try { connection = factory(); } catch (error) { reject(error); return; }
      const id = `mach-report-${Date.now()}-${++sequence}`;
      let settled = false;
      let unsubscribe: () => void = () => {};
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: unknown, value?: T) => {
        if (settled) return;
        settled = true; if (timer) clearTimeout(timer);
        unsubscribe(); signal?.removeEventListener("abort", onAbort);
        Promise.resolve().then(() => connection.terminate()).then(
          () => error === undefined ? resolve(value!) : reject(error),
          (terminationError: unknown) => reject(error ?? terminationError)
        );
      };
      const onAbort = () => finish(abortError(signal?.reason));
      const onMessage = (value: unknown) => {
        const response = matchingResponse(value, id);
        if (!response || settled) return;
        if ("type" in response && response.type === "event") {
          const event = "event" in response ? response.event : undefined;
          if (validReportWorkerEvent(event, input)) notifyReportTaskEvent(onEvent, event, signal);
          else finish(new Error("报表 Worker 返回无效阶段事件"));
          return;
        }
        if (response.error && typeof response.error.name === "string" && typeof response.error.message === "string") finish(new ReportWorkerError(response.error));
        else if (validReportWorkerResult(response.result, operation) && (operation === "prepare" || "format" in response.result && "format" in input && response.result.format === input.format)) finish(undefined, response.result as T);
        else finish(new Error("报表 Worker 返回无效响应"));
      };
      try {
        unsubscribe = connection.subscribe(onMessage, (error) => finish(error ?? new Error("报表 Worker 执行失败")));
        if (settled) { unsubscribe(); return; }
        signal?.addEventListener("abort", onAbort, { once: true });
        timer = setTimeout(() => finish(new ReportWorkerError({ name: "ReportRuntimeError", code: "timeout", message: `报表 Worker 执行超过 ${timeoutMs}ms` })), timeoutMs);
        if (signal?.aborted) onAbort();
        else {
          const { onEvent: _onEvent, signal: _signal, ...serializable } = input as typeof input & { onEvent?: unknown; signal?: unknown };
          connection.postMessage({ protocol: REPORT_WORKER_PROTOCOL, id, operation, input: serializable });
        }
      } catch (error) { finish(error); }
    });
  };
  return { exportPrepared: (input, signal, onEvent) => execute("exportPrepared", input, signal, onEvent), prepare: (input, signal, onEvent) => execute("prepare", input, signal, onEvent), export: (input, signal, onEvent) => execute("export", input, signal, onEvent) };
}
