import type { ReportRuntimeExecutor } from "../server/types";
import { createReportWorkerExecutor, type ReportWorkerOptions } from "./client";


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
      postMessage: (value, transfer) => worker.postMessage(value, transfer), terminate: () => worker.terminate(),
      subscribe: (message, error) => {
        const onMessage = (event: MessageEvent) => message(event.data);
        const onError = (event: Event) => error(event instanceof ErrorEvent ? new Error(event.message) : new Error("报表 Worker 消息无法解码"));
        worker.addEventListener("message", onMessage); worker.addEventListener("error", onError); worker.addEventListener("messageerror", onError);
        return () => { worker.removeEventListener("message", onMessage); worker.removeEventListener("error", onError); worker.removeEventListener("messageerror", onError); };
      }
    };
  }, options);
}
