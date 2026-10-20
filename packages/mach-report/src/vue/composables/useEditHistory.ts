import { computed, shallowRef, type Ref } from "vue";
import {
  applyReportCellEditBatch, applyReportEditResult, createReportCellEditBatch,
  createReportCellResolver, ReportCellEditError, summarizeReportCellEdits,
  parseReportCellFieldInput, reportCellEditKey,
  type RenderPlan, type ReportCellAddress, type ReportCellContext, type ReportCellEdit, type ReportCellInput, type ReportEditBatch, type ReportPreparedEdit,
  type ReportEditConflict, type ReportEditResult
} from "@agile-team/mach-report";
import type { ReportEditOperation, ReportEditingOptions } from "../editing";
import { cloneReportSnapshot } from "../snapshot";
import { resolveCellField } from "../cell-field";
import { assertRecalculationReady, createEditAddressResolver, prepareCurrentTransaction, prepareHistoryTransaction, type EditTransaction, type HistoryEditTarget } from "./edit-recalculation";

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

function buildTransaction(plan: RenderPlan, target: readonly ReportCellInput[] | HistoryEditTarget, requestId: string, signal: AbortSignal): EditTransaction | Promise<EditTransaction> {
  if (Array.isArray(target)) return { batch: createReportCellEditBatch(plan, target, requestId) };
  return prepareHistoryTransaction(plan, target as HistoryEditTarget, requestId, signal).then((prepared) => Array.isArray(prepared) ? { batch: createReportCellEditBatch(plan, prepared, requestId) } : prepared);
}

/** Shared transaction path for single edits, paste, undo, redo and restore. */
export function useEditHistory(host: EditHistoryHost) {
  const changes = shallowRef<ReportCellEdit[]>([]);
  const undoStack = shallowRef<ReportCellEdit[][]>([]);
  const redoStack = shallowRef<ReportCellEdit[][]>([]);
  const conflicts = shallowRef<readonly ReportEditConflict[]>([]);
  const saving = shallowRef(false);
  const lastError = shallowRef<string | null>(null);
  const localDifferences = shallowRef<ReportCellEdit[]>([]);
  const hasLocalDrafts = computed(() => localDifferences.value.length > 0);
  const differences = computed(() => {
    const items = summarizeReportCellEdits(changes.value), plan = host.plan.value;
    if (!plan || !items.length) return items;
    const resolve = createEditAddressResolver(plan);
    return items.map((edit) => { const address = resolve(edit); return address ? { ...edit, address } : edit; });
  });
  const canUndo = computed(() => !!host.options.value && !saving.value && !host.blocked() && undoStack.value.length > 0);
  const canRedo = computed(() => !!host.options.value && !saving.value && !host.blocked() && redoStack.value.length > 0);
  let controller: AbortController | null = null;
  let pending: Promise<boolean> | null = null;
  let generation = 0;
  let retry: { plan: RenderPlan; signature: string; requestId: string } | null = null;

  function cancel(): void { controller?.abort(); controller = null; saving.value = false; pending = null; }
  function reset(): void { generation++; cancel(); retry = null; changes.value = []; undoStack.value = []; redoStack.value = []; conflicts.value = []; localDifferences.value = []; lastError.value = null; }
  function options(): ReportEditingOptions | null {
    const option = host.options.value;
    return option ? typeof option === "object" ? option : {} : null;
  }
  function allowed(plan: RenderPlan, batch: ReportEditBatch, option: ReportEditingOptions, contexts?: readonly ReportCellContext[]): void {
    if (!host.options.value || host.blocked()) throw new ReportCellEditError("readonly");
    assertRecalculationReady(plan, batch.edits.every((edit) => !!edit.source));
    const resolve = createReportCellResolver(plan), retained = new Map(contexts?.map((context) => [reportCellEditKey(context), context]));
    for (const edit of batch.edits) {
      const context = contexts ? retained.get(reportCellEditKey(edit)) : resolve(edit.address);
      if (!context?.editable || option.canEdit?.(context) === false) throw new ReportCellEditError("readonly");
      if (option.requireSource && !context.source) throw new ReportCellEditError("missing");
      const field = resolveCellField(context, option);
      if (field) parseReportCellFieldInput(context, edit.value, field);
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
  function publish(plan: RenderPlan, batch: ReportEditBatch, result: void | ReportEditResult, action: NonNullable<ReportEditOperation["action"]>, persisted: boolean, prepared?: ReportPreparedEdit): void {
    host.plan.value = prepared ? prepared.commit(result) : applyReportEditResult(applyReportCellEditBatch(plan, batch), batch, result);
    changes.value = [...changes.value, ...batch.edits];
    if (persisted) {
      const committed = new Set(batch.edits.map(reportCellEditKey));
      localDifferences.value = localDifferences.value.filter((edit) => !committed.has(reportCellEditKey(edit)));
    } else localDifferences.value = summarizeReportCellEdits([...localDifferences.value, ...batch.edits]);
    if (action === "edit") { undoStack.value = [...undoStack.value, batch.edits]; redoStack.value = []; }
    conflicts.value = [];
    retry = null;
    const currentGeneration = generation;
    for (const edit of batch.edits) {
      if (generation !== currentGeneration) break;
      host.onChange(cloneReportSnapshot(edit));
    }
  }
  function retainRequestId(plan: RenderPlan, batch: ReportEditBatch, action: NonNullable<ReportEditOperation["action"]>): void {
    const signature = JSON.stringify([action, batch.edits]);
    if (retry?.plan === plan && retry.signature === signature) batch.requestId = retry.requestId;
    else retry = { plan, signature, requestId: batch.requestId };
  }
  function reportFailure(cause: unknown): void {
    lastError.value = host.errorMessage?.(cause) ?? (cause instanceof Error ? cause.message : "Cell edit failed");
    host.onError(lastError.value, cause);
  }
  async function execute(inputs: readonly ReportCellInput[] | HistoryEditTarget, action: NonNullable<ReportEditOperation["action"]>): Promise<boolean> {
    const plan = host.plan.value;
    const option = options();
    if (!plan || !option || host.blocked()) return false;
    const current = new AbortController();
    const currentGeneration = generation;
    controller = current;
    saving.value = true;
    lastError.value = null;
    const isCurrent = () => controller === current && !current.signal.aborted && host.plan.value === plan && host.options.value !== false;
    try {
      const building = buildTransaction(plan, inputs, newRequestId(), current.signal);
      const transaction = building instanceof Promise ? await building : building;
      if (!isCurrent()) return false;
      const { batch, contexts } = transaction;
      allowed(plan, batch, option, contexts);
      batch.edits = batch.edits.filter((edit) => !Object.is(edit.previousValue, edit.value));
      if (!batch.edits.length) return true;
      retainRequestId(plan, batch, action);
      allowed(plan, batch, option, contexts);
      const operation: ReportEditOperation = { signal: current.signal, requestId: batch.requestId, action };
      await validate(batch, option, operation);
      if (!isCurrent()) return false;
      allowed(plan, batch, option, contexts);
      const preparing = transaction.prepared ? undefined : prepareCurrentTransaction(plan, batch, current.signal);
      if (preparing) transaction.prepared = await preparing;
      if (!isCurrent()) return false;
      allowed(plan, batch, option, contexts);
      const result = await persist(batch, option, operation);
      if (!isCurrent()) return false;
      if (result?.conflicts?.length) { conflicts.value = cloneReportSnapshot(result.conflicts); throw new ReportEditConflictError(result.conflicts); }
      allowed(plan, batch, option, contexts);
      publish(plan, batch, result, action, !!(option.save || option.saveBatch), transaction.prepared);
      return currentGeneration === generation;
    } catch (cause) {
      if (!isCurrent()) return false;
      reportFailure(cause);
      return false;
    } finally { if (controller === current) { controller = null; saving.value = false; } }
  }
  async function apply(inputs: readonly ReportCellInput[] | HistoryEditTarget, action: NonNullable<ReportEditOperation["action"]> = "edit"): Promise<boolean> {
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
    if (!await apply({ edits: last, value: "previousValue" }, "undo")) return false;
    if (currentGeneration !== generation) return false;
    undoStack.value = undoStack.value.slice(0, -1); redoStack.value = [...redoStack.value, last];
    return true;
  }
  async function redo(): Promise<boolean> {
    const currentGeneration = generation;
    const last = redoStack.value[redoStack.value.length - 1];
    if (!last || saving.value) return false;
    if (!await apply({ edits: last, value: "value" }, "redo")) return false;
    if (currentGeneration !== generation) return false;
    redoStack.value = redoStack.value.slice(0, -1); undoStack.value = [...undoStack.value, last];
    return true;
  }
  async function restore(): Promise<boolean> {
    const currentGeneration = generation;
    if (!differences.value.length || saving.value) return false;
    if (!await apply({ edits: differences.value, value: "previousValue" }, "restore")) return false;
    if (currentGeneration !== generation) return false;
    undoStack.value = []; redoStack.value = [];
    return true;
  }
  function settle(): boolean | Promise<boolean> {
    if (!pending) return !saving.value;
    const currentGeneration = generation;
    return pending.then((success) => success && currentGeneration === generation && !saving.value);
  }
  function resolveAddress(edit: ReportCellEdit): ReportCellAddress | null {
    return host.plan.value ? createEditAddressResolver(host.plan.value)(edit) : null;
  }
  return { settle, resolveAddress, changes, differences, localDifferences, hasLocalDrafts, lastError, conflicts, saving, canUndo, canRedo, apply, undo, redo, restore, cancel, reset };
}
