import { observeOutput } from "../output/progress";
import { createReportRuntime, enforcePrepared } from "../server/runtime";
import { DEFAULT_REPORT_RUNTIME_BUDGET, assertBudget, controlled, ReportRuntimeError, throwIfAborted, validateBudget } from "../server/control";
import { assertPreparedOutputBudget, snapshotPdfFonts, capturePreparedHandoff, snapshotXlsxOptions } from "../server/prepared";
import type { ReportRuntimeBudget, ReportRuntimeExecutor, ReportRuntimeExportResult, ReportRuntimePreparedExportInput } from "../server/types";
import { decideReportExport } from "./auto-policy";
import { ReportWorkerStartError } from "./client";
import type { ReportAutoExporter, ReportAutoExportResult, ReportExportDecision, ReportExportExecutionOptions, ReportLocalExport } from "./auto-types";

function validateOptions(options: ReportExportExecutionOptions): void {
  if (options.mode !== undefined && !["auto", "local", "worker"].includes(options.mode)) throw new TypeError("无效的导出执行模式");
  if (options.fallback !== undefined && !["local", "error"].includes(options.fallback)) throw new TypeError("无效的导出回退策略");
  validateBudget({ ...options.budget, maxDurationMs: options.timeoutMs ?? options.budget?.maxDurationMs ?? 120_000 });
}
function notify(options: ReportExportExecutionOptions, decision: ReportExportDecision): void {
  observeOutput(() => options.onDecision?.({ ...decision, estimate: { ...decision.estimate } }));
}
function fallbackDecision(decision: ReportExportDecision, reason: ReportExportDecision["reason"]): ReportExportDecision { return { ...decision, mode: "local", reason, hardCancellation: false }; }
function assertOutputResult(result: ReportRuntimeExportResult, input: ReportRuntimePreparedExportInput, budget: ReportRuntimeBudget): void {
  assertBudget(budget, "maxRows", result.stats.rows);
  assertBudget(budget, "maxPages", result.stats.pages);
  assertBudget(budget, "maxCells", result.stats.cells);
  assertBudget(budget, "maxOutputBytes", result.bytes.byteLength);
  assertPreparedOutputBudget({ ...input, prepared: { ...input.prepared, stats: result.stats } }, budget);
}
function capture(input: ReportRuntimePreparedExportInput, options: ReportExportExecutionOptions): { request: ReportRuntimePreparedExportInput; forward(): ReportRuntimePreparedExportInput } {
  const budget = { ...DEFAULT_REPORT_RUNTIME_BUDGET, ...options.budget };
  const owned = capturePreparedHandoff(input.prepared, budget.maxPreparedBytes, input.signal);
  const request = { ...input, prepared: owned.prepared, pdf: snapshotPdfFonts(input.pdf), xlsx: snapshotXlsxOptions(input.xlsx) };
  return { request, forward: () => ({ ...request, prepared: owned.forward() }) };
}
/** Internal shared controller. Isolation accepts only a prepared, serializable plan, never providers or asset callbacks. */
export function createAutoExporterController(options: ReportExportExecutionOptions, executorFactory?: (timeoutMs: number) => ReportRuntimeExecutor): ReportAutoExporter {
  validateOptions(options);
  const config = { ...options, thresholds: { ...options.thresholds }, budget: { ...DEFAULT_REPORT_RUNTIME_BUDGET, ...options.budget } };
  const timeoutMs = config.timeoutMs ?? config.budget.maxDurationMs ?? 120_000;
  const local = createReportRuntime({ reports: {}, budget: { ...config.budget, maxDurationMs: timeoutMs } });
  const active = new Set<AbortController>(); let closed = false;
  const fallbackAllowed = config.mode !== "worker" && config.fallback !== "error";
  async function execute(input: ReportRuntimePreparedExportInput, localOverride?: ReportLocalExport): Promise<ReportAutoExportResult> {
    const started = Date.now();
    const remaining = () => { const value = timeoutMs - (Date.now() - started); if (value <= 0) throw new ReportRuntimeError("timeout", `报表执行超过 ${timeoutMs}ms`); return value; };
    let decision = decideReportExport(input, config);
    if (decision.reason === "nonserializable-options" && config.mode === "worker") throw new TypeError("Worker 模式不接受函数选项；请使用本地模式或可序列化配置");
    if (decision.mode === "worker" && !executorFactory) {
      if (!fallbackAllowed) throw new ReportWorkerStartError(new Error("未配置 workerFactory"));
      decision = fallbackDecision(decision, "worker-unavailable");
    }
    // Capture before observers can mutate the host input through a closure. The same private
    // snapshot is handed to the local runtime once, including a synchronous startup fallback.
    const captured = capture(input, config), request = captured.request;
    notify(config, decision);
    throwIfAborted(input.signal);
    if (decision.mode === "worker") {
      try {
        const executor = executorFactory!(remaining());
        if (!executor.exportPrepared) throw new TypeError("隔离执行器缺少 exportPrepared");
        const { signal, onEvent, ...serializable } = request;
        const result = await executor.exportPrepared(serializable, signal, onEvent);
        throwIfAborted(signal);
        assertOutputResult(result, request, config.budget);
        return { ...result, execution: decision };
      } catch (error) {
        if (!(error instanceof ReportWorkerStartError) || !fallbackAllowed) throw error;
        throwIfAborted(input.signal);
        decision = fallbackDecision(decision, "worker-start-failed"); notify(config, decision);
      }
    }
    // Geometry is checked once at its actual execution boundary. Large jobs validate in
    // the Worker, while local Runtime consumes the private one-use snapshot handoff.
    if (localOverride) {
      request.prepared = enforcePrepared(request.prepared, config.budget);
      assertPreparedOutputBudget(request, config.budget);
    }
    const result = localOverride ? await controlled(input.signal, remaining(), signal => localOverride({ ...request, signal })) : await controlled(input.signal, remaining(), signal => local.exportPrepared({ ...captured.forward(), signal }));
    throwIfAborted(input.signal);
    assertOutputResult(result, request, config.budget);
    return { ...result, execution: decision };
  }
  return {
    async exportPrepared(input, localOverride) {
      if (closed) throw new ReportRuntimeError("closed", "导出执行器已释放");
      throwIfAborted(input.signal);
      if (active.size >= 2) throw new ReportRuntimeError("queue-full", "同时导出的任务已达 2 个，请等待完成后重试");
      const controller = new AbortController(); active.add(controller);
      const abort = () => controller.abort(input.signal?.reason); input.signal?.addEventListener("abort", abort, { once: true });
      try { return await execute({ ...input, signal: controller.signal }, localOverride); }
      finally { input.signal?.removeEventListener("abort", abort); active.delete(controller); }
    },
    cancel() { for (const controller of active) controller.abort(); },
    dispose() { closed = true; for (const controller of active) controller.abort(); }
  };
}
