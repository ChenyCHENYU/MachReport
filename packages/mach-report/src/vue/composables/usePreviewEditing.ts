import { onMounted, onUnmounted, type Ref } from "vue";
import { ReportCellEditError, type RenderPlan, type ReportCellEdit } from "@agile-team/mach-report";
import type { ReportEditingOptions } from "../editing";
import type { MachReportMessages } from "../config";
import type { ReportBeforeDiscard, ReportDiscardReason } from "../guards";
import { useCellEditing } from "./useCellEditing";
import { useCellSelection } from "./useCellSelection";
import { useDiscardGuard } from "./useDiscardGuard";

/** The editor, selection and discard decision share one transaction boundary. */
export function usePreviewEditing(host: {
  plan: Ref<RenderPlan | null>;
  root: Ref<HTMLElement | null>;
  options: Readonly<Ref<boolean | ReportEditingOptions>>;
  selectionEnabled(): boolean;
  busy(): boolean;
  messages(): MachReportMessages;
  guard: { enabled(): boolean; reportIds(): readonly string[]; hook(): ReportBeforeDiscard | undefined; error(cause: unknown): void };
  gotoPage(page: number): void;
  changed(edit: ReportCellEdit): void;
  failed(message: string, cause: unknown): void;
}): { editing: ReturnType<typeof useCellEditing>; cells: ReturnType<typeof useCellSelection>; discard: ReturnType<typeof useDiscardGuard>; confirmDiscard(reason?: ReportDiscardReason): Promise<boolean> } {
  function errorMessage(cause: unknown): string {
    if (!(cause instanceof ReportCellEditError)) return cause instanceof Error ? cause.message : "单元格保存失败";
    const m = host.messages();
    const messages: Record<string, string | undefined> = {
      number: m.editInvalidNumber, boolean: m.editInvalidBoolean, conflict: m.editConflict,
      atomic: m.editAtomicRequired, limit: m.clipboardLimit, readonly: m.editReadOnly,
      missing: m.editMissing, recalculation: m.editRecalculationUnavailable,
      duplicate: m.editDuplicate, clipboard: m.clipboardInvalid
    };
    return messages[cause.code] ?? cause.message;
  }
  const editing = useCellEditing({
    plan: host.plan, options: host.options,
    blocked: () => host.busy() || discard.pending.value,
    label: () => host.messages().editCell ?? "编辑单元格", errorMessage,
    suspendBlur: () => discard.request.value !== null,
    onChange: host.changed, onError: host.failed,
    onNavigate: (address, key, backwards) => cells.navigate(address, key, backwards)
  });
  const cells = useCellSelection({
    plan: host.plan, root: host.root, enabled: host.selectionEnabled, editable: () => !!host.options.value,
    busy: () => host.busy() || editing.saving.value || discard.pending.value,
    differences: () => editing.differences.value,
    gotoPage: host.gotoPage, edit: editing.editCell, apply: editing.apply, undo: editing.undo, redo: editing.redo,
    error: cause => host.failed(errorMessage(cause), cause)
  });
  const discard = useDiscardGuard({
    ...host.guard, pending: () => editing.pendingLocalChanges.value,
    snapshot: () => [host.plan.value, editing.active.value?.editor.input.value]
  });
  function confirmDiscard(reason: ReportDiscardReason = "leave"): Promise<boolean> { return discard.check(reason); }
  function beforeUnload(event: BeforeUnloadEvent): void {
    if (!host.guard.enabled() || !editing.pendingLocalChanges.value) return;
    event.preventDefault(); event.returnValue = "";
  }
  onMounted(() => window.addEventListener("beforeunload", beforeUnload));
  onUnmounted(() => { window.removeEventListener("beforeunload", beforeUnload); discard.cancel(); editing.reset(); });
  return { editing, cells, discard, confirmDiscard };
}
