import { serializeJobJson } from "./job-store";
import { throwIfAborted } from "./control";

export interface ReportBatchCase { id: string; params: Record<string, string> }
export type ReportBatchOutcome<T> = { id: string; index: number } & (
  { status: "completed"; value: T } | { status: "failed"; error: { name: string; message: string } } | { status: "cancelled" }
);
export interface ReportBatchProgress { completed: number; total: number; failed: number; cancelled: number }
export interface ReportBatchOptions {
  concurrency?: number;
  maxCases?: number;
  signal?: AbortSignal;
  /** Stop launching new cases after the first failure; already running cases finish. */
  failure?: "continue" | "stop";
  onProgress?: (progress: ReportBatchProgress) => void;
}
export function snapshotReportBatchCases(input: readonly ReportBatchCase[], maximum = 100): ReportBatchCase[] {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 1000 || !Array.isArray(input) || input.length > maximum) throw new RangeError("批量参数应包含 1–maxCases 条，maxCases 最大为 1000");
  // Snapshot before execution, reject getters and unsafe keys rather than running host scripts.
  const cases = JSON.parse(serializeJobJson(input)) as ReportBatchCase[], ids = new Set<string>();
  for (const item of cases) {
    if (!item || typeof item.id !== "string" || item.id !== item.id.trim() || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(item.id) || ids.has(item.id)) throw new TypeError("批量行 ID 应唯一且为安全标识");
    if (!item.params || Array.isArray(item.params) || typeof item.params !== "object" || Object.values(item.params).some(value => typeof value !== "string")) throw new TypeError("批量参数应为字符串字典");
    ids.add(item.id);
  }
  return cases;
}
function reportBatchProgress<T>(outcomes: Array<ReportBatchOutcome<T> | undefined>, observer?: ReportBatchOptions["onProgress"]): void {
  if (!observer) return;
  const progress = { completed: 0, total: outcomes.length, failed: 0, cancelled: 0 };
  for (const result of outcomes) {
    if (!result) continue;
    progress.completed++;
    if (result.status === "failed") progress.failed++;
    if (result.status === "cancelled") progress.cancelled++;
  }
  // UI observers cannot turn a committed instance or artifact into a failed generation.
  try { observer(progress); } catch { /* Observation is independent of execution. */ }
}
/** Browser/Node shared bounded runner. Return small receipts; persist/export large artifacts inside execute. */
export async function runReportBatch<T>(input: readonly ReportBatchCase[], execute: (item: ReportBatchCase, context: { index: number; signal: AbortSignal }) => Promise<T>, options: ReportBatchOptions = {}): Promise<ReportBatchOutcome<T>[]> {
  const concurrency = options.concurrency ?? 2;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new RangeError("批量并发应为 1–16");
  if (options.failure !== undefined && options.failure !== "continue" && options.failure !== "stop") throw new TypeError("批量失败策略无效");
  const cases = snapshotReportBatchCases(input, options.maxCases ?? 100);
  if (!cases.length) throw new RangeError("批量生成至少需要一组参数");
  const outcomes: Array<ReportBatchOutcome<T> | undefined> = Array.from({ length: cases.length });
  const controller = new AbortController(), abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  let cursor = 0, stopped = false;
  async function worker(): Promise<void> {
    while (cursor < cases.length) {
      const index = cursor++, item = cases[index]!, base = { id: item.id, index };
      if (stopped || controller.signal.aborted) outcomes[index] = { ...base, status: "cancelled" };
      else {
        try {
          throwIfAborted(controller.signal);
          // Do not check cancellation after commit: a successful execute remains successful.
          const value = await execute(item, { index, signal: controller.signal });
          outcomes[index] = { ...base, status: "completed", value };
        } catch (error) {
          if (controller.signal.aborted) outcomes[index] = { ...base, status: "cancelled" };
          else {
            outcomes[index] = { ...base, status: "failed", error: { name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error) } };
            if (options.failure === "stop") stopped = true;
          }
        }
      }
      reportBatchProgress(outcomes, options.onProgress);
    }
  }
  try { await Promise.all(Array.from({ length: Math.min(concurrency, cases.length) }, worker)); }
  finally { options.signal?.removeEventListener("abort", abort); }
  return outcomes as ReportBatchOutcome<T>[];
}
