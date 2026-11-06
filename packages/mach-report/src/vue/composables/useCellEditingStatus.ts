import { computed, watch, type Ref } from "vue";
import { createReportCellResolver, getReportEditSession, type RenderPlan, type ReportCellAddress, type ReportCellContext } from "@agile-team/mach-report";
import type { MachReportMessages } from "../config";
import type { ReportEditingOptions } from "../editing";
import type { ReportCellSelection } from "./useCellSelection";

export function useCellEditingStatus(host: {
  plan: Ref<RenderPlan | null>;
  options: Readonly<Ref<boolean | ReportEditingOptions>>;
  selection: Ref<ReportCellSelection | null>;
  attempted: Ref<ReportCellAddress | null>;
  busy(): boolean;
  messages(): MachReportMessages;
}) {
  const resolver = computed(() => host.plan.value ? createReportCellResolver(host.plan.value) : null);
  watch([host.plan, host.options, host.selection], () => { host.attempted.value = null; }, { flush: "sync" });
  function reason(context: ReportCellContext, options: ReportEditingOptions, m: MachReportMessages): string | null {
    const fallback = m.editReadOnly ?? "";
    if (context.cell.formula !== undefined) return m.editCellFormula ?? fallback;
    if (!context.editable) {
      const labels = { cell: m.editCellProtected, formula: m.editCellFormula, complex: m.editCellComplex, structure: m.editCellStructure, derived: m.editCellDerived };
      return labels[context.readOnlyReason ?? "cell"] ?? fallback;
    }
    if (options.canEdit?.(context) === false) return options.readOnlyReason?.(context) || m.editCellPermission || fallback;
    if (options.requireSource && !context.source) return m.editMissing ?? fallback;
    if (host.plan.value?.requiresRecalculation && (!context.source || !getReportEditSession(host.plan.value))) return m.editRecalculationUnavailable ?? fallback;
    return null;
  }
  return computed(() => {
    if (!host.options.value) return null;
    const address = host.attempted.value ?? host.selection.value?.focus;
    const context = address && resolver.value?.(address);
    if (!context) return null;
    const m = host.messages();
    const options = typeof host.options.value === "object" ? host.options.value : {};
    try {
      const message = host.busy() ? m.editCellBusy ?? m.editReadOnly ?? "" : reason(context, options, m);
      return { editable: message === null, label: message === null ? m.editCellEditable : m.editCellReadOnly, message: message ?? m.editingHint };
    } catch {
      return { editable: false, label: m.editCellReadOnly, message: m.editCellPermission };
    }
  });
}
