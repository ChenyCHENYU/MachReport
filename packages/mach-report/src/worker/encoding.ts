import { createReportRuntime } from "../server/runtime";
import type { ReportTaskObserver } from "../source/task-events";
import type { ReportWorkerScope } from "./browser";
import { REPORT_WORKER_PROTOCOL, isReportWorkerRequest, reportWorkerTransferList, runReportWorkerRequest, serializeError, type ReportWorkerRequest, type ReportWorkerResponse } from "./protocol";

/** Built-in worker accepts prepared output only. Providers, credentials and asset callbacks stay in the host. */
export async function runReportEncodingRequest(request: ReportWorkerRequest, onEvent?: ReportTaskObserver): Promise<ReportWorkerResponse> {
  try {
    if (request.operation !== "exportPrepared") throw new TypeError("内置编码 Worker 仅接受 exportPrepared");
    return await runReportWorkerRequest(createReportRuntime({ reports: {}, budget: request.budget }), request, onEvent);
  } catch (error) { return { protocol: REPORT_WORKER_PROTOCOL, id: request.id, error: serializeError(error) }; }
}
export function serveReportEncodingWorker(scope: ReportWorkerScope = globalThis as unknown as ReportWorkerScope): () => void {
  const onMessage = (event: MessageEvent) => {
    if (!isReportWorkerRequest(event.data)) return;
    const request = event.data;
    void runReportEncodingRequest(request, taskEvent => scope.postMessage({ protocol: REPORT_WORKER_PROTOCOL, id: request.id, type: "event", event: taskEvent }))
      .then(result => scope.postMessage(result, reportWorkerTransferList(result)));
  };
  scope.addEventListener("message", onMessage);
  return () => scope.removeEventListener("message", onMessage);
}
