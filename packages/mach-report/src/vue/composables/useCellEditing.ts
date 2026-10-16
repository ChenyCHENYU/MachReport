import { computed, onScopeDispose, shallowRef, watch, type Ref } from "vue";
import {
  getReportCellContext, validateReportCellFieldDefinition,
  type RenderPlan, type ReportCellAddress, type ReportCellEdit
} from "@agile-team/mach-report";
import type { ReportEditingOptions } from "../editing";
import { cloneReportSnapshot } from "../snapshot";
import { useEditHistory } from "./useEditHistory";
import { resolveCellField } from "../cell-field";
import { createCellEditor, type CellEditor } from "../cell-editor";

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
    if (!session) return true;
    if (!isCurrent(session)) { cancel(); return false; }
    inputChanged.value = session.editor.input.value !== session.editor.initialInput;
    session.editor.input.disabled = true;
    const task = save(session);
    pending = task;
    const result = await task;
    if (pending === task) pending = null;
    return result;
  }

  function onEditorKey(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.isComposing) return;
    if (event.key === "Escape") { event.preventDefault(); cancel(); }
    if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
      event.preventDefault();
      const address = active.value?.address;
      void commit().then((success) => { if (success && address) host.onNavigate?.(address, event.key as "Enter" | "Tab", event.shiftKey); });
    }
  }

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
      host.onError(cause instanceof Error ? cause.message : "无法编辑单元格", cause);
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
    ...history, active, saving, changes, pendingLocalChanges, cancel, reset, commit, onDoubleClick, editCell,
    getChanges: (): ReportCellEdit[] => cloneReportSnapshot(changes.value)
  };
}
