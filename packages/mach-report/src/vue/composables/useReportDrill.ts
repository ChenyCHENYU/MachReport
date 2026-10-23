import { computed, onScopeDispose, ref, watch, type Ref } from "vue";
import { createReportDrillRequest, matchReportDrillActions, ReportDrillError } from "../../source/drill";
import type { RenderPlan } from "../../schema/render-plan";
import type { ReportCellSelection } from "./useCellSelection";
import type { ReportDrillOptions } from "../drill";
import type { MachReportMessages } from "../config";
import { waitForOutput } from "../../output/progress";

export function useReportDrill(host: {
  plan: Ref<RenderPlan | null>; selection: Ref<ReportCellSelection | null>;
  options(): ReportDrillOptions | undefined; params(): Record<string, string>;
  view(): { zoom: number; scrollTop: number; scrollLeft: number }; messages(): MachReportMessages;
  busy(): boolean; beforeOpen(): Promise<boolean>;
}) {
  const pending = ref(false), error = ref("");
  let controller: AbortController | undefined;
  const entries = computed(() => {
    const plan = host.plan.value, address = host.selection.value?.focus, options = host.options();
    if (!plan || !address || !options) return [];
    try { return matchReportDrillActions(plan, address, options.actions).map(action => {
      try { createReportDrillRequest(plan, address, action, host.params()); return { action }; }
      catch { return { action, reason: host.messages().drillMissingValue }; }
    }); } catch { return []; }
  });
  function cancel(): void { controller?.abort(); controller = undefined; pending.value = false; error.value = ""; }
  watch([host.plan, () => host.options()], cancel);
  onScopeDispose(cancel);
  async function open(id: string): Promise<void> {
    if (pending.value || host.busy()) return;
    const plan = host.plan.value, address = host.selection.value?.focus, options = host.options();
    const action = options?.actions.find(action => action.id === id);
    if (!plan || !address || !options || !action) return;
    const current = new AbortController(); controller = current; pending.value = true; error.value = "";
    try {
      const request = createReportDrillRequest(plan, address, action, host.params()), view = Object.freeze(host.view());
      if (!await host.beforeOpen() || current.signal.aborted || host.plan.value !== plan) return;
      await waitForOutput(options.open({ ...request, signal: current.signal, view }), current.signal);
    } catch (cause) {
      if (!current.signal.aborted) error.value = cause instanceof ReportDrillError ? host.messages().drillMissingValue ?? "" : host.messages().drillFailed ?? "";
    } finally { if (controller === current) { pending.value = false; controller = undefined; } }
  }
  return { entries, pending, error, open };
}
