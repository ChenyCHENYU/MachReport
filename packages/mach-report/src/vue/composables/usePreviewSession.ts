import { onScopeDispose, ref, shallowRef, type Ref } from "vue";
import type { AssetRenderOptions, RenderPlan, ReportQueryContext } from "@agile-team/mach-report";
import type { ReportRefreshOptions } from "../tools";
import type { PlanFetcher } from "../adapters";
import type { ExcelImportOptions, ExcelImportResult } from "../../xlsx/import-types";
import type { MachReportStateError } from "../controller";
import type { MachReportErrorCode } from "../errors";
import { MachReportError, normalizeReportLoadError, toErrorDetail } from "../errors";
import { forwardOutputAbort } from "../../output/progress";
import { scopeQueryDiagnostics } from "../query-diagnostics";
import { cloneReportSnapshot } from "../snapshot";
import { importPreviewPlan } from "../preview-plan";
import { queryPreviewPlan } from "../preview-query";
import { useLoadTiming } from "./useReportSearch";
import type { usePreviewTask } from "./usePreviewTask";
import { usePreviewDiagnostics } from "./usePreviewDiagnostics";

export interface PreviewQueryCandidate {
  plan: RenderPlan;
  context: Readonly<ReportQueryContext>;
  accept(beforeEvents?: () => void): boolean;
}

export type PreviewNotice = { kind: "error" | "warning" | "progress"; message: string };
/** A query or import owns a generation and a captured source context, never the live form. */
export function usePreviewSession({ source, policy, feedback, view, events, task, diagnostics }: {
  source: { ids(): string[]; fetcher(): PlanFetcher | null; readParams(): { params?: Record<string, string>; error?: MachReportError; quiet: boolean }; invalidParams(): void };
  policy: { guard(reason: "reload" | "import"): boolean | Promise<boolean>; assets(): AssetRenderOptions | undefined; importOptions(): boolean | ExcelImportOptions; importingMessage(): string | undefined; refresh?(): ReportRefreshOptions };
  feedback: { errorMessage: Ref<string>; lastError: Ref<Readonly<MachReportStateError> | null>; notice: Ref<PreviewNotice | null>; reportError(message: string, code: MachReportErrorCode, cause?: unknown): void };
  view: { invalidate(preservePosition?: boolean): void; beforeImport(): void; accepted(kind: "query" | "import", preservePosition?: boolean): void };
  events: { warning(message: string): void; logWarning(message: string): void; loaded(count: number): void; imported(result: ExcelImportResult): void };
  task: ReturnType<typeof usePreviewTask>;
  diagnostics: ReturnType<typeof usePreviewDiagnostics>;
}) {
  const plan = shallowRef<RenderPlan | null>(null);
  const loading = ref(false), importing = ref(false), stale = ref(false);
  let loadedKey: string | undefined;
  const loadedContext = shallowRef<Readonly<ReportQueryContext> | null>(null);
  let loadedFetcher: PlanFetcher | null = null;
  const importedResult = shallowRef<Pick<ExcelImportResult, "sheets" | "warnings" | "diagnostics" | "diagnosticSummary"> | null>(null);
  const { errorMessage, lastError, notice: exportNotice, reportError } = feedback;
  const timing = useLoadTiming();
  const preparedDiagnostics = usePreviewDiagnostics(() => {});
  let destroyed = false;
  function invalidate(): void {
    view.invalidate();
    importing.value = false;
    stale.value = false;
    loadedKey = undefined;
    importedResult.value = null;
    plan.value = null;
    loadedContext.value = null;
    loadedFetcher = null;
    diagnostics.reset();

  }

  /** 代际令牌：报表 ID 快速切换时，旧请求即使后返回也不得覆盖新数据 */
  let reloadSeq = 0;
  let loadController: AbortController | null = null;
  let preparationController: AbortController | null = null;
  let preparationSequence = 0;
  function cancelPreparation(): void { preparationSequence++; preparationController?.abort(); preparationController = null; }
  function isCurrentLoad(seq: number, controller: AbortController): boolean {
    return seq === reloadSeq && !controller.signal.aborted && !destroyed;
  }
  function emitImportWarnings(warnings: readonly string[], seq: number): boolean {
    for (const message of warnings) {
      if (seq !== reloadSeq) return false;
      events.warning(message);
    }
    return seq === reloadSeq;
  }

  function readQueryParams(): Record<string, string> | null {
    const query = source.readParams();
    if (query.params) return query.params;
    if (!policy.refresh?.().retainPrevious || !plan.value) invalidate();
    else stale.value = true;
    errorMessage.value = query.quiet ? "" : query.error!.message;
    if (!query.quiet) {
      source.invalidParams();
      reportError(query.error!.message, query.error!.code, query.error!.cause);
    }
    return null;
  }

  function beginRefresh(params: Record<string, string>) {
    const refresh = policy.refresh?.();
    const retained = !!refresh?.retainPrevious && !!plan.value && !!loadedContext.value;
    const requestedKey = refresh?.key;
    const preservePosition = retained && requestedKey === loadedKey && sameContext(source.ids(), params, loadedContext.value!);
    if (retained) { stale.value = true; diagnostics.reset(); }
    else invalidate();
    return { retained, requestedKey, preservePosition };
  }

  async function reload(): Promise<void> {
    if (destroyed) return;
    const ready = policy.guard("reload");
    if (!(typeof ready === "boolean" ? ready : await ready)) return;
    if (destroyed) return;
    const seq = ++reloadSeq;
    cancelPreparation();
    importing.value = false;
    loadController?.abort();
    loadController = null;
    const fetcher = source.fetcher();
    // 新一轮负责结束旧 loading；参数/配置早退时旧请求的 finally 已失去代际权限。
    loading.value = false;
    lastError.value = null;
    if (source.ids().length === 0) {
      errorMessage.value = "缺少报表 ID";
      invalidate();
      reportError(errorMessage.value, "param");
      return;
    }
    if (!fetcher) {
      errorMessage.value = "未提供渲染数据源 fetcher";
      invalidate();
      reportError(errorMessage.value, "config");
      return;
    }
    const params = readQueryParams();
    if (!params) return;
    loading.value = true;
    errorMessage.value = "";
    exportNotice.value = null;
    const previousDiagnostics = diagnostics.capture();
    const { retained, requestedKey, preservePosition } = beginRefresh(params);
    const t0 = timing.start();
    const controller = new AbortController();
    loadController = controller;
    const operation = task.start("query", "query", () => {
      if (loadController !== controller) return;
      controller.abort(); reloadSeq++; loadController = null; loading.value = false;
      if (retained) diagnostics.restore(previousDiagnostics);
    });
    const requestedIds = [...source.ids()];
    const reportedWarnings = new Set<string>();
    function reportWarning(message: string): void {
      if (seq !== reloadSeq || controller.signal.aborted || reportedWarnings.has(message)) return;
      reportedWarnings.add(message);
      events.logWarning(message);
      diagnostics.add({ code: "layout", severity: "warning", message });
      events.warning(message);
    }
    try {
      const next = await queryPreviewPlan(fetcher, {
        reportIds: requestedIds,
        params,
        taskId: operation.taskId,
        onEvent: (event) => { if (seq === reloadSeq && !controller.signal.aborted) operation.update(event.stage, event.completed, event.total); },
        onQueryResult: (id, result, index) => { if (seq === reloadSeq && !controller.signal.aborted) diagnostics.addMany(scopeQueryDiagnostics(requestedIds, id, result.diagnostics ?? [], index)); },
        signal: controller.signal,
        onWarning: reportWarning
      }, policy.assets(), operation.update);
      if (!isCurrentLoad(seq, controller)) return;
      view.invalidate(preservePosition);
      importedResult.value = null;
      plan.value = next.plan;
      stale.value = false;
      loadedKey = requestedKey;
      loadedContext.value = next.context;
      loadedFetcher = fetcher;
      diagnostics.inspectSummary(next.plan, "dom");
      if (!isCurrentLoad(seq, controller)) return;
      operation.finish();
      timing.end(t0);
      view.accepted("query", preservePosition);
      events.loaded(next.plan.pages.length);
    } catch (error) {
      if (seq !== reloadSeq) return;
      if (controller.signal.aborted) { operation.finish("cancelled"); return; }
      operation.finish("failed");
      if (retained) diagnostics.restore(previousDiagnostics);
      const normalized = normalizeReportLoadError(error);
      errorMessage.value = normalized.message;
      const detail = toErrorDetail(normalized);
      reportError(normalized.message, detail.code, detail.cause);
    } finally {
      if (seq === reloadSeq) loading.value = false;
      if (loadController === controller) loadController = null;
    }
  }

  /** Read a fresh candidate without replacing a report or discarding rejected edits. */
  async function prepareLatest(signal: AbortSignal): Promise<PreviewQueryCandidate> {
    const previousPlan = plan.value, previousContext = loadedContext.value, fetcher = loadedFetcher;
    if (!previousPlan || !previousContext || !fetcher || fetcher !== source.fetcher() || destroyed || loading.value || importing.value) throw new MachReportError("edit", "当前报表缺少可重新查询的成功会话");
    cancelPreparation();
    const sequence = preparationSequence, querySequence = reloadSeq;
    const controller = new AbortController(); preparationController = controller;
    const disconnect = forwardOutputAbort(signal, controller);
    const currentGeneration = () => !signal.aborted && !controller.signal.aborted && !destroyed && sequence === preparationSequence && querySequence === reloadSeq
      && fetcher === loadedFetcher && fetcher === source.fetcher();
    const current = () => currentGeneration() && previousPlan === plan.value && previousContext === loadedContext.value;
    preparedDiagnostics.reset();
    try {
      const candidate = await queryPreviewPlan(fetcher, {
        reportIds: [...previousContext.reportIds], params: { ...previousContext.params }, signal: controller.signal,
        taskId: `${previousContext.queryId ?? "query"}:conflict:${sequence}`,
        onQueryResult: (id, result, index) => { if (current()) preparedDiagnostics.addMany(scopeQueryDiagnostics(previousContext.reportIds, id, result.diagnostics ?? [], index)); },
        onWarning: message => { if (current()) preparedDiagnostics.add({ code: "layout", severity: "warning", message }); },
      }, policy.assets());
      if (!current()) throw new DOMException("The report query was replaced", "AbortError");
      preparedDiagnostics.inspectSummary(candidate.plan, "dom");
      const captured = preparedDiagnostics.capture();
      let accepted = false;
      return { ...candidate, accept(beforeEvents) {
        if (accepted || !current()) return false;
        accepted = true; preparationController = null;
        const previousDiagnostics = diagnostics.capture();
        view.invalidate(true);
        if (!current()) return false;
        importedResult.value = null; errorMessage.value = ""; lastError.value = null; exportNotice.value = null;
        loadedContext.value = candidate.context; plan.value = candidate.plan; stale.value = false;
        try { beforeEvents?.(); }
        catch (cause) {
          if (currentGeneration() && plan.value === candidate.plan && loadedContext.value === candidate.context) {
            loadedContext.value = previousContext; plan.value = previousPlan; diagnostics.restore(previousDiagnostics);
          }
          throw cause;
        }
        diagnostics.restore(captured, true);
        if (!currentGeneration() || plan.value !== candidate.plan || loadedContext.value !== candidate.context) return false;
        view.accepted("query", true);
        events.loaded(candidate.plan.pages.length);
        return currentGeneration() && plan.value === candidate.plan && loadedContext.value === candidate.context;
      } };
    } finally { disconnect(); }
  }

  function mergeExcelImportOptions(options?: ExcelImportOptions): ExcelImportOptions {
    const configured = policy.importOptions();
    const defaults = typeof configured === "object" ? configured : {};
    return { ...defaults, ...options, limits: { ...defaults.limits, ...options?.limits } };
  }

  function acceptImportedPlan(next: RenderPlan, result: ExcelImportResult): void {
    view.invalidate();
    stale.value = false;
    loadedKey = undefined;
    plan.value = next;
    loadedContext.value = null;
    loadedFetcher = null;
    diagnostics.reset();
    importedResult.value = cloneReportSnapshot({ sheets: result.sheets, warnings: result.warnings, diagnostics: result.diagnostics, diagnosticSummary: result.diagnosticSummary });
    errorMessage.value = "";
    exportNotice.value = null;
    view.accepted("import");
    if (result.diagnosticSummary) diagnostics.addBaseSummary(result.diagnosticSummary);
    else diagnostics.addMany(result.warnings.map((message) => ({ code: "excel-import", severity: "warning" as const, message })));
    if (plan.value === next) diagnostics.inspectSummary(next, "dom");
  }

  /** Import is an explicit local replacement; business mapping/storage remains in the host. */
  async function importExcel(input: ArrayBuffer | Uint8Array | Blob, options?: ExcelImportOptions): Promise<ExcelImportResult | null> {
    if (destroyed) throw new MachReportError("config", "报表预览已卸载");
    const ready = policy.guard("import");
    if (!(typeof ready === "boolean" ? ready : await ready)) return null;
    if (destroyed) return null;
    const seq = ++reloadSeq;
    cancelPreparation();
    loadController?.abort();
    loadController = null;
    loading.value = false;
    view.beforeImport();
    importing.value = true;
    const controller = new AbortController();
    loadController = controller;
    lastError.value = null;
    exportNotice.value = { kind: "progress", message: policy.importingMessage() ?? "正在导入 Excel…" };
    const operation = task.start("import", "import", () => {
      if (loadController !== controller) return;
      controller.abort(); reloadSeq++; loadController = null; importing.value = false; exportNotice.value = null;
    });
    const importOptions = mergeExcelImportOptions(options);
    const unlink = forwardOutputAbort(importOptions.signal, controller);
    try {
      const { result, plan: next } = await importPreviewPlan(input, {
        ...importOptions, onProgress: (done, total) => { operation.update("import", done, total); importOptions.onProgress?.(done, total); }
      }, policy.assets(), controller.signal, (message) => { if (seq === reloadSeq) events.warning(message); }, operation.update);
      if (!isCurrentLoad(seq, controller)) return null;
      if (!emitImportWarnings(result.warnings, seq)) return null;
      acceptImportedPlan(next, result);
      if (!isCurrentLoad(seq, controller)) return null;
      operation.finish();
      events.imported(result);
      if (seq === reloadSeq) events.loaded(next.pages.length);
      return result;
    } catch (cause) {
      if (seq !== reloadSeq) return null;
      if (controller.signal.aborted) { operation.finish("cancelled"); return null; }
      operation.finish("failed");
      const error = new MachReportError("import", cause instanceof Error ? cause.message : "Excel 模板导入失败", cause);
      exportNotice.value = { kind: "error", message: error.message };
      reportError(error.message, "import", cause);
      throw error;
    } finally {
      unlink();
      if (seq === reloadSeq) importing.value = false;
      if (loadController === controller) loadController = null;
    }
  }


  /** Manual-load hosts can change the next source without admitting an obsolete in-flight result. */
  function retainPrevious(): void {
    cancelPreparation();
    if (loadController) task.cancel();
    reloadSeq++; loadController?.abort(); loadController = null;
    loading.value = false; importing.value = false;
    stale.value = !!plan.value;
  }
  function clear(): void {
    cancelPreparation();
    reloadSeq++; loadController?.abort(); loadController = null;
    loading.value = false; errorMessage.value = ""; lastError.value = null; exportNotice.value = null;
    invalidate();
  }
  function dispose(): void {
    cancelPreparation();
    destroyed = true; reloadSeq++; loadController?.abort(); loadController = null;
    loading.value = false; importing.value = false;
  }
  onScopeDispose(dispose);
  return { plan, loading, importing, stale, loadedContext, importedResult, timing, reload, prepareLatest, importExcel, invalidate, clear, retainPrevious };
}

function sameContext(ids: readonly string[], params: Readonly<Record<string, string>>, previous: { reportIds: readonly string[]; params: Readonly<Record<string, string>> }): boolean {
  if (ids.length !== previous.reportIds.length || ids.some((id, index) => id !== previous.reportIds[index])) return false;
  const keys = Object.keys(params);
  return keys.length === Object.keys(previous.params).length && keys.every(key => params[key] === previous.params[key]);
}
