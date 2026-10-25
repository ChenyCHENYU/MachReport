import { computed, onScopeDispose, ref, watch, type Ref, type ComputedRef } from "vue";
import type { RenderPlan } from "../../schema/render-plan";
import type { ReportCellContext } from "../../editing/context";
import type { ReportCellInput } from "../../editing/batch";
import { createReportPrefill, reportPrefillInputs, type ReportPrefillPreview } from "../../editing/prefill";
import type { ReportPrefillReviewOptions } from "../data-review";
import { resolveReportReviewScope } from "../report-data-scope";
import { useReportDataReview, type ReportDataReviewState } from "./useReportDataReview";

export interface ReportPrefillHost {
  plan: Ref<RenderPlan | null>;
  options: Readonly<Ref<ReportPrefillReviewOptions | false | undefined>>;
  blocked(): boolean;
  canEdit?(context: ReportCellContext): boolean;
  applyBlocked?(): string | undefined;
  failure?(): string | null | undefined;
  /** Pass the existing useEditHistory.apply; it owns validation, atomic save and undo. */
  apply(inputs: readonly ReportCellInput[]): Promise<boolean>;
  onError?(message: string, cause: unknown): void;
}
export interface ReportPrefillState extends ReportDataReviewState<ReportPrefillPreview> {
  applying: Ref<boolean>;
  blockedReason: ComputedRef<string | undefined>;
  canApply: ComputedRef<boolean>;
  apply(): Promise<boolean>;
}
export function useReportPrefill(host: ReportPrefillHost): ReportPrefillState {
  const review = useReportDataReview(host, (plan, options, rows) => createReportPrefill(plan, { ...options, sourceScope: resolveReportReviewScope(plan, options), rows, canEdit: host.canEdit }));
  const applying = ref(false);
  let generation = 0;
  function resetApplying(): void { generation++; applying.value = false; }
  function cancel(): void { resetApplying(); review.cancel(); }
  function clear(): void { resetApplying(); review.clear(); }
  function run(): Promise<void> { resetApplying(); return review.run(); }
  // Reset UI ownership only. The existing edit transaction still fences old persistence.
  watch(host.plan, resetApplying, { flush: "sync" });
  watch(host.options, resetApplying, { deep: true, flush: "sync" });
  watch(review.result, resetApplying, { flush: "sync" });
  onScopeDispose(resetApplying);
  const blockedReason = computed(() => host.applyBlocked?.());
  const canApply = computed(() => !blockedReason.value && !!host.options.value && !host.blocked() && !review.busy.value && !applying.value && !!review.result.value?.edits.length && review.result.value.counts.conflict === 0);
  async function apply(): Promise<boolean> {
    const plan = host.plan.value, preview = review.result.value;
    if (!plan || !preview || !canApply.value) return false;
    const own = ++generation;
    applying.value = true;
    const current = () => generation === own;
    try {
      const success = await host.apply(reportPrefillInputs(plan, preview, host.canEdit));
      // A successful publication replaces the plan and resets ownership synchronously.
      // Return its actual outcome while leaving any newer review or error untouched.
      if (!current()) return success;
      if (success) clear();
      else review.error.value = host.failure?.() ?? "Report prefill was not applied";
      return success;
    } catch (cause) {
      if (!current()) return false;
      review.error.value = cause instanceof Error ? cause.message : "Report prefill failed";
      host.onError?.(review.error.value, cause); return false;
    } finally { if (current()) applying.value = false; }
  }
  return { ...review, run, cancel, clear, applying, blockedReason, canApply, apply };
}
