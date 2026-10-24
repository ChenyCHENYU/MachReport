import { createAutoExporterController } from "../worker/auto-core";
import type { ReportAutoExporter, ReportExportExecutionOptions } from "../worker/auto-types";
import { runReportEncodingRequest } from "../worker/encoding";
import { parentPort, workerData, Worker, type WorkerOptions } from "node:worker_threads";
import { createHash } from "node:crypto";
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
      postMessage: (value, transfer) => worker.postMessage(value, transfer), terminate: () => worker.terminate(),
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
export { openFileReportJobStore } from "./node-job-store";
export type { FileReportJobStore, FileReportJobStoreOptions } from "./node-job-store";
/** Optional publication digest for Node hosts; use as reviewReportPublication({ digest }). */
export function reportArtifactSha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }

/** Node needs no URL factory: this module is the isolated encoding entry in both ESM and CommonJS builds. */
export function createNodeAutoReportExporter(options: Omit<ReportExportExecutionOptions, "workerFactory"> = {}): ReportAutoExporter {
  const workerOptions = { timeoutMs: options.timeoutMs ?? options.budget?.maxDurationMs, budget: { ...options.budget } };
  return createAutoExporterController(options, timeoutMs => createNodeReportExecutor({
    filename: typeof __filename === "string" ? __filename : new URL(import.meta.url),
    workerOptions: { workerData: { machReportEncoding: "prepared-v1" } },
    ...workerOptions, timeoutMs
  }));
}
if (parentPort && workerData?.machReportEncoding === "prepared-v1") {
  const port = parentPort;
  port.on("message", (request: unknown) => {
    if (!isReportWorkerRequest(request)) return;
    void runReportEncodingRequest(request, event => port.postMessage({ protocol: REPORT_WORKER_PROTOCOL, id: request.id, type: "event", event }))
      .then(result => port.postMessage(result, reportWorkerTransferList(result)));
  });
}
export type { ReportAutoExporter, ReportAutoExportResult, ReportExportDecision, ReportExportExecutionOptions } from "../worker/auto-types";
