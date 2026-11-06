import type { ReportCellEdit, ReportEditBatch, ReportEditResult, ReportProvider, ReportDiagnostic, ReportSaveResult, ReportQuerySource } from "@agile-team/mach-report";
import { ReportCellEditError } from "@agile-team/mach-report";
import type { ReportEditOperation, ReportEditingOptions } from "./editing";
import { MachReportError } from "./errors";
import { cloneReportSnapshot } from "./snapshot";
import { assertProviderSaveResult } from "./provider-save-result";
import { observeOutput } from "../output/progress";

type Current<T> = T | (() => T);
export interface ProviderEditingOptions extends Pick<ReportEditingOptions, "canEdit" | "readOnlyReason" | "history" | "fields" | "validate" | "validation" | "validateBatch" | "requireSource"> {
  reportId?: Current<string>;
  params?: Current<Record<string, string>>;
  /** Getters are useful when query metadata is held by the host. Otherwise stable cell sources are used. */
  expectedRevision?: Current<string | undefined>;
  sourceToken?: Current<string | undefined>;
  onDiagnostic?(diagnostic: ReportDiagnostic): void;
}

function current<T>(value: Current<T>): T { return typeof value === "function" ? (value as () => T)() : value; }
function commonSource(edits: readonly ReportCellEdit[], field: "revision" | "sourceToken"): string | undefined {
  const values = new Set(edits.flatMap((edit) => edit.source?.[field] === undefined ? [] : [String(edit.source[field])]));
  return values.size === 1 ? [...values][0] : undefined;
}
function metadata(value: Current<string | undefined> | undefined, edits: readonly ReportCellEdit[], field: "revision" | "sourceToken", latest?: string, source?: Readonly<ReportQuerySource>, automatic = false): string | undefined {
  if (typeof value === "function") return value();
  if (automatic) return latest ?? source?.[field] ?? commonSource(edits, field) ?? value;
  return commonSource(edits, field) ?? latest ?? value ?? source?.[field];
}
function queryBinding(options: ProviderEditingOptions, operation: ReportEditOperation, edits: readonly ReportCellEdit[]) {
  const query = operation.query;
  const automatic = options.reportId === undefined;
  if (automatic && (!query || query.reportIds.length !== 1)) throw new MachReportError("config", "自动业务保存需要当前成功查询的单个报表上下文");
  const reportId = options.reportId === undefined ? query!.reportIds[0]! : current(options.reportId);
  if (!reportId.trim()) throw new MachReportError("config", "业务保存缺少报表 ID");
  if (automatic && new Set(edits.map(edit => edit.source?.sourceScope)).size > 1) throw new ReportCellEditError("atomic");
  const params = { ...current(options.params ?? query?.params ?? {}) };
  const sources = query?.sources.filter(source => source.reportId === reportId) ?? [];
  const source = sources.length === 1 ? sources[0] : undefined;
  return { reportId, params, source, automatic,
    identity: JSON.stringify([reportId, params, query?.queryId ?? query?.sources]) };
}
function requestIdentity(operation: ReportEditOperation): string {
  return operation.requestId ?? globalThis.crypto?.randomUUID?.() ?? `mr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Explicit persistence bridge. Merely registering ReportProvider never enables editing or saving. */
export function createProviderEditing(provider: ReportProvider, options: ProviderEditingOptions = {}): ReportEditingOptions {
  if (!provider.save) throw new MachReportError("config", "ReportProvider.save 未配置，无法启用业务保存");
  let queryIdentity = "";
  let revision: string | undefined;
  let sourceToken: string | undefined;
  let generation = 0;
  function remember(result: ReportSaveResult, identity: string, currentGeneration: number): void {
    if (result.conflicts?.length || identity !== queryIdentity || currentGeneration !== generation) return;
    revision = result.revision; sourceToken = result.sourceToken;
  }
  async function saveBatch(batch: Readonly<ReportEditBatch>, operation: ReportEditOperation): Promise<ReportEditResult> {
    if (operation.signal.aborted) throw operation.signal.reason ?? new DOMException("Aborted", "AbortError");
    const { reportId, params, identity, source, automatic } = queryBinding(options, operation, batch.edits);
    const currentGeneration = ++generation;
    if (identity !== queryIdentity) { queryIdentity = identity; revision = undefined; sourceToken = undefined; }
    if (options.requireSource !== false && batch.edits.some((edit) => !edit.source)) throw new ReportCellEditError("missing");
    const result = await provider.save!({ reportId, params, signal: operation.signal,
      requestId: batch.requestId, action: operation.action, edits: cloneReportSnapshot(batch.edits),
      expectedRevision: metadata(options.expectedRevision, batch.edits, "revision", revision, source, automatic),
      sourceToken: metadata(options.sourceToken, batch.edits, "sourceToken", sourceToken, source, automatic)
    });
    if (operation.signal.aborted) throw operation.signal.reason ?? new DOMException("Aborted", "AbortError");
    assertProviderSaveResult(result, batch.edits.length);
    result.diagnostics?.forEach((diagnostic) => observeOutput(() => options.onDiagnostic?.(diagnostic)));
    const errors = result.diagnostics?.filter((diagnostic) => diagnostic.severity === "error");
    if (errors?.length) throw new MachReportError("edit", errors.map((diagnostic) => diagnostic.message).join("；"), { diagnostics: errors });
    const conflicts = result.conflicts?.map((conflict) => ({ source: batch.edits[conflict.editIndex]?.source, address: batch.edits[conflict.editIndex]?.address, message: conflict.message,
      ...(conflict.currentValue === undefined ? {} : { currentValue: conflict.currentValue }),
      revision: conflict.revision ?? result.revision }));
    remember(result, identity, currentGeneration);
    return { revision: result.revision, sourceToken: result.sourceToken, conflicts };
  }
  return {
    requireSource: options.requireSource ?? true,
    canEdit: options.canEdit, readOnlyReason: options.readOnlyReason, history: options.history,
    fields: options.fields, validate: options.validate, validation: options.validation, validateBatch: options.validateBatch,
    saveBatch,
    save: (edit, operation) => saveBatch({ requestId: requestIdentity(operation), edits: [cloneReportSnapshot(edit)] }, operation)
  };
}
