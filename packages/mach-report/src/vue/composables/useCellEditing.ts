import { onScopeDispose, shallowRef, watch, type Ref } from "vue";
import {
  getReportCellContext,
  type RenderPlan, type ReportCellAddress, type ReportCellEdit
} from "@agile-team/mach-report";
import type { ReportEditingOptions } from "../editing";
import { cloneReportSnapshot } from "../snapshot";
import { useEditHistory } from "./useEditHistory";

interface EditorSession {
  plan: RenderPlan;
  address: ReportCellAddress;
  input: HTMLTextAreaElement;
}

interface CellEditingHost {
  plan: Ref<RenderPlan | null>;
  options: Readonly<Ref<boolean | ReportEditingOptions>>;
  blocked(): boolean;
  label(): string;
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

function makeEditor(cell: HTMLElement, label: string, value: unknown): HTMLTextAreaElement {
  const input = cell.ownerDocument.createElement("textarea");
  input.className = "mrp-cell-editor";
  input.setAttribute("aria-label", label);
  input.value = value == null ? "" : String(value);
  input.style.cssText = "position:absolute;inset:0;width:100%;height:100%;min-height:20px;box-sizing:border-box;z-index:10;resize:none;margin:0;padding:2px 4px;border:2px solid #2563eb;outline:none;background:#fff;color:#111;font:inherit;line-height:1.25;white-space:pre-wrap;";
  cell.appendChild(input);
  return input;
}

/** One delegated editor per preview; no watchers or inputs are allocated per cell. */
export function useCellEditing(host: CellEditingHost) {
  const active = shallowRef<EditorSession | null>(null);
  const history = useEditHistory(host);
  const { saving, changes } = history;
  let pending: Promise<boolean> | null = null;

  function cancel(): void {
    const session = active.value;
    active.value = null;
    history.cancel();
    pending = null;
    session?.input.remove();
  }

  function reset(): void {
    cancel();
    history.reset();
  }

  function isCurrent(session: EditorSession): boolean {
    return active.value === session && host.plan.value === session.plan;
  }

  async function save(session: EditorSession): Promise<boolean> {
    const success = await history.apply([{ address: session.address, value: session.input.value }]);
    if (success) {
      active.value = null;
      session.input.remove();
      return true;
    }
    if (active.value === session) {
      session.input.disabled = false;
      session.input.setAttribute("aria-invalid", "true");
      session.input.focus();
    }
    return false;
  }

  async function commit(): Promise<boolean> {
    if (pending) return pending;
    const session = active.value;
    if (!session) return true;
    if (!isCurrent(session)) { cancel(); return false; }
    session.input.disabled = true;
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
      const input = makeEditor(cell, host.label(), context.value);
      active.value = { plan, address, input };
      input.addEventListener("keydown", onEditorKey);
      input.addEventListener("blur", () => { if (!saving.value) void commit(); });
      input.focus();
      input.select();
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
      active.value.input.remove();
      active.value = null;
    }
  }, { flush: "sync" });
  onScopeDispose(reset);
  return {
    ...history, active, saving, changes, cancel, reset, commit, onDoubleClick, editCell,
    getChanges: (): ReportCellEdit[] => cloneReportSnapshot(changes.value)
  };
}
