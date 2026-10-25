import { onScopeDispose, ref, shallowRef, watch, type Ref, type ShallowRef } from "vue";
import type { RenderPlan } from "../../schema/render-plan";
import type { ReportDataReviewSource } from "../data-review";

interface DataReviewHost<Options> { plan: Ref<RenderPlan | null>; options: Readonly<Ref<Options | false | undefined>>; blocked(): boolean; onError?(message: string, cause: unknown): void }
function aborted(): Error { const error = new Error("Report data loading cancelled"); error.name = "AbortError"; return error; }
async function loadBounded<Options extends ReportDataReviewSource>(options: Options, controller: AbortController): Promise<Awaited<ReturnType<Options["load"]>>> {
  const timeout = options.timeoutMs ?? 15_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120_000) throw new Error("Report data loading timeout must be 1–120000 ms");
  let rejectAbort: ((reason: unknown) => void) | undefined;
  const abort = () => rejectAbort?.(aborted());
  const cancelled = new Promise<never>((_, reject) => { rejectAbort = reject; controller.signal.addEventListener("abort", abort, { once: true }); });
  const timer = setTimeout(() => { rejectAbort?.(new Error("Report data loading timed out")); controller.abort(); }, timeout);
  try {
    return await Promise.race([Promise.resolve(options.load({ signal: controller.signal })), cancelled]) as Awaited<ReturnType<Options["load"]>>;
  } finally { clearTimeout(timer); controller.signal.removeEventListener("abort", abort); }
}
export interface ReportDataReviewState<Result> { busy: Ref<boolean>; result: ShallowRef<Result | null>; error: Ref<string | null>; run(): Promise<void>; cancel(): void; clear(): void }
/** The only async boundary for review panels: cancellation, timeout and late-result fencing. */
export function useReportDataReview<Options extends ReportDataReviewSource, Result>(host: DataReviewHost<Options>, build: (plan: RenderPlan, options: Options, rows: Awaited<ReturnType<Options["load"]>>) => Result): ReportDataReviewState<Result> {
  const busy = ref(false), result: ShallowRef<Result | null> = shallowRef(null), error = ref<string | null>(null);
  let active: AbortController | undefined, generation = 0;
  function cancel(): void { generation++; active?.abort(); active = undefined; busy.value = false; }
  function clear(): void { cancel(); result.value = null; error.value = null; }
  async function run(): Promise<void> {
    clear();
    const plan = host.plan.value, options = host.options.value;
    if (!plan || !options || host.blocked()) return;
    const own = ++generation, controller = new AbortController(); active = controller; busy.value = true;
    const current = () => own === generation && host.plan.value === plan && host.options.value === options;
    try {
      const rows = await loadBounded(options, controller);
      if (!current() || controller.signal.aborted || host.blocked()) return;
      result.value = build(plan, options, rows);
    } catch (cause) {
      if (!current() || cause instanceof Error && cause.name === "AbortError") return;
      error.value = cause instanceof Error ? cause.message : "Report data review failed";
      host.onError?.(error.value, cause);
    } finally { if (own === generation) { active = undefined; busy.value = false; } }
  }
  // Published plans are immutable replacements; deep traversal would scan every cell twice even with both tools disabled.
  watch(host.plan, clear, { flush: "sync" });
  watch(host.options, clear, { deep: true, flush: "sync" });
  onScopeDispose(clear);
  return { busy, result, error, run, cancel, clear };
}
