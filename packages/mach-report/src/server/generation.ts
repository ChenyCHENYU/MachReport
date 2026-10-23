import { ReportParamValidationError } from "../source/param-validation";
import { throwIfAborted } from "./control";
import { createReportInstanceManager, ReportInstanceError, checkInstanceIdentity, type ReportInstanceStore, type ReportInstanceSnapshot } from "./instance-store";
import type { PreparedReport, ReportRuntime, ReportRuntimePreparedExportInput, ReportPdfFontOptions } from "./types";
import { serializeJobJson } from "./job-store";
import { snapshotPdfFonts, snapshotXlsxOptions } from "./prepared";

export interface ReportGenerationInput {
  scope: string;
  id: string;
  title: string;
  reportIds: string[];
  params?: Record<string, string>;
  expectedRevision: number | null;
  signal?: AbortSignal;
}
function generationRequest(input: ReportGenerationInput): { signal?: AbortSignal; request: Omit<ReportGenerationInput, "signal"> } {
  if (!input || typeof input !== "object" || Object.getOwnPropertySymbols(input).length) throw new ReportInstanceError("input", "生成请求应为普通对象");
  const request: Record<string, unknown> = Object.create(null);
  let signal: AbortSignal | undefined;
  const allowed = new Set(["scope", "id", "title", "reportIds", "params", "expectedRevision", "signal"]);
  for (const key of Object.getOwnPropertyNames(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
    if (!allowed.has(key) || !descriptor.enumerable || descriptor.get || descriptor.set) throw new ReportInstanceError("input", "生成请求不能包含未知字段或访问器");
    if (key === "signal") signal = descriptor.value as AbortSignal | undefined;
    else if (descriptor.value !== undefined) request[key] = descriptor.value;
  }
  return { signal, request: JSON.parse(serializeJobJson(request)) as Omit<ReportGenerationInput, "signal"> };
}
/** Bind immutable template revisions to the same runtime registration. Rebuild the service on publication. */
export function createReportGenerationService(options: { runtime: ReportRuntime; instances: ReportInstanceStore; templateRevisions: Record<string, string>; pdf?: ReportPdfFontOptions; maxSnapshotBytes?: number; now?: () => Date }) {
  const revisions = JSON.parse(serializeJobJson(options.templateRevisions)) as Record<string, string>;
  const defaultPdf = snapshotPdfFonts(options.pdf);
  const manager = createReportInstanceManager(options.instances, { maxSnapshotBytes: options.maxSnapshotBytes });
  return {
    async generate(input: ReportGenerationInput): Promise<ReportInstanceSnapshot> {
      const { signal, request: snapshot } = generationRequest(input);
      checkInstanceIdentity(snapshot.scope, snapshot.id);
      if (snapshot.expectedRevision !== null && (!Number.isSafeInteger(snapshot.expectedRevision) || snapshot.expectedRevision < 1)) throw new ReportInstanceError("input", "实例预期修订无效");
      const validation = options.runtime.validate(snapshot);
      if (!validation.ok) throw new ReportParamValidationError(validation.issues);
      const templateRevisions: Record<string, string> = Object.create(null);
      for (const id of snapshot.reportIds) {
        if (typeof revisions[id] !== "string" || !revisions[id]) throw new TypeError(`报表 ${id} 缺少生成时的模板修订`);
        templateRevisions[id] = revisions[id]!;
      }
      throwIfAborted(signal);
      const existing = await options.instances.read(snapshot.scope, snapshot.id, undefined, signal);
      if ((existing?.revision ?? null) !== snapshot.expectedRevision) {
        // Reuse the common manager's conflict semantics without fetching live data on a stale request.
        throw new ReportInstanceError("conflict", "实例已存在或已变化，请显式确认修订后生成");
      }
      const prepared = await options.runtime.prepare({ reportIds: snapshot.reportIds, params: validation.values, pdf: defaultPdf, signal });
      throwIfAborted(signal);
      const sourceRevisions: Record<string, string> = Object.create(null);
      for (const [id, origin] of Object.entries(prepared.revisions)) if (origin.revision !== undefined) sourceRevisions[id] = origin.revision;
      const { plan, revisions: _revisions, ...output } = prepared;
      return manager.save({ scope: snapshot.scope, id: snapshot.id, title: snapshot.title, reportIds: snapshot.reportIds, params: validation.values,
        templateRevisions, sourceRevisions, generatedAt: (options.now?.() ?? new Date()).toISOString(), plan, output
      }, { expectedRevision: snapshot.expectedRevision, signal });
    },
    read: manager.read,
    list: manager.list,
    /** Read an immutable saved revision and encode its plan, never re-query the business source. */
    async exportInstance(input: { scope: string; id: string; revision?: number } & Omit<ReportRuntimePreparedExportInput, "prepared">) {
      const { scope, id, revision, signal, format, fidelity, taskId, correlationId, onEvent } = input;
      const pdf = snapshotPdfFonts(input.pdf ?? defaultPdf), xlsx = snapshotXlsxOptions(input.xlsx);
      checkInstanceIdentity(scope, id); throwIfAborted(signal);
      const instance = await manager.read(scope, id, revision, signal);
      if (!instance) throw new ReportInstanceError("input", "报表实例不存在");
      const prepared: PreparedReport = {
        plan: instance.plan,
        revisions: Object.fromEntries(instance.reportIds.map(id => [id, { revision: instance.sourceRevisions[id] }])),
        diagnostics: [{ code: "instance-row-count", severity: "info", message: "历史实例未保存原始取数行数；本次 rows 统计为 0，页面及单元格数由已保存计划校验。" }],
        stats: { rows: 0, pages: instance.plan.pages.length, cells: 0, durationMs: 0 },
        ...instance.output
      };
      return options.runtime.exportPrepared({ prepared, format, fidelity, pdf, xlsx, signal, taskId, correlationId, onEvent });
    },
    /** Instance edits are explicit snapshots; source business persistence remains the Provider.save responsibility. */
    save: manager.save
  };
}
