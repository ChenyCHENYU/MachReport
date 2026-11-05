import { onScopeDispose, ref, shallowRef, watch, type Ref } from "vue";
import {
  calculateReportSelection,
  ReportCalculationError,
  type RenderPlan,
  type ReportCalculationErrorCode,
  type ReportCalculationSelection,
  type ReportSelectionCalculationResult,
} from "@agile-team/mach-report";

interface SummaryHost {
  plan: Ref<RenderPlan | null>;
  selection: Ref<ReportCalculationSelection | null>;
  enabled(): boolean;
}
function differentColumns(
  plan: RenderPlan | null,
  selection: ReportCalculationSelection,
): boolean {
  const { anchor, focus } = selection;
  const first =
    plan?.pages[anchor.pageIndex]?.components[anchor.componentIndex]?.table;
  const last =
    plan?.pages[focus.pageIndex]?.components[focus.componentIndex]?.table;
  if (first && last && first.id === last.id)
    return (
      first.columnKeys[anchor.columnIndex] !==
      last.columnKeys[focus.columnIndex]
    );
  return anchor.columnIndex !== focus.columnIndex;
}
/** One bounded aggregate pass after selection settles; pointer/key movement only cancels the scheduled pass. */
export function useSelectionSummary(host: SummaryHost) {
  const result = shallowRef<ReportSelectionCalculationResult | null>(null),
    error = ref<ReportCalculationErrorCode | null>(null),
    busy = ref(false);
  const requiresConfirmation = ref(false);
  let timer: ReturnType<typeof setTimeout> | undefined,
    active: AbortController | undefined,
    generation = 0;
  function clear(): void {
    generation++;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    active?.abort();
    active = undefined;
    busy.value = false;
    result.value = null;
    error.value = null;
    requiresConfirmation.value = false;
  }
  async function compute(): Promise<void> {
    const plan = host.plan.value,
      selection = host.selection.value,
      own = generation;
    if (!plan || !selection || !host.enabled()) return;
    const controller = new AbortController();
    active = controller;
    busy.value = true;
    try {
      const value = await calculateReportSelection(plan, selection, {
        operation: "sum",
        signal: controller.signal,
      });
      if (own === generation && !controller.signal.aborted)
        result.value = value;
    } catch (cause) {
      if (own === generation && !controller.signal.aborted)
        error.value =
          cause instanceof ReportCalculationError ? cause.code : "expression";
    } finally {
      if (own === generation) {
        busy.value = false;
        active = undefined;
      }
    }
  }
  watch(
    [host.plan, host.selection, () => host.enabled()],
    () => {
      clear();
      if (!host.enabled()) return;
      const selection = host.selection.value;
      if (selection && differentColumns(host.plan.value, selection)) {
        requiresConfirmation.value = true;
        return;
      }
      if (host.plan.value && host.selection.value) {
        busy.value = true;
        timer = setTimeout(() => {
          timer = undefined;
          void compute();
        }, 150);
      }
    },
    { flush: "sync", immediate: true },
  );
  onScopeDispose(clear);
  return { result, error, busy, requiresConfirmation };
}
