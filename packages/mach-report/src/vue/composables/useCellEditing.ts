import { computed, onScopeDispose, shallowRef, watch, type Ref } from "vue";
import {
  createReportCellEditBatch, getReportCellContext, ReportCellEditError, validateReportCellFieldDefinition,
  type RenderPlan, type ReportCellAddress, type ReportCellEdit
} from "@agile-team/mach-report";
import type { ReportEditingOptions } from "../editing";
import { cloneReportSnapshot } from "../snapshot";
import { useEditHistory } from "./useEditHistory";
import { resolveCellField } from "../cell-field";
import { createCellEditor, type CellEditor } from "../cell-editor";
import { assertRecalculationReady, createEditAddressResolver } from "./edit-recalculation";

interface EditorSession {
  plan: RenderPlan;
  address: ReportCellAddress;
  editor: CellEditor;
}

interface CellEditingHost {
  plan: Ref<RenderPlan | null>;
  options: Readonly<Ref<boolean | ReportEditingOptions>>;
  blocked(): boolean;
  label(): string;
  /** Opening a discard dialog must not blur-save input behind the dialog. */
  suspendBlur?(): boolean;
  errorMessage?(cause: unknown): string;
  onChange(edit: ReportCellEdit): void;
  onError(message: string, cause: unknown): void;
  onNavigate?(address: ReportCellAddress, key: "Enter" | "Tab", backwards: boolean): void;
}

export function reportCellAddress(cell: HTMLElement): ReportCellAddress | null {
  const holder = cell.closest<HTMLElement>(".mrp-page-holder");
  const component = cell.closest<HTMLElement>("[data-mr-component-index]");
  if (!holder || !component) return null;
  const address = {
    pageIndex: Number(holder.dataset.page) - 1,
    componentIndex: Number(component.dataset.mrComponentIndex),
    rowIndex: Number(cell.dataset.mrRowIndex),
    columnIndex: Number(cell.dataset.mrColumnIndex)
  };
  return Object.values(address).every((value) => Number.isInteger(value) && value >= 0) ? address : null;
}

/** One delegated editor per preview; no watchers or inputs are allocated per cell. */
export function useCellEditing(host: CellEditingHost) {
  const active = shallowRef<EditorSession | null>(null);
  const history = useEditHistory(host);
  const { saving, changes } = history;
  const inputChanged = shallowRef(false);
  const pendingLocalChanges = computed(() => inputChanged.value || history.hasLocalDrafts.value);
  let pending: Promise<boolean> | null = null;

  function cancel(): void {
    const session = active.value;
    active.value = null;
    inputChanged.value = false;
    history.cancel();
    pending = null;
    session?.editor.root.remove();
  }

  function reset(): void {
    cancel();
    history.reset();
  }

  function isCurrent(session: EditorSession): boolean {
    return active.value === session && host.plan.value === session.plan;
  }

  async function save(session: EditorSession): Promise<boolean> {
    const success = await history.apply([{ address: session.address, value: session.editor.value() }]);
    if (success) {
      active.value = null;
      inputChanged.value = false;
      session.editor.root.remove();
      return true;
    }
    if (active.value === session) {
      session.editor.input.disabled = false;
      session.editor.feedback(history.lastError.value ?? undefined);
      session.editor.input.focus();
    }
    return false;
  }

  async function commit(): Promise<boolean> {
    if (pending) return pending;
    const session = active.value;
    if (!session) return history.settle();
    if (!isCurrent(session)) { cancel(); return false; }
    inputChanged.value = session.editor.input.value !== session.editor.initialInput;
    session.editor.input.disabled = true;
    const task = save(session);
    pending = task;
    const result = await task;
    if (pending === task) pending = null;
    return result;
  }

  function settle(): boolean | Promise<boolean> { return active.value || pending ? commit() : history.settle(); }

  function onEditorKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.isComposing) return;
    if (event.key === "Escape") { event.preventDefault(); cancel(); }
    if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
      event.preventDefault();
      const session = active.value;
      const context = session && getReportCellContext(session.plan, session.address);
      const edit = session && context ? createReportCellEditBatch(session.plan, [{ address: session.address, value: context.value }], "navigation").edits[0] : undefined;
      void commit().then((success) => {
        if (!success || !session || !host.plan.value) return;
        const address = host.plan.value === session.plan ? session.address : edit && createEditAddressResolver(host.plan.value)(edit);
        if (address) host.onNavigate?.(address, event.key as "Enter" | "Tab", event.shiftKey);
      });
    }
  }

  function reportFailure(cause: unknown): void { host.onError(host.errorMessage?.(cause) ?? (cause instanceof Error ? cause.message : "无法编辑单元格"), cause); }

  async function editCell(cell: HTMLElement): Promise<void> {
    if (!host.options.value || host.blocked()) return;
    if (!await commit() || !cell.isConnected) return;
    const plan = host.plan.value;
    const address = reportCellAddress(cell);
    if (!plan || !address || !host.options.value || host.blocked()) return;
    const options = typeof host.options.value === "object" ? host.options.value : {};
    try {
      const context = getReportCellContext(plan, address);
      if (!context?.editable || options.canEdit?.(context) === false) return;
      assertRecalculationReady(plan, !!context.source);
      if (options.requireSource && !context.source) throw new ReportCellEditError("missing");
      const field = resolveCellField(context, options);
      if (field) validateReportCellFieldDefinition(context, field);
      const editor = createCellEditor(cell, host.label(), context, field);
      const input = editor.input;
      active.value = { plan, address, editor };
      inputChanged.value = false;
      input.addEventListener("keydown", (event) => onEditorKey(event as KeyboardEvent));
      input.addEventListener("input", () => { inputChanged.value = input.value !== editor.initialInput; editor.feedback(); });
      input.addEventListener("change", () => { inputChanged.value = input.value !== editor.initialInput; });
      input.addEventListener("blur", () => { if (!saving.value && !host.suspendBlur?.()) void commit(); });
      editor.focus();
    } catch (cause) {
      reportFailure(cause);
    }
  }

  async function onDoubleClick(event: MouseEvent): Promise<void> {
    const target = event.target;
    if (!(target instanceof Element) || target.closest(".mrp-cell-editor")) return;
    const cell = target.closest<HTMLElement>("td[data-mr-row-index]");
    if (cell) await editCell(cell);
  }

  watch(host.options, (option, previous) => { if (!option || option !== previous) cancel(); }, { flush: "sync" });
  watch(host.plan, () => {
    if (active.value && host.plan.value !== active.value.plan) {
      active.value.editor.root.remove();
      active.value = null;
      inputChanged.value = false;
    }
  }, { flush: "sync" });
  onScopeDispose(reset);
  return {
    ...history, active, saving, changes, pendingLocalChanges, cancel, reset, commit, settle, onDoubleClick, editCell,
    getChanges: (): ReportCellEdit[] => cloneReportSnapshot(changes.value)
  };
}
