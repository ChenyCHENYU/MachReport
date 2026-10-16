import { createReportSource, ReportSourceError, type ReportRegistry } from "../source/report-source";
import { getReportParamDefs } from "../source/report-params";
import { reportParamsJsonSchema, ReportParamValidationError, validateReportParams, type ReportParamValidation } from "../source/param-validation";
import type { PreparedReport, ReportDescription, ReportRuntime, ReportRuntimeBudget, ReportRuntimeExportInput, ReportRuntimeExportResult, ReportRuntimeInput, ReportRuntimeOptions } from "./types";
import { assertBudget, controlled, throwIfAborted, validateBudget } from "./control";
import type { PlanComponent } from "../schema/render-plan";
import { validateRenderPlan } from "../schema/validate";
import type { TextMeasurer } from "../layout/textwrap";
import type { OutputDiagnostic } from "../output/capabilities";
import { datasetJsonSchema } from "../schema/dataset";
import type { DatasetRows, ReportTemplate } from "../layout/paginate";

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
function logicalCells(template: ReportTemplate, datasets: DatasetRows): number {
  return template.pages.reduce((sum, page) => sum + page.components.reduce((count, component) => {
    if (component.kind !== "list") return count + cellCount(component);
    const rows = datasets[component.dataset]?.length ?? 0;
    return count + component.columns.length * (rows + (component.headerGrid?.cells.length ?? 1));
  }, 0), 0);
}
function describe(reports: ReportRegistry, ids = Object.keys(reports)): ReportDescription[] {
  return definitions(reports, ids).map((definition, index) => {
    const id = ids[index]!;
    const params = getReportParamDefs(reports, [id]);
    return { id, params: JSON.parse(JSON.stringify(params)) as typeof params, paramsSchema: reportParamsJsonSchema(params),
      datasetsSchema: Object.fromEntries(Object.entries(definition.dataSchema ?? {}).map(([name, contract]) => [name, datasetJsonSchema(contract)])), capabilities: {
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

function outputDiagnostics(entries: readonly OutputDiagnostic[] = []): PreparedReport["diagnostics"] {
  return entries.map(({ code, message, severity, pageIndex, componentIndex }) => ({ code, message, severity, path: `$.pages.${pageIndex}.components.${componentIndex}` }));
}

/** 无 Vue、无 HTTP 框架的可选服务端外观；PDF/Excel 仅在对应 export 调用时加载。 */
export function createReportRuntime(options: ReportRuntimeOptions): ReportRuntime {
  const budget = { maxRows: 100_000, maxPages: 10_000, maxCells: 2_000_000, maxOutputBytes: 100_000_000, maxDurationMs: 120_000, ...options.budget };
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
    const source = createReportSource(reports, { onDatasets: (_id, data, template) => {
      rows += Object.values(data).reduce((sum, items) => sum + items.length, 0);
      assertBudget(budget, "maxRows", rows);
      inputCells += logicalCells(template, data);
      assertBudget(budget, "maxCells", inputCells);
    } });
    const plan = await source({ ...input, params: input.params ?? {}, onWarning: (message) => diagnostics.push({ code: "layout", message, severity: "warning" }), onQueryResult: (id, result) => {
      Object.defineProperty(revisions, id, { value: { revision: result.revision, sourceToken: result.sourceToken }, enumerable: true, writable: true });
      diagnostics.push(...result.diagnostics ?? []);
    } });
    throwIfAborted(input.signal);
    const cells = plan.pages.reduce((sum, page) => sum + page.components.reduce((count, component) => count + cellCount(component), 0), 0);
    assertBudget(budget, "maxPages", plan.pages.length); assertBudget(budget, "maxCells", cells);
    return { plan, diagnostics, revisions, stats: { rows, pages: plan.pages.length, cells, durationMs: Date.now() - started } };
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
    let bytes: Uint8Array;
    if (input.format === "pdf") {
      throwIfAborted(input.signal);
      const result = await pdf!.renderPlanToPdf(prepared.plan, { ...input.pdf, ...(measurer ? { measurer } : {}) });
      bytes = result.bytes;
      prepared.diagnostics.push(...outputDiagnostics(result.diagnostics));
      prepared.diagnostics.push(...result.fidelityWarnings.map((message) => ({ code: "pdf-fidelity", message, severity: "warning" as const })), ...result.pageErrors.map((message) => ({ code: "pdf-page", message, severity: "error" as const })));
      if (result.unsupportedTextCount) prepared.diagnostics.push({ code: "pdf-font", message: `${result.unsupportedTextCount} 段文本包含当前字体不支持的字符`, severity: "warning" });
    } else {
      const { renderPlanToXlsx } = await import("@agile-team/mach-report/xlsx");
      throwIfAborted(input.signal);
      const result = await renderPlanToXlsx(prepared.plan, input.xlsx);
      bytes = new Uint8Array(result.buffer);
      prepared.diagnostics.push(...outputDiagnostics(result.diagnostics));
      prepared.diagnostics.push(...result.warnings.map((message) => ({ code: "xlsx-fidelity", message, severity: "warning" as const })));
    }
    throwIfAborted(input.signal);
    assertBudget(budget, "maxOutputBytes", bytes.byteLength);
    const { plan: _plan, ...result } = prepared;
    return { ...result, bytes, format: input.format, contentType: input.format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", stats: { ...result.stats, durationMs: Date.now() - started, outputBytes: bytes.byteLength } };
  };
  return {
    describe: (ids) => describe(options.reports, ids),
    validate: (input) => validateInput(options.reports, input),
    prepare: (input) => controlled(input.signal, budget.maxDurationMs, async (signal) => {
      const { signal: _signal, ...request } = input;
      assertInput(options, request);
      const result = options.executor ? await options.executor.prepare(request, signal) : await localPrepare({ ...request, signal });
      return enforcePrepared(result, budget);
    }),
    export: (input) => controlled(input.signal, budget.maxDurationMs, async (signal) => {
      const { signal: _signal, ...request } = input;
      assertInput(options, request);
      if (request.format !== "pdf" && request.format !== "xlsx") throw new ReportSourceError("config", "不支持的报表导出格式");
      const result = options.executor ? await options.executor.export(request, signal) : await localExport({ ...request, signal });
      assertBudget(budget, "maxRows", result.stats.rows); assertBudget(budget, "maxPages", result.stats.pages); assertBudget(budget, "maxCells", result.stats.cells);
      assertBudget(budget, "maxOutputBytes", result.bytes.byteLength);
      return { ...result, stats: { ...result.stats, outputBytes: result.bytes.byteLength } };
    })
  };
}
