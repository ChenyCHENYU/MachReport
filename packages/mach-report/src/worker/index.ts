import type { ReportRuntime } from "../server/types";
import type { ReportWorkerScope } from "./browser";
import { REPORT_WORKER_PROTOCOL, isReportWorkerRequest, reportWorkerTransferList, runReportWorkerRequest } from "./protocol";
export { createBrowserReportExecutor } from "./browser";
export type { BrowserReportWorker, ReportWorkerScope } from "./browser";
/** 在 Worker 入口注册一次 runtime；返回函数可清理监听器，浏览器主线程无需引入 Node。 */
export function serveReportWorker(runtime: ReportRuntime, scope: ReportWorkerScope = globalThis as unknown as ReportWorkerScope): () => void {
  const onMessage = (event: MessageEvent) => {
    if (isReportWorkerRequest(event.data)) void runReportWorkerRequest(runtime, event.data, (taskEvent) => scope.postMessage({ protocol: REPORT_WORKER_PROTOCOL, id: event.data.id, type: "event", event: taskEvent })).then((result) => scope.postMessage(result, reportWorkerTransferList(result)));
  };
  scope.addEventListener("message", onMessage);
  return () => scope.removeEventListener("message", onMessage);
}
export { ReportWorkerError } from "./protocol";
export type { ReportWorkerOptions } from "./client";
export { createAutoReportExporter } from "./auto";
export { ReportWorkerStartError } from "./client";
export type { ReportAutoExporter, ReportAutoExportResult, ReportExportDecision, ReportExportDecisionReason, ReportExportExecutionOptions, ReportExportThresholds, ReportLocalExport } from "./auto-types";
export { serveReportEncodingWorker } from "./encoding";
