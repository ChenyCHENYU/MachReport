import type { FormulaAdapter } from "../processing/computed";
import { validateSessionCandidates } from "./session-validation";
import { assertReportValidation, type ReportCandidateValidationOptions, type ReportValidationIssue } from "./validation";
import type { PaginateOptions, ReportTemplate, DatasetRows } from "../layout/paginate";
import { paginateTemplate } from "../layout/paginate";
import type { RenderPlan } from "../schema/render-plan";
import { createReportCellResolver, type ReportCellContext } from "./context";
import { editFromContext, sourceChanged, type ReportCellEdit } from "./apply";
import { applyReportEditResult, applyReportSourceMetadata } from "./result";
import { reportCellEditKey, type ReportEditBatch, type ReportEditResult } from "./batch";
import { ReportCellEditError, formatReportCellEdit } from "./value";
import { createSessionRowResolver, sessionConcurrencyChanges, sourceDatasetKey, updateSessionRows, type ReportEditSessionPart, type SessionRow } from "./session-data";
import { indexSessionContexts } from "./session-context";
import { captureSessionGuard, snapshotSessionParts } from "./session-snapshot";
import { reflowReportTemplate } from "./session-pagination";

export interface ReportPreparedEdit {
  /** Calculated preview; no source/session state changes until commit succeeds. */
  readonly plan: RenderPlan;
  readonly validationIssues: readonly ReportValidationIssue[];
  /** Validate complete candidate source rows and derived fields before invoking persistence. */
  validate(options: ReportCandidateValidationOptions): readonly ReportValidationIssue[];
  /** Call after persistence. A stale or repeated commit fails instead of publishing mixed state. */
  commit(result?: void | ReportEditResult): RenderPlan;
}
export interface ReportEditPreparationOptions { signal?: AbortSignal; validation?: ReportCandidateValidationOptions }
export interface ReportHistoryPreparation { batch: ReportEditBatch; prepared: ReportPreparedEdit; contexts: readonly ReportCellContext[] }
export interface ReportEditSession {
  readonly plan: RenderPlan;
  prepare(plan: RenderPlan, batch: ReportEditBatch, options?: ReportEditPreparationOptions): Promise<ReportPreparedEdit>;
  prepareHistory(plan: RenderPlan, edits: readonly ReportCellEdit[], value: "previousValue" | "value", requestId: string, options?: ReportEditPreparationOptions): Promise<ReportHistoryPreparation>;
}
export interface ReportEditSessionRegistration {
  parts: readonly ReportEditSessionPart[];
  /** Trusted runtime adapters stay outside the serializable guarded source snapshot. */
  validationFormulas?: readonly (FormulaAdapter | undefined)[];
  rebuild(parts: readonly ReportEditSessionPart[], signal?: AbortSignal): Promise<RenderPlan>;
}
const sessions = new WeakMap<RenderPlan, ReportEditSession>();
export function getReportEditSession(plan: RenderPlan): ReportEditSession | undefined { return sessions.get(plan); }
function active(signal?: AbortSignal): void { if (signal?.aborted) { const error = new Error("报表重算已取消"); error.name = "AbortError"; throw error; } }
function valueOf(row: Record<string, unknown>, field: string): unknown { return row[field] === undefined ? "" : row[field]; }
function normalizedBatch(plan: RenderPlan, batch: ReportEditBatch): { batch: ReportEditBatch; contexts: ReportCellContext[] } {
  if (batch.edits.length > 10_000) throw new ReportCellEditError("limit");
  const resolve = createReportCellResolver(plan), seen = new Set<string>(), contexts: ReportCellContext[] = [];
  const edits = batch.edits.map((edit) => {
    const context = resolve(edit.address);
    if (!context?.source) throw new ReportCellEditError("missing");
    const key = reportCellEditKey(edit);
    if (seen.has(key)) throw new ReportCellEditError("duplicate");
    seen.add(key);
    if (sourceChanged(context, edit) || !Object.is(context.value, edit.previousValue) || (context.cell.text ?? "") !== edit.previousText) throw new ReportCellEditError("conflict");
    contexts.push(context); return editFromContext(context, edit.value);
  });
  return { batch: { requestId: batch.requestId, edits }, contexts };
}
function changesFor(parts: readonly ReportEditSessionPart[], edits: readonly ReportCellEdit[]): Array<{ row: SessionRow; field: string; value: unknown }> {
  const resolve = createSessionRowResolver(parts);
  return edits.flatMap((edit) => {
    if (!edit.source) throw new ReportCellEditError("missing");
    return resolve(edit.source).map((row) => {
      if (!Object.is(valueOf(row.row, edit.source!.field), edit.previousValue)) throw new ReportCellEditError("conflict");
      if (row.binding.rowKey === edit.source!.field) throw new ReportCellEditError("readonly");
      return { row, field: edit.source!.field, value: edit.value };
    });
  });
}
function refreshContext(context: ReportCellContext, value: unknown, result?: void | ReportEditResult): ReportCellContext {
  const next = { ...context, value: value as ReportCellContext["value"], source: { ...context.source!, ...(result?.revision === undefined ? {} : { revision: result.revision }), ...(result?.sourceToken === undefined ? {} : { sourceToken: result.sourceToken }) } };
  next.cell = { ...context.cell, value: next.value, text: formatReportCellEdit(next, next.value) };
  return next;
}
function concurrencyParts(parts: readonly ReportEditSessionPart[], batch: ReportEditBatch, result?: void | ReportEditResult): ReportEditSessionPart[] {
  if (!result || result.revision === undefined && result.sourceToken === undefined) return [...parts];
  const datasets = new Set(batch.edits.flatMap((edit) => edit.source ? [sourceDatasetKey(edit.source)] : []));
  return updateSessionRows(parts, sessionConcurrencyChanges(parts, datasets, result));
}
function rememberConcurrency(metadata: Map<string, ReportEditResult>, batch: ReportEditBatch, result: ReportEditResult): Set<string> {
  const affected = new Set(batch.edits.map(edit => sourceDatasetKey(edit.source!)));
  for (const key of affected) metadata.set(key, { ...metadata.get(key),
    ...(result.revision !== undefined ? { revision: result.revision } : {}),
    ...(result.sourceToken !== undefined ? { sourceToken: result.sourceToken } : {}) });
  return affected;
}

/** Registers a bounded descriptor guard. Immutable strings are retained, never rescanned character by character. */
export function registerReportEditSession(initial: RenderPlan, registration: ReportEditSessionRegistration): ReportEditSession {
  let sourceParts: readonly ReportEditSessionPart[] | undefined = registration.parts;
  const rebuild = registration.rebuild;
  const validationFormulas = [...(registration.validationFormulas ?? [])];
  let initialGuard: (() => boolean) | undefined = captureSessionGuard(sourceParts);
  let current = initial, parts: ReportEditSessionPart[] | undefined;
  const retainedContexts = new Map<string, ReportCellContext>();
  const concurrency = new Map<string, ReportEditResult>();
  function baseline(plan: RenderPlan): ReportEditSessionPart[] {
    if (plan !== current) throw new ReportCellEditError("conflict");
    if (parts) return parts;
    if (!initialGuard?.()) throw new ReportCellEditError("conflict");
    return snapshotSessionParts(sourceParts!);
  }
  async function prepare(plan: RenderPlan, batch: ReportEditBatch, contexts: readonly ReportCellContext[], options: ReportEditPreparationOptions = {}): Promise<ReportPreparedEdit> {
    active(options.signal);
    // The caller may filter/reorder a returned history batch while saving. Lock this transaction.
    batch = { requestId: batch.requestId, edits: batch.edits.map((edit) => ({ ...edit, address: { ...edit.address }, source: edit.source ? { ...edit.source } : undefined, table: edit.table ? { ...edit.table } : undefined })) };
    contexts = contexts.map((context) => ({ ...context, address: { ...context.address }, source: context.source ? { ...context.source } : undefined, table: context.table ? { ...context.table } : undefined, cell: { ...context.cell } }));
    // Paint busy indicators before source fingerprint/snapshot and the first layout slice.
    await new Promise<void>((resolve) => setTimeout(resolve, 0)); active(options.signal);
    const base = baseline(plan), nextParts = updateSessionRows(base, changesFor(base, batch.edits));
    const nextPlan = applyReportSourceMetadata(await rebuild(nextParts, options.signal), concurrency); active(options.signal);
    let committed = false;
    let validationIssues: readonly ReportValidationIssue[] = [], warningPolicy: "allow" | "block" = "allow";
    let validationFailed = false;
    function validate(validation: ReportCandidateValidationOptions): readonly ReportValidationIssue[] {
      validationFailed = true;
      validationIssues = Object.freeze(validateSessionCandidates(nextParts, validation, options.signal, validationFormulas).map(issue => Object.freeze({ ...issue })));
      validationFailed = false;
      warningPolicy = validation.warningPolicy ?? "allow";
      return validationIssues;
    }
    if (options.validation) validate(options.validation);
    return { plan: nextPlan, get validationIssues() { return validationIssues; }, validate, commit(result) {
      active(options.signal);
      if (committed || current !== plan) throw new ReportCellEditError("conflict");
      if (result?.conflicts?.length) throw new ReportCellEditError("conflict");
      if (validationFailed) throw new Error("候选规则校验未完成，不能提交");
      assertReportValidation(validationIssues, warningPolicy);
      const committedParts = concurrencyParts(nextParts, batch, result), committedPlan = applyReportEditResult(nextPlan, batch, result);
      if (result) {
        const affected = rememberConcurrency(concurrency, batch, result);
        for (const [key, context] of retainedContexts) if (affected.has(sourceDatasetKey(context.source!))) retainedContexts.set(key, refreshContext(context, context.value, result));
      }
      contexts.forEach((context, index) => retainedContexts.set(reportCellEditKey(context), refreshContext(context, batch.edits[index]!.value, result)));
      committed = true; parts = committedParts; sourceParts = undefined; initialGuard = undefined; current = committedPlan; sessions.set(current, session); return current;
    } };
  }
  const session: ReportEditSession = {
    get plan() { return current; },
    async prepare(plan, batch, options) { const normalized = normalizedBatch(plan, batch); return prepare(plan, normalized.batch, normalized.contexts, options); },
    async prepareHistory(plan, edits, value, requestId, options) {
      if (!requestId.trim() || edits.length > 10_000) throw new ReportCellEditError("limit");
      const base = baseline(plan), resolve = createSessionRowResolver(base), visible = indexSessionContexts(plan), seen = new Set<string>();
      const contexts = edits.map((edit) => {
        if (!edit.source) throw new ReportCellEditError("missing");
        const key = reportCellEditKey(edit);
        if (seen.has(key)) throw new ReportCellEditError("duplicate"); seen.add(key);
        const context = visible.get(key) ?? retainedContexts.get(key);
        if (!context?.source) throw new ReportCellEditError("missing");
        const row = resolve(context.source)[0]!;
        return refreshContext(context, valueOf(row.row, context.source.field));
      });
      const candidates = contexts.map((context, index) => ({ context, edit: editFromContext(context, edits[index]![value]) })).filter(({ edit }) => !Object.is(edit.previousValue, edit.value));
      const batch: ReportEditBatch = { requestId, edits: candidates.map(({ edit }) => edit) };
      const selectedContexts = candidates.map(({ context }) => context);
      return { batch, contexts: selectedContexts, prepared: await prepare(plan, batch, selectedContexts, options) };
    }
  };
  sessions.set(initial, session); return session;
}

/** Optional standalone entry; normal createReportSource/createLocalFetcher already register it. */
export function createReportEditSession(options: { template: ReportTemplate; datasets: DatasetRows; pagination?: PaginateOptions }): ReportEditSession {
  const plan = paginateTemplate(options.template, options.datasets, options.pagination).plan;
  return registerReportEditSession(plan, { validationFormulas: [options.pagination?.formula], parts: [{ template: options.template, datasets: options.datasets }], rebuild: (parts, signal) => reflowReportTemplate(parts[0]!.template, parts[0]!.datasets, { ...options.pagination, signal }) });
}
