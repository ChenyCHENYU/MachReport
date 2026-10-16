import { parentPort, Worker, type WorkerOptions } from "node:worker_threads";
import type { ReportRuntime, ReportRuntimeExecutor } from "./types";
import { createReportWorkerExecutor, type ReportWorkerOptions } from "../worker/client";
import { REPORT_WORKER_PROTOCOL, isReportWorkerRequest, reportWorkerTransferList, runReportWorkerRequest } from "../worker/protocol";

export interface NodeReportExecutorOptions extends ReportWorkerOptions {
  filename?: string | URL;
  workerUrl?: string | URL;
  workerOptions?: WorkerOptions;
}
/** 独立 worker_threads 适配器；worker 入口注册自己的模板/Provider，不把函数跨线程序列化。 */
export function createNodeReportExecutor(options: NodeReportExecutorOptions): ReportRuntimeExecutor {
  const filename = options.filename ?? options.workerUrl;
  if (!filename || options.filename && options.workerUrl) throw new TypeError("请且仅请指定 filename 或 workerUrl");
  return createReportWorkerExecutor(() => {
    const worker = new Worker(filename, options.workerOptions);
    return {
      postMessage: (value) => worker.postMessage(value), terminate: () => worker.terminate(),
      subscribe: (message, error) => {
        const onExit = (code: number) => error(new Error(`报表 Worker 在响应前退出（code ${code}）`));
        worker.on("message", message); worker.on("error", error); worker.on("messageerror", error); worker.on("exit", onExit);
        return () => { worker.off("message", message); worker.off("error", error); worker.off("messageerror", error); worker.off("exit", onExit); };
      }
    };
  }, options);
}
/** Node Worker 入口调用；主线程调用会明确报错。 */
export function serveNodeReportWorker(runtime: ReportRuntime): () => void {
  const port = parentPort;
  if (!port) throw new Error("serveNodeReportWorker 只能在 worker_threads 中调用");
  const onMessage = (value: unknown) => {
    if (isReportWorkerRequest(value)) void runReportWorkerRequest(runtime, value, (event) => port.postMessage({ protocol: REPORT_WORKER_PROTOCOL, id: value.id, type: "event", event })).then((result) => port.postMessage(result, reportWorkerTransferList(result)));
  };
  port.on("message", onMessage);
  return () => port.off("message", onMessage);
}
export { ReportWorkerError } from "../worker/protocol";
