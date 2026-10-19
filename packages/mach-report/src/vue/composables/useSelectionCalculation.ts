import { onScopeDispose, ref, shallowRef, watch, type Ref } from "vue";
import { calculateReportSelection, ReportCalculationError, type RenderPlan, type ReportCalculationErrorCode, type ReportCalculationOperation, type ReportCalculationSelection, type ReportSelectionCalculationResult } from "@agile-team/mach-report";

export interface ReportCalculationMessages {
  calculationTitle: string;
  calculationLocal: string;
  calculationHint: string;
  calculationFormula: string;
  calculationExpression: string;
  calculationExpressionHint: string;
  calculationPrecision: string;
  calculationRun: string;
  calculationCancel: string;
  calculationResult: string;
  calculationIncluded: string;
  calculationExcluded: string;
  calculationEmpty: string;
  calculationNoSelection: string;
  calculationSum: string;
  calculationAverage: string;
  calculationMin: string;
  calculationMax: string;
  calculationCount: string;
  calculationMedian: string;
  calculationCustom: string;
  calculationErrorSelection: string;
  calculationErrorLimit: string;
  calculationErrorExpression: string;
  calculationErrorDivision: string;
  calculationErrorOverflow: string;
  calculationErrorPrecision: string;
}
interface CalculationHost {
  plan: Ref<RenderPlan | null>;
  selection: Ref<ReportCalculationSelection | null>;
  enabled(): boolean;
}
/** Selection changes invalidate results; computation starts only after explicit user action. */
export function useSelectionCalculation(host: CalculationHost) {
  const operation = ref<ReportCalculationOperation>("sum");
  const expression = ref("SUM / COUNT");
  const precision = ref(2);
  const busy = ref(false);
  const result = shallowRef<ReportSelectionCalculationResult | null>(null);
  const error = ref<ReportCalculationErrorCode | null>(null);
  let active: AbortController | null = null;
  let generation = 0;
  function cancel(): void {
    generation++; active?.abort(); active = null; busy.value = false;
  }
  function clear(): void { cancel(); result.value = null; error.value = null; }
  async function run(): Promise<void> {
    clear();
    if (!host.enabled()) return;
    const plan = host.plan.value, selection = host.selection.value;
    if (!plan || !selection) { error.value = "selection"; return; }
    const own = ++generation, controller = new AbortController();
    active = controller; busy.value = true;
    try {
      const next = await calculateReportSelection(plan, selection, { operation: operation.value, expression: expression.value, precision: precision.value, signal: controller.signal });
      if (own === generation && host.plan.value === plan && host.selection.value === selection && host.enabled()) result.value = next;
    } catch (cause) {
      if (own === generation && !controller.signal.aborted) error.value = cause instanceof ReportCalculationError ? cause.code : "expression";
    } finally {
      if (own === generation) { busy.value = false; active = null; }
    }
  }
  watch([host.plan, host.selection, () => host.enabled(), operation, expression, precision], clear, { flush: "sync" });
  onScopeDispose(clear);
  function setOperation(value: ReportCalculationOperation): void { operation.value = value; }
  function setExpression(value: string): void { expression.value = value; }
  function setPrecision(value: number): void { precision.value = value; }
  return { operation, expression, precision, busy, result, error, run, cancel, clear, setOperation, setExpression, setPrecision };
}
export type ReportSelectionCalculationState = ReturnType<typeof useSelectionCalculation>;
