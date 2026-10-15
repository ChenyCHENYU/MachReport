import { onScopeDispose, ref, shallowRef, watch, type Ref } from "vue";
import {
  applyReportCellEdit, createReportCellEdit, getReportCellContext,
  ReportCellEditError, type RenderPlan, type ReportCellAddress, type ReportCellEdit
} from "@agile-team/mach-report";
import type { ReportEditingOptions } from "../editing";

interface EditorSession {
  plan: RenderPlan;
  address: ReportCellAddress;
  input: HTMLTextAreaElement;
  controller: AbortController;
  options: ReportEditingOptions;
}

interface CellEditingHost {
  plan: Ref<RenderPlan | null>;
  options: Readonly<Ref<boolean | ReportEditingOptions>>;
  blocked(): boolean;
  label(): string;
  errorMessage?(cause: unknown): string;
  onChange(edit: ReportCellEdit): void;
  onError(message: string, cause: unknown): void;
}

function cellAddress(cell: HTMLElement): ReportCellAddress | null {
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
  const saving = ref(false);
  const changes = shallowRef<ReportCellEdit[]>([]);
  let pending: Promise<boolean> | null = null;

  function cancel(): void {
    const session = active.value;
    active.value = null;
    saving.value = false;
    pending = null;
    session?.controller.abort();
    session?.input.remove();
  }

  function reset(): void {
    cancel();
    changes.value = [];
  }

  function isCurrent(session: EditorSession): boolean {
    return active.value === session && !session.controller.signal.aborted && host.plan.value === session.plan;
  }

  function assertPermission(session: EditorSession): void {
    const option = host.options.value;
    const context = getReportCellContext(session.plan, session.address);
    const sameOptions = typeof option === "object" ? option === session.options : option === true;
    if (!sameOptions || !context?.editable || session.options.canEdit?.(context) === false) {
      throw new ReportCellEditError("readonly");
    }
  }

  async function save(session: EditorSession): Promise<boolean> {
    try {
      assertPermission(session);
      const edit = createReportCellEdit(session.plan, session.address, session.input.value);
      if (Object.is(edit.value, edit.previousValue)) {
        cancel();
        return true;
      }
      const operation = { signal: session.controller.signal };
      const message = await session.options.validate?.(structuredClone(edit), operation);
      if (!isCurrent(session)) return false;
      if (message) throw new Error(message);
      assertPermission(session);
      await session.options.save?.(structuredClone(edit), operation);
      if (!isCurrent(session)) return false;
      assertPermission(session);
      const next = applyReportCellEdit(session.plan, edit);
      cancel();
      changes.value = [...changes.value, edit];
      host.plan.value = next;
      host.onChange(structuredClone(edit));
      return true;
    } catch (cause) {
      if (!isCurrent(session)) return false;
      host.onError(host.errorMessage?.(cause) ?? (cause instanceof Error ? cause.message : "单元格保存失败"), cause);
      session.input.disabled = false;
      session.input.setAttribute("aria-invalid", "true");
      session.input.focus();
      return false;
    } finally {
      if (active.value === session) saving.value = false;
    }
  }

  async function commit(): Promise<boolean> {
    if (pending) return pending;
    const session = active.value;
    if (!session) return true;
    if (!isCurrent(session)) { cancel(); return false; }
    saving.value = true;
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
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void commit(); }
  }

  async function onDoubleClick(event: MouseEvent): Promise<void> {
    if (!host.options.value || host.blocked()) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest(".mrp-cell-editor")) return;
    const cell = target.closest<HTMLElement>("td[data-mr-row-index]");
    if (!cell || !await commit() || !cell.isConnected) return;
    const plan = host.plan.value;
    const address = cellAddress(cell);
    if (!plan || !address || !host.options.value || host.blocked()) return;
    const options = typeof host.options.value === "object" ? host.options.value : {};
    try {
      const context = getReportCellContext(plan, address);
      if (!context?.editable || options.canEdit?.(context) === false) return;
      const input = makeEditor(cell, host.label(), context.value);
      active.value = { plan, address, input, controller: new AbortController(), options };
      input.addEventListener("keydown", onEditorKey);
      input.addEventListener("blur", () => { if (!saving.value) void commit(); });
      input.focus();
      input.select();
    } catch (cause) {
      host.onError(cause instanceof Error ? cause.message : "无法编辑单元格", cause);
    }
  }

  watch(host.options, (option, previous) => { if (!option || option !== previous) cancel(); }, { flush: "sync" });
  watch(host.plan, () => {
    if (active.value && host.plan.value !== active.value.plan) cancel();
  }, { flush: "sync" });
  onScopeDispose(reset);
  return {
    active, saving, changes, cancel, reset, commit, onDoubleClick,
    getChanges: (): ReportCellEdit[] => structuredClone(changes.value)
  };
}
