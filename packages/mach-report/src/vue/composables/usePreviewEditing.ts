import { onMounted, onUnmounted, onScopeDispose, shallowRef, watch, type Ref } from "vue";
import { ReportCellEditError, ReportValidationError, type RenderPlan, type ReportCellEdit, type ReportCellAddress } from "@agile-team/mach-report";
import type { ReportEditingOptions, ReportEditQueryContext } from "../editing";
import type { MachReportMessages } from "../config";
import type { ReportBeforeDiscard, ReportDiscardReason } from "../guards";
import { useCellEditing } from "./useCellEditing";
import { useCellSelection } from "./useCellSelection";
import { useDiscardGuard } from "./useDiscardGuard";
import { useCellEditingStatus } from "./useCellEditingStatus";
import { createSelectionIndex } from "./selection-index";

/** The editor, selection and discard decision share one transaction boundary. */
export function usePreviewEditing(host: {
  plan: Ref<RenderPlan | null>;
  root: Ref<HTMLElement | null>;
  options: Readonly<Ref<boolean | ReportEditingOptions>>;
  query?(): Readonly<ReportEditQueryContext> | null;
  selectionEnabled(): boolean;
  busy(): boolean;
  messages(): MachReportMessages;
  guard: { enabled(): boolean; reportIds(): readonly string[]; hook(): ReportBeforeDiscard | undefined; error(cause: unknown): void };
  gotoPage(page: number): void;
  ensureVisible?(address: ReportCellAddress): void;
  changed(edit: ReportCellEdit): void;
  failed(message: string, cause: unknown): void;
}): { editing: ReturnType<typeof useCellEditing>; cells: ReturnType<typeof useCellSelection>; cellStatus: ReturnType<typeof useCellEditingStatus>; discard: ReturnType<typeof useDiscardGuard>; confirmDiscard(reason?: ReportDiscardReason): Promise<boolean> } {
  const attempted = shallowRef<ReportCellAddress | null>(null);
  let indexedPlan: RenderPlan | null = null, publication: ReturnType<typeof createSelectionIndex> | undefined;
  function publicationIndex(plan: RenderPlan): ReturnType<typeof createSelectionIndex> {
    if (indexedPlan !== plan || !publication) { indexedPlan = plan; publication = createSelectionIndex(plan); }
    return publication;
  }
  function errorMessage(cause: unknown): string {
    if (cause instanceof ReportValidationError && cause.issues.length > 1) return (host.messages().validationFailureSummary ?? "发现 {count} 项校验问题，请在数据校验中核对。").replace("{count}", String(cause.issues.length));
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
    query: host.query,
    addressResolver: plan => publicationIndex(plan).addressResolver(),
    resolveCell: (plan, address) => publicationIndex(plan).cellAt(address),
    blocked: () => host.busy() || discard.pending.value,
    label: () => host.messages().editCell ?? "编辑单元格", errorMessage,
    suspendBlur: () => discard.request.value !== null,
    onChange: host.changed, onError: host.failed,
    onInspect: address => { attempted.value = address; },
    onNavigate: (address, key, backwards) => cells.navigate(address, key, backwards)
  });
  const cells = useCellSelection({
    plan: host.plan, root: host.root, enabled: host.selectionEnabled, editable: () => !!host.options.value,
    publicationIndex,
    busy: () => host.busy() || editing.saving.value || discard.pending.value,
    differences: () => editing.differences.value,
    gotoPage: host.gotoPage, ensureVisible: host.ensureVisible, edit: editing.editCell, apply: editing.apply, undo: editing.undo, redo: editing.redo,
    error: cause => host.failed(errorMessage(cause), cause)
  });
  const discard = useDiscardGuard({
    ...host.guard, pending: () => editing.pendingLocalChanges.value,
    snapshot: () => [host.plan.value, editing.active.value?.editor.input.value]
  });
  const cellStatus = useCellEditingStatus({ ...host, selection: cells.selection, attempted, resolveCell: (plan, address) => publicationIndex(plan).cellAt(address), busy: () => host.busy() || editing.saving.value || discard.pending.value });
  watch(host.plan, next => { if (indexedPlan !== next) { indexedPlan = null; publication = undefined; } }, { flush: "sync" });
  onScopeDispose(() => { indexedPlan = null; publication = undefined; });
  function confirmDiscard(reason: ReportDiscardReason = "leave"): Promise<boolean> { return discard.check(reason); }
  function beforeUnload(event: BeforeUnloadEvent): void {
    if (!host.guard.enabled() || !editing.pendingLocalChanges.value) return;
    event.preventDefault(); event.returnValue = "";
  }
  onMounted(() => window.addEventListener("beforeunload", beforeUnload));
  onUnmounted(() => { window.removeEventListener("beforeunload", beforeUnload); discard.cancel(); editing.reset(); });
  return { editing, cells, cellStatus, discard, confirmDiscard };
}
