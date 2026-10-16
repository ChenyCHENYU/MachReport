import { computed, shallowRef, type Ref } from "vue";
import {
  applyReportCellEditBatch, applyReportEditResult, createReportCellEditBatch,
  createReportCellResolver, ReportCellEditError, summarizeReportCellEdits,
  type RenderPlan, type ReportCellEdit, type ReportCellInput, type ReportEditBatch,
  type ReportEditConflict, type ReportEditResult
} from "@agile-team/mach-report";
import type { ReportEditOperation, ReportEditingOptions } from "../editing";
import { cloneReportSnapshot } from "../snapshot";

export interface EditHistoryHost {
  plan: Ref<RenderPlan | null>;
  options: Readonly<Ref<boolean | ReportEditingOptions>>;
  blocked(): boolean;
  onChange(edit: ReportCellEdit): void;
  onError(message: string, cause: unknown): void;
  errorMessage?(cause: unknown): string;
}
export class ReportEditConflictError extends Error {
  constructor(public readonly conflicts: readonly ReportEditConflict[]) { super(conflicts.map((item) => item.message).join("；")); this.name = "ReportEditConflictError"; }
}

function newRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `mr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Shared transaction path for single edits, paste, undo, redo and restore. */
export function useEditHistory(host: EditHistoryHost) {
  const changes = shallowRef<ReportCellEdit[]>([]);
  const undoStack = shallowRef<ReportCellEdit[][]>([]);
  const redoStack = shallowRef<ReportCellEdit[][]>([]);
  const conflicts = shallowRef<readonly ReportEditConflict[]>([]);
  const saving = shallowRef(false);
  const differences = computed(() => summarizeReportCellEdits(changes.value));
  const canUndo = computed(() => !!host.options.value && !saving.value && !host.blocked() && undoStack.value.length > 0);
  const canRedo = computed(() => !!host.options.value && !saving.value && !host.blocked() && redoStack.value.length > 0);
  let controller: AbortController | null = null;
  let pending: Promise<boolean> | null = null;
  let generation = 0;
  let retry: { plan: RenderPlan; signature: string; requestId: string } | null = null;

  function cancel(): void { controller?.abort(); controller = null; saving.value = false; pending = null; }
  function reset(): void { generation++; cancel(); retry = null; changes.value = []; undoStack.value = []; redoStack.value = []; conflicts.value = []; }
  function options(): ReportEditingOptions | null {
    const option = host.options.value;
    return option ? typeof option === "object" ? option : {} : null;
  }
  function allowed(plan: RenderPlan, batch: ReportEditBatch, option: ReportEditingOptions): void {
    if (!host.options.value || host.blocked()) throw new ReportCellEditError("readonly");
    const resolve = createReportCellResolver(plan);
    for (const edit of batch.edits) {
      const context = resolve(edit.address);
      if (!context?.editable || option.canEdit?.(context) === false) throw new ReportCellEditError("readonly");
      if (option.requireSource && !context.source) throw new ReportCellEditError("missing");
    }
  }
  async function persist(batch: ReportEditBatch, option: ReportEditingOptions, operation: ReportEditOperation): Promise<void | ReportEditResult> {
    if (option.saveBatch) return option.saveBatch(cloneReportSnapshot(batch), operation);
    if (option.save && batch.edits.length > 1) throw new ReportCellEditError("atomic");
    if (batch.edits[0]) return option.save?.(cloneReportSnapshot(batch.edits[0]), operation);
  }
  async function validate(batch: ReportEditBatch, option: ReportEditingOptions, operation: ReportEditOperation): Promise<void> {
    for (const edit of batch.edits) {
      const message = await option.validate?.(cloneReportSnapshot(edit), operation);
      if (message) throw new Error(message);
      if (operation.signal.aborted) return;
    }
  }
  function publish(plan: RenderPlan, batch: ReportEditBatch, result: void | ReportEditResult, action: NonNullable<ReportEditOperation["action"]>): void {
    host.plan.value = applyReportEditResult(applyReportCellEditBatch(plan, batch), batch, result);
    changes.value = [...changes.value, ...batch.edits];
    if (action === "edit") { undoStack.value = [...undoStack.value, batch.edits]; redoStack.value = []; }
    conflicts.value = [];
    retry = null;
    const currentGeneration = generation;
    for (const edit of batch.edits) {
      if (generation !== currentGeneration) break;
      host.onChange(cloneReportSnapshot(edit));
    }
  }
  async function execute(inputs: readonly ReportCellInput[], action: NonNullable<ReportEditOperation["action"]>): Promise<boolean> {
    const plan = host.plan.value;
    const option = options();
    if (!plan || !option || host.blocked()) return false;
    const current = new AbortController();
    const currentGeneration = generation;
    controller = current;
    saving.value = true;
    const isCurrent = () => controller === current && !current.signal.aborted && host.plan.value === plan && host.options.value !== false;
    try {
      const batch = createReportCellEditBatch(plan, inputs, newRequestId());
      batch.edits = batch.edits.filter((edit) => !Object.is(edit.previousValue, edit.value));
      if (!batch.edits.length) return true;
      const signature = JSON.stringify([action, batch.edits]);
      if (retry?.plan === plan && retry.signature === signature) batch.requestId = retry.requestId;
      else retry = { plan, signature, requestId: batch.requestId };
      allowed(plan, batch, option);
      const operation: ReportEditOperation = { signal: current.signal, requestId: batch.requestId, action };
      await validate(batch, option, operation);
      if (!isCurrent()) return false;
      allowed(plan, batch, option);
      const result = await persist(batch, option, operation);
      if (!isCurrent()) return false;
      if (result?.conflicts?.length) { conflicts.value = cloneReportSnapshot(result.conflicts); throw new ReportEditConflictError(result.conflicts); }
      allowed(plan, batch, option);
      publish(plan, batch, result, action);
      return currentGeneration === generation;
    } catch (cause) {
      if (!isCurrent()) return false;
      host.onError(host.errorMessage?.(cause) ?? (cause instanceof Error ? cause.message : "Cell edit failed"), cause);
      return false;
    } finally { if (controller === current) { controller = null; saving.value = false; } }
  }
  async function apply(inputs: readonly ReportCellInput[], action: NonNullable<ReportEditOperation["action"]> = "edit"): Promise<boolean> {
    if (pending) return pending;
    const task = execute(inputs, action);
    pending = task;
    const success = await task;
    if (pending === task) pending = null;
    return success;
  }
  async function undo(): Promise<boolean> {
    const currentGeneration = generation;
    const last = undoStack.value[undoStack.value.length - 1];
    if (!last || saving.value) return false;
    if (!await apply(last.map((edit) => ({ address: edit.address, value: edit.previousValue })), "undo")) return false;
    if (currentGeneration !== generation) return false;
    undoStack.value = undoStack.value.slice(0, -1); redoStack.value = [...redoStack.value, last];
    return true;
  }
  async function redo(): Promise<boolean> {
    const currentGeneration = generation;
    const last = redoStack.value[redoStack.value.length - 1];
    if (!last || saving.value) return false;
    if (!await apply(last.map((edit) => ({ address: edit.address, value: edit.value })), "redo")) return false;
    if (currentGeneration !== generation) return false;
    redoStack.value = redoStack.value.slice(0, -1); undoStack.value = [...undoStack.value, last];
    return true;
  }
  async function restore(): Promise<boolean> {
    const currentGeneration = generation;
    if (!differences.value.length || saving.value) return false;
    if (!await apply(differences.value.map((edit) => ({ address: edit.address, value: edit.previousValue })), "restore")) return false;
    if (currentGeneration !== generation) return false;
    undoStack.value = []; redoStack.value = [];
    return true;
  }
  return { changes, differences, conflicts, saving, canUndo, canRedo, apply, undo, redo, restore, cancel, reset };
}
