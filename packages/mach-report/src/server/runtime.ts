import { createReportSource, ReportSourceError, type ReportRegistry } from "../source/report-source";
import { getReportParamDefs } from "../source/report-params";
import { reportParamsJsonSchema, ReportParamValidationError, validateReportParams, type ReportParamValidation } from "../source/param-validation";
import type { PreparedReport, ReportDescription, ReportRuntime, ReportRuntimeBudget, ReportRuntimeExportInput, ReportRuntimeExportResult, ReportRuntimeInput, ReportRuntimeOptions, ReportRuntimePreparedExportInput } from "./types";
import { assertBudget, controlled, ReportRuntimeError, throwIfAborted, validateBudget } from "./control";
import type { PlanComponent } from "../schema/render-plan";
import { validateRenderPlan } from "../schema/validate";
import type { TextMeasurer } from "../layout/textwrap";
import type { DatasetRows, ReportTemplate } from "../layout/paginate";
import { estimateListLayoutCells, PaginateCellLimitError, PaginatePageLimitError } from "../layout/paginate";
import { createReportTaskReporter, notifyReportTaskEvent, reportTaskId, type ReportTaskEvent } from "../source/task-events";
import { templateDatasetRowCount, templateDatasetJsonSchema } from "../source/template-tree-data";
import { TreeRowLimitError } from "../processing/tree";
import { resolvePlanAssets } from "../output/assets";
import { encodePreparedReport, outputDiagnostics } from "./runtime-output";
import { checkPreparedFont, reportFontFingerprint, snapshotPreparedReport, snapshotPdfFonts, snapshotXlsxOptions } from "./prepared";

function definitions(reports: ReportRegistry, ids: string[]) {
  if (ids.length === 0) throw new ReportSourceError("config", "缺少报表 ID");
  return ids.map((id) => {
    if (!Object.prototype.hasOwnProperty.call(reports, id)) throw new ReportSourceError("config", `未注册报表 ${id}`);
    return reports[id]!;
  });
}
function cellCount(component: PlanComponent): number {
  return component.grid?.cells.reduce((sum, row) => sum + row.reduce((count, cell) => count + (cell ? 1 + (cell.children?.reduce((nested, child) => nested + cellCount(child), 0) ?? 0) : 0), 0), 0) ?? 0;
}
function logicalCells(template: ReportTemplate, datasets: DatasetRows, pagination?: ReportRuntimeOptions["pagination"]): number {
  return template.pages.reduce((sum, page) => sum + page.components.reduce((count, component) => {
    if (component.kind !== "list") return count + cellCount(component);
    return count + estimateListLayoutCells(component, datasets, pagination);
  }, 0), 0);
}
function describe(reports: ReportRegistry, ids = Object.keys(reports)): ReportDescription[] {
  return definitions(reports, ids).map((definition, index) => {
    const id = ids[index]!;
    const params = getReportParamDefs(reports, [id]);
    return { id, params: JSON.parse(JSON.stringify(params)) as typeof params, paramsSchema: reportParamsJsonSchema(params),
      datasetsSchema: Object.fromEntries(Object.entries(definition.dataSchema ?? {}).map(([name, contract]) => [name, templateDatasetJsonSchema(typeof definition.template === "function" ? undefined : definition.template, name, contract)])), capabilities: {
      save: !!definition.provider?.save, export: !!definition.provider?.export, templates: !!definition.provider?.templates
    } };
  });
}

function validateInput(reports: ReportRegistry, input: Omit<ReportRuntimeInput, "signal">): ReportParamValidation {
  definitions(reports, input.reportIds);
  const result = validateReportParams(getReportParamDefs(reports, input.reportIds), input.params);
  // 同名参数的 UI 元数据仍由首份决定，但实际各报表的约束都必须满足。
  const problems = input.reportIds.flatMap((id) => validateReportParams(getReportParamDefs(reports, [id]), input.params).issues);
  const unique = new Map(problems.map((issue) => [JSON.stringify(issue), issue]));
  return { ...result, ok: unique.size === 0, issues: [...unique.values()] };
}

function enforcePrepared(result: PreparedReport, budget: ReportRuntimeBudget): PreparedReport {
  const validation = validateRenderPlan(result.plan);
  if (!validation.ok) throw new ReportSourceError("validate", `执行器返回无效计划：${validation.errors[0]?.path}`);
  const pages = result.plan.pages.length;
  const cells = result.plan.pages.reduce((sum, page) => sum + page.components.reduce((count, component) => count + cellCount(component), 0), 0);
  assertBudget(budget, "maxRows", result.stats.rows); assertBudget(budget, "maxPages", pages); assertBudget(budget, "maxCells", cells);
  return { ...result, stats: { ...result.stats, pages, cells } };
}

function assertInput(options: ReportRuntimeOptions, input: Omit<ReportRuntimeInput, "signal">): void {
  const validation = validateInput(options.reports, input);
  if (!validation.ok) throw new ReportParamValidationError(validation.issues);
}

/** 无 Vue、无 HTTP 框架的可选服务端外观；PDF/Excel 仅在对应 export 调用时加载。 */
export function createReportRuntime(options: ReportRuntimeOptions): ReportRuntime {
  const budget = { maxRows: 100_000, maxPages: 10_000, maxCells: 2_000_000, maxOutputBytes: 100_000_000, maxPreparedBytes: 64_000_000, maxDurationMs: 120_000, ...options.budget };
  validateBudget(budget);
  const localPrepare = async (input: ReportRuntimeInput, measurer?: TextMeasurer): Promise<PreparedReport> => {
    const started = Date.now();
    let rows = 0;
    let inputCells = 0;
    const diagnostics: PreparedReport["diagnostics"] = [];
    const revisions: PreparedReport["revisions"] = {};
    const reports = Object.fromEntries(Object.entries(options.reports).map(([id, definition]) => [id, { ...definition,
      pagination: { ...options.pagination, ...definition.pagination, ...(measurer ? { measurer } : {}) },
      dataValidation: { ...definition.dataValidation,
        maxRows: Math.min(budget.maxRows ?? 100_000, definition.dataValidation?.maxRows ?? Infinity),
        maxCells: Math.min(budget.maxCells ?? 2_000_000, definition.dataValidation?.maxCells ?? Infinity)
      }
    }]));
    const source = createReportSource(reports, { maxPages: budget.maxPages, maxCells: budget.maxCells, onDatasets: (id, data, template) => {
      try { rows += templateDatasetRowCount(template, data, { maxRows: budget.maxRows, signal: input.signal }); }
      catch (error) { if (error instanceof TreeRowLimitError) throw new ReportRuntimeError("budget", error.message, "$.budget.maxRows"); throw error; }
      assertBudget(budget, "maxRows", rows);
      inputCells += logicalCells(template, data, reports[id]?.pagination);
      assertBudget(budget, "maxCells", inputCells);
    } });
    const rawPlan = await source({ ...input, params: input.params ?? {}, onWarning: (message) => diagnostics.push({ code: "layout", message, severity: "warning" }), onQueryResult: (id, result) => {
      Object.defineProperty(revisions, id, { value: { revision: result.revision, sourceToken: result.sourceToken }, enumerable: true, writable: true });
      diagnostics.push(...result.diagnostics ?? []);
    } }).catch((error: unknown) => {
      if (error instanceof ReportSourceError && error.cause instanceof PaginatePageLimitError) throw new ReportRuntimeError("budget", error.cause.message, "$.budget.maxPages");
      if (error instanceof ReportSourceError && error.cause instanceof PaginateCellLimitError) throw new ReportRuntimeError("budget", error.cause.message, "$.budget.maxCells");
      throw error;
    });
    throwIfAborted(input.signal);
    const resolved = options.assets
      ? await createReportTaskReporter(input).run("assets", () => resolvePlanAssets(rawPlan, { ...options.assets, signal: input.signal }))
      : { plan: rawPlan, diagnostics: [] };
    const plan = resolved.plan;
    diagnostics.push(...outputDiagnostics(resolved.diagnostics));
    const cells = plan.pages.reduce((sum, page) => sum + page.components.reduce((count, component) => count + cellCount(component), 0), 0);
    assertBudget(budget, "maxPages", plan.pages.length); assertBudget(budget, "maxCells", cells);
    const fingerprint = reportFontFingerprint(input.pdf);
    const providedMetrics = options.pagination?.measurer || Object.values(options.reports).some(definition => definition.pagination?.measurer);
    return { plan, diagnostics, revisions, layout: { textMetrics: fingerprint ? "font-bytes" : providedMetrics ? "provided" : "heuristic", ...(fingerprint ? { fontFingerprint: fingerprint } : {}) }, stats: { rows, pages: plan.pages.length, cells, durationMs: Date.now() - started } };
  };
  const localExport = async (input: ReportRuntimeExportInput): Promise<ReportRuntimeExportResult> => {
    const started = Date.now();
    if (input.format !== "pdf" && input.format !== "xlsx") throw new ReportSourceError("config", "不支持的报表导出格式");
    const pdf = input.format === "pdf" ? await import("@agile-team/mach-report/pdf") : undefined;
    throwIfAborted(input.signal);
    const faces = input.pdf?.customFontFaces ?? (input.pdf?.customFontBytes ? { regular: input.pdf.customFontBytes } : undefined);
    const measurer = pdf && faces ? pdf.createFontBytesMeasurer(faces) : undefined;
    const prepared = await localPrepare(input, measurer);
    throwIfAborted(input.signal);
    return encodePreparedReport({ ...input, prepared }, budget, started);
  };
  return {
    describe: (ids) => describe(options.reports, ids),
    validate: (input) => validateInput(options.reports, input),
    prepare: (input) => controlled(input.signal, budget.maxDurationMs, async (signal) => {
      const { signal: _signal, onEvent, ...values } = input;
      const request = { ...values, ...(values.pdf ? { pdf: snapshotPdfFonts(values.pdf) } : {}), taskId: values.taskId ?? reportTaskId() };
      const observe = onEvent ? (event: ReportTaskEvent) => notifyReportTaskEvent(onEvent, event, signal) : undefined;
      const monitoring = { ...request, signal, onEvent: observe };
      createReportTaskReporter(monitoring).runSync("validate", () => assertInput(options, request));
      let measurer: TextMeasurer | undefined;
      const faces = request.pdf?.customFontFaces ?? (request.pdf?.customFontBytes ? { regular: request.pdf.customFontBytes } : undefined);
      if (!options.executor && faces) {
        const pdf = await import("@agile-team/mach-report/pdf");
        throwIfAborted(signal); measurer = pdf.createFontBytesMeasurer(faces);
      }
      const result = options.executor ? await options.executor.prepare(request, signal, observe) : await localPrepare(monitoring, measurer);
      return enforcePrepared(result, budget);
    }),
    exportPrepared: (input: ReportRuntimePreparedExportInput) => controlled(input.signal, budget.maxDurationMs, async (signal) => {
      const started = Date.now();
      const { signal: _signal, onEvent, ...values } = input;
      const prepared = enforcePrepared(snapshotPreparedReport(input.prepared, budget.maxPreparedBytes ?? 64_000_000, signal), budget);
      const request = { ...values, xlsx: snapshotXlsxOptions(values.xlsx), prepared, ...(values.pdf ? { pdf: snapshotPdfFonts(values.pdf) } : {}), taskId: values.taskId ?? reportTaskId() };
      if (request.format !== "pdf" && request.format !== "xlsx") throw new ReportSourceError("config", "不支持的报表导出格式");
      const observe = onEvent ? (event: ReportTaskEvent) => notifyReportTaskEvent(onEvent, event, signal) : undefined;
      if (options.executor) {
        if (!options.executor.exportPrepared) throw new ReportSourceError("config", "执行器未实现 exportPrepared；请升级执行器或显式使用本地运行时");
        const result = await options.executor.exportPrepared(request, signal, observe);
        assertBudget(budget, "maxRows", result.stats.rows); assertBudget(budget, "maxPages", result.stats.pages); assertBudget(budget, "maxCells", result.stats.cells);
        assertBudget(budget, "maxOutputBytes", result.bytes.byteLength);
        return { ...result, stats: { ...result.stats, outputBytes: result.bytes.byteLength } };
      }
      const monitoring = { ...request, signal, onEvent: observe };
      createReportTaskReporter(monitoring).runSync("validate", () => checkPreparedFont(monitoring));
      if (options.assets) {
        const resolved = await createReportTaskReporter(monitoring).run("assets", () => resolvePlanAssets(prepared.plan, { ...options.assets, signal }));
        prepared.plan = resolved.plan; prepared.diagnostics.push(...outputDiagnostics(resolved.diagnostics));
      }
      return encodePreparedReport(monitoring, budget, started);
    }),
    export: (input) => controlled(input.signal, budget.maxDurationMs, async (signal) => {
      const { signal: _signal, onEvent, ...values } = input;
      const request = { ...values, xlsx: snapshotXlsxOptions(values.xlsx), ...(values.pdf ? { pdf: snapshotPdfFonts(values.pdf) } : {}), taskId: values.taskId ?? reportTaskId() };
      const observe = onEvent ? (event: ReportTaskEvent) => notifyReportTaskEvent(onEvent, event, signal) : undefined;
      const monitoring = { ...request, signal, onEvent: observe };
      createReportTaskReporter(monitoring).runSync("validate", () => assertInput(options, request));
      if (request.format !== "pdf" && request.format !== "xlsx") throw new ReportSourceError("config", "不支持的报表导出格式");
      const result = options.executor ? await options.executor.export(request, signal, observe) : await localExport(monitoring);
      assertBudget(budget, "maxRows", result.stats.rows); assertBudget(budget, "maxPages", result.stats.pages); assertBudget(budget, "maxCells", result.stats.cells);
      assertBudget(budget, "maxOutputBytes", result.bytes.byteLength);
      return { ...result, stats: { ...result.stats, outputBytes: result.bytes.byteLength } };
    })
  };
}
