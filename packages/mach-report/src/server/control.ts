import type { ReportRuntimeBudget } from "./types";

export class ReportRuntimeError extends Error {
  constructor(readonly code: "budget" | "timeout" | "queue-full" | "closed", message: string, readonly path?: string) {
    super(message); this.name = "ReportRuntimeError";
  }
}
export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof ReportRuntimeError) throw signal.reason;
  const error = new Error("报表执行已取消"); error.name = "AbortError";
  Object.defineProperty(error, "cause", { value: signal.reason }); throw error;
}
export function assertBudget(budget: ReportRuntimeBudget, key: keyof ReportRuntimeBudget, actual: number): void {
  if (!Number.isFinite(actual) || actual < 0) throw new ReportRuntimeError("budget", `${key} 的执行统计无效`, `$.budget.${key}`);
  const limit = budget[key];
  if (limit !== undefined && actual > limit) throw new ReportRuntimeError("budget", `${key} 超出预算 ${limit}（实际 ${actual}）`, `$.budget.${key}`);
}
export function validateBudget(budget: ReportRuntimeBudget): void {
  for (const [key, value] of Object.entries(budget)) {
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) throw new ReportRuntimeError("budget", `${key} 应为正有限数字`, `$.budget.${key}`);
    if (key === "maxDurationMs" && value !== undefined && value > 2_147_483_647) throw new ReportRuntimeError("budget", "maxDurationMs 不能超过 2147483647", `$.budget.${key}`);
  }
}
/** 默认同步分页只在阶段边界响应取消；硬终止 CPU 任务请使用隔离 executor。 */
export async function controlled<T>(signal: AbortSignal | undefined, timeoutMs: number | undefined, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const started = Date.now();
  const timer = timeoutMs === undefined ? undefined : setTimeout(() => controller.abort(new ReportRuntimeError("timeout", `报表执行超过 ${timeoutMs}ms`)), timeoutMs);
  let rejectAbort: (() => void) | undefined;
  try {
    throwIfAborted(controller.signal);
    const cancelled = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => { try { throwIfAborted(controller.signal); } catch (error) { reject(error); } };
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
    });
    const value = await Promise.race([run(controller.signal), cancelled]);
    throwIfAborted(controller.signal);
    if (timeoutMs !== undefined && Date.now() - started > timeoutMs) throw new ReportRuntimeError("timeout", `报表执行超过 ${timeoutMs}ms`);
    return value;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (rejectAbort) controller.signal.removeEventListener("abort", rejectAbort);
    signal?.removeEventListener("abort", onAbort);
  }
}
