import type { ReportRuntime, ReportRuntimeExecutor } from "../server/types";
import { createReportWorkerExecutor, type ReportWorkerOptions } from "./client";
import { isReportWorkerRequest, reportWorkerTransferList, runReportWorkerRequest } from "./protocol";

export interface BrowserReportWorker {
  postMessage(value: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  addEventListener(type: "error" | "messageerror", listener: (event: Event) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "error" | "messageerror", listener: (event: Event) => void): void;
}
export interface ReportWorkerScope {
  postMessage(value: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}
/** factory 每次返回全新 Worker，例如 () => new Worker(new URL('./worker.ts', import.meta.url), {type:'module'})。 */
export function createBrowserReportExecutor(factory: () => BrowserReportWorker, options: ReportWorkerOptions = {}): ReportRuntimeExecutor {
  return createReportWorkerExecutor(() => {
    const worker = factory();
    return {
      postMessage: (value) => worker.postMessage(value), terminate: () => worker.terminate(),
      subscribe: (message, error) => {
        const onMessage = (event: MessageEvent) => message(event.data);
        const onError = (event: Event) => error(event instanceof ErrorEvent ? new Error(event.message) : new Error("报表 Worker 消息无法解码"));
        worker.addEventListener("message", onMessage); worker.addEventListener("error", onError); worker.addEventListener("messageerror", onError);
        return () => { worker.removeEventListener("message", onMessage); worker.removeEventListener("error", onError); worker.removeEventListener("messageerror", onError); };
      }
    };
  }, options);
}
/** 在 Worker 入口注册一次 runtime；返回函数可清理监听器，浏览器主线程无需引入 Node。 */
export function serveReportWorker(runtime: ReportRuntime, scope: ReportWorkerScope = globalThis as unknown as ReportWorkerScope): () => void {
  const onMessage = (event: MessageEvent) => {
    if (isReportWorkerRequest(event.data)) void runReportWorkerRequest(runtime, event.data).then((result) => scope.postMessage(result, reportWorkerTransferList(result)));
  };
  scope.addEventListener("message", onMessage);
  return () => scope.removeEventListener("message", onMessage);
}
export { ReportWorkerError } from "./protocol";
export type { ReportWorkerOptions } from "./client";
