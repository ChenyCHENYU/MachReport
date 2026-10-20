import { PaginateCellLimitError, PaginatePageLimitError, paginateTemplate, type DatasetRows, type PaginateOptions, type ReportParamDef, type ReportTemplate } from "../layout/paginate";
import { RENDER_PLAN_SCHEMA_VERSION, type PlanComponent, type RenderPlan } from "../schema/render-plan";
import { validateRenderPlan } from "../schema/validate";
import { getReportParamDefs } from "./report-params";
import { ReportTemplateError, validateReportTemplate } from "./template-registry";
import { templateRequiresRecalculation } from "../layout/template-calculations";
import { assertReportParams } from "./param-validation";
import { registerReportEditSession } from "../editing/session";
import { reflowReportTemplate } from "../editing/session-pagination";
import type { ReportEditSessionPart } from "../editing/session-data";
import { createReportTaskReporter, type ReportTaskMonitoring } from "./task-events";
import type { ReportProvider, ReportQueryResult } from "./provider";
import { validateDatasetRows, type DatasetContract, type DatasetValidationOptions } from "../schema/dataset";

/** 取数与排版共同使用的请求上下文；取消只影响本次调用。 */
export interface ReportLoadContext {
  reportId: string;
  params: Record<string, string>;
  signal?: AbortSignal;
}

export interface ReportFetchInput extends ReportTaskMonitoring {
  reportIds: string[];
  params: Record<string, string>;
  signal?: AbortSignal;
  /** 本次分页与计划告警；未提供时使用数据源配置的告警通道。 */
  onWarning?: (message: string) => void;
  onQueryResult?: (reportId: string, result: ReportQueryResult) => void;
}

/** 保持 Promise<RenderPlan> 契约；元数据为可选，旧业务 fetcher 无需改造。 */
export interface ReportFetcher {
  (input: ReportFetchInput): Promise<RenderPlan>;
  getParamDefs?: (reportIds: string[]) => ReportParamDef[];
}

export interface ReportSource extends ReportFetcher {
  getParamDefs(reportIds: string[]): ReportParamDef[];
}

export type ReportTemplateLoader = (context: ReportLoadContext) => ReportTemplate | Promise<ReportTemplate>;

export interface ReportDefinition {
  /** 静态模板或宿主提供的异步模板加载器；动态模板默认每次重新读取，不缓存版本。 */
  template: ReportTemplate | ReportTemplateLoader;
  /** 静态数据；load 存在时优先使用 load 的结果。 */
  datasets?: DatasetRows;
  load?: (context: ReportLoadContext) => DatasetRows | Promise<DatasetRows>;
  /** 可选统一适配器；load 存在时仍优先 load，兼容已有定义。 */
  provider?: ReportProvider;
  /** 可选业务数据契约；声明的数据集缺失或字段不合法时，在分页前给出结构化错误。 */
  dataSchema?: Record<string, DatasetContract>;
  dataValidation?: Pick<DatasetValidationOptions, "maxRows" | "maxCells" | "maxIssues">;
  /** 覆盖模板参数定义；动态模板应在此声明查询面板元数据，避免查询前先请求模板。 */
  params?: ReportParamDef[];
  pagination?: PaginateOptions;
}

export type ReportRegistry = Record<string, ReportDefinition>;

export interface ReportDefinitionOptions<TData> extends Omit<ReportDefinition, "load" | "datasets"> {
  load: (context: ReportLoadContext) => TData | Promise<TData>;
  mapData: (data: TData, context: ReportLoadContext) => DatasetRows;
}

/** 类型推导业务接口的响应，包内完成字段映射后交给同一分页流程。 */
export function defineReport<TData>(definition: ReportDefinitionOptions<TData>): ReportDefinition;
export function defineReport(definition: ReportDefinition): ReportDefinition;
export function defineReport<TData>(definition: ReportDefinition | ReportDefinitionOptions<TData>): ReportDefinition {
  if (!("mapData" in definition)) return definition;
  const { load, mapData, ...rest } = definition;
  return { ...rest, load: async (context) => {
    const data = await load(context);
    checkAbort(context.signal);
    try {
      return mapData(data, context);
    } catch (error) {
      throw new ReportSourceError("validate", `报表 ${context.reportId} 数据映射失败`, error);
    }
  } };
}

export class ReportSourceError extends Error {
  readonly code: "config" | "fetch" | "validate";
  readonly cause?: unknown;

  constructor(code: ReportSourceError["code"], message: string, cause?: unknown) {
    super(message);
    this.name = "ReportSourceError";
    this.code = code;
    this.cause = cause;
  }
}

function abortError(signal: AbortSignal): Error {
  const error = new Error("报表加载已取消");
  error.name = "AbortError";
  Object.defineProperty(error, "cause", { value: signal.reason });
  return error;
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

/** 未消费 signal 的业务 loader 也不会在取消后继续排版或保持调用挂起。 */
function cancellable<T>(value: T | Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return Promise.resolve(value);
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => { cleanup(); reject(abortError(signal)); };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    Promise.resolve(value).then(
      (result) => { cleanup(); resolve(result); },
      (error) => { cleanup(); reject(error); }
    );
  });
}

function validateDatasets(value: unknown, reportId: string): asserts value is DatasetRows {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReportSourceError("validate", `报表 ${reportId} 的数据集应为对象`);
  }
  for (const [name, rows] of Object.entries(value)) {
    if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
      throw new ReportSourceError("validate", `报表 ${reportId} 的数据集 ${name} 应为对象数组`);
    }
  }
}

async function loadTemplate(loader: ReportTemplateLoader, context: ReportLoadContext, warnings: string[]): Promise<ReportTemplate> {
  const { reportId, signal } = context;
  try {
    const template = await cancellable(loader(context), signal);
    checkAbort(signal);
    const validation = validateReportTemplate(template);
    if (!validation.ok) {
      throw new ReportSourceError("validate", `报表 ${reportId} 模板校验失败：${validation.errors.slice(0, 3).map((error) => `${error.path}: ${error.message}`).join("; ")}`);
    }
    warnings.push(...validation.warnings.map((warning) => `${reportId}: ${warning.path}: ${warning.message}`));
    return template;
  } catch (error) {
    if (signal?.aborted) throw abortError(signal);
    if (error instanceof ReportSourceError) throw error;
    if (error instanceof ReportTemplateError) throw new ReportSourceError("validate", `报表 ${reportId} 模板校验失败：${error.message}`, error);
    throw new ReportSourceError("fetch", `报表 ${reportId} 模板加载失败：${error instanceof Error ? error.message : String(error)}`, error);
  }
}

async function loadDatasets(definition: ReportDefinition, context: ReportLoadContext, reportId: string, onResult?: ReportFetchInput["onQueryResult"]): Promise<DatasetRows> {
  const signal = context.signal;
  let data: DatasetRows;
  try {
    if (definition.load) data = await cancellable(definition.load(context), signal);
    else if (definition.provider) {
      const result = await cancellable(definition.provider.query(context), signal);
      checkAbort(signal);
      validateProviderResult(result, reportId);
      data = result.datasets;
      onResult?.(reportId, result);
    } else data = definition.datasets ?? {};
  } catch (error) {
    if (signal?.aborted) throw abortError(signal);
    if (error instanceof ReportSourceError) throw error;
    throw new ReportSourceError("fetch", `报表 ${reportId} 取数失败：${error instanceof Error ? error.message : String(error)}`, error);
  }
  checkAbort(signal);
  return data;
}

function validateProviderResult(result: ReportQueryResult, reportId: string): void {
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new ReportSourceError("validate", `报表 ${reportId} Provider 应返回 datasets 结果对象`);
  for (const key of ["revision", "sourceToken"] as const) {
    if (result[key] !== undefined && typeof result[key] !== "string") throw new ReportSourceError("validate", `报表 ${reportId} Provider ${key} 应为字符串`);
  }
  if (result.diagnostics !== undefined && (!Array.isArray(result.diagnostics) || result.diagnostics.some((entry) => !entry || typeof entry.code !== "string" || typeof entry.message !== "string" || !["info", "warning", "error"].includes(entry.severity)))) {
    throw new ReportSourceError("validate", `报表 ${reportId} Provider diagnostics 不符合结构化诊断契约`);
  }
}

function validateDataContract(definition: ReportDefinition, data: DatasetRows, reportId: string): void {
  for (const [name, contract] of Object.entries(definition.dataSchema ?? {})) {
    let validation: ReturnType<typeof validateDatasetRows>;
    try { validation = validateDatasetRows(Object.prototype.hasOwnProperty.call(data, name) ? data[name] : undefined, contract, { ...definition.dataValidation, path: `$.datasets.${name}` }); }
    catch (error) { throw new ReportSourceError("config", `报表 ${reportId} 数据集 ${name} 字段契约配置无效`, error); }
    if (!validation.ok) throw new ReportSourceError("validate", `报表 ${reportId} 数据集 ${name} 不符合字段契约：${validation.issues[0]?.message}`, { issues: validation.issues });
  }
}

interface SourcePaginationBudget { maxPages?: number; usedPages: number; maxCells?: number; usedCells: number }
function planCells(plan: RenderPlan): number {
  const count = (component: PlanComponent): number => component.grid?.cells.reduce((sum, row) => sum + row.reduce((size, cell) => size + (cell ? 1 + (cell.children?.reduce((total, child) => total + count(child), 0) ?? 0) : 0), 0), 0) ?? 0;
  return plan.pages.reduce((sum, page) => sum + page.components.reduce((size, component) => size + count(component), 0), 0);
}
function sourcePagination(options: PaginateOptions | undefined, pages: number | undefined, cells: number | undefined, signal?: AbortSignal): PaginateOptions {
  return { ...options, signal: signal ?? options?.signal,
    ...(pages === undefined ? {} : { maxPages: Math.max(1, Math.min(pages, options?.maxPages ?? pages)) }),
    ...(cells === undefined ? {} : { maxCells: Math.max(1, Math.min(cells, options?.maxCells ?? cells)) }) };
}
function paginateReport(template: ReportTemplate, data: DatasetRows, definition: ReportDefinition, reportId: string, budget: SourcePaginationBudget, signal?: AbortSignal): ReturnType<typeof paginateTemplate> & { cells: number } {
  const remainingPages = budget.maxPages === undefined ? undefined : budget.maxPages - budget.usedPages;
  const remainingCells = budget.maxCells === undefined ? undefined : budget.maxCells - budget.usedCells;
  try {
    if (remainingPages !== undefined && remainingPages < 1 && template.pages.length) throw new PaginatePageLimitError(0, 1);
    const pagination = sourcePagination(definition.pagination, remainingPages, remainingCells, signal);
    const result = paginateTemplate(template, data, pagination);
    const cells = planCells(result.plan);
    if (remainingCells !== undefined && cells > remainingCells) throw new PaginateCellLimitError(remainingCells, cells);
    return { ...result, cells };
  } catch (error) {
    let cause = error;
    if (error instanceof PaginatePageLimitError && budget.maxPages !== undefined && error.limit === remainingPages) cause = new PaginatePageLimitError(budget.maxPages, budget.usedPages + error.actual);
    if (error instanceof PaginateCellLimitError && budget.maxCells !== undefined) cause = new PaginateCellLimitError(budget.maxCells, budget.usedCells + error.actual);
    throw new ReportSourceError("validate", `报表 ${reportId} 排版失败：${cause instanceof Error ? cause.message : String(cause)}`, cause);
  }
}

/** 同一模板可被多个报表或重复 ID 使用；只克隆带来源组件，不改宿主模板或数据。 */
function appendTablePages(pages: RenderPlan["pages"], plan: RenderPlan, reportIndex: number, reportId: string): void {
  const tableIds = new Map<string, string>();
  const scopedTableId = (id: string): string => {
    let scoped = tableIds.get(id);
    if (scoped === undefined) { scoped = JSON.stringify([reportIndex, reportId, id]); tableIds.set(id, scoped); }
    return scoped;
  };
  for (const page of plan.pages) pages.push({
    ...page,
    components: page.components.map((component) => component.table ? {
      ...component,
      table: { ...component.table, id: scopedTableId(component.table.id) }
    } : component)
  });
}

/** Editing reuses the exact templates, limits and namespace order of the completed query. */
async function reflowSource(parts: readonly ReportEditSessionPart[], definitions: readonly ReportDefinition[], reportIds: readonly string[], limits: { maxPages?: number; maxCells?: number }, signal?: AbortSignal): Promise<RenderPlan> {
  const pages: RenderPlan["pages"] = [];
  let usedCells = 0;
  for (const [index, part] of parts.entries()) {
    checkAbort(signal);
    const remainingPages = limits.maxPages === undefined ? undefined : limits.maxPages - pages.length;
    const remainingCells = limits.maxCells === undefined ? undefined : limits.maxCells - usedCells;
    if (remainingPages !== undefined && remainingPages < 1 && part.template.pages.length) throw new PaginatePageLimitError(limits.maxPages!, pages.length + 1);
    const plan = await reflowReportTemplate(part.template, part.datasets, sourcePagination(definitions[index]?.pagination, remainingPages, remainingCells, signal));
    usedCells += planCells(plan);
    if (limits.maxCells !== undefined && usedCells > limits.maxCells) throw new PaginateCellLimitError(limits.maxCells, usedCells);
    appendTablePages(pages, plan, index, reportIds[index]!);
  }
  const plan = { schemaVersion: RENDER_PLAN_SCHEMA_VERSION, ...(parts.some((part) => templateRequiresRecalculation(part.template)) ? { requiresRecalculation: true } : {}), pages };
  const validation = validateRenderPlan(plan);
  if (!validation.ok) throw new ReportSourceError("validate", `重算渲染计划校验失败：${validation.errors[0]?.message}`);
  return plan;
}

/**
 * 框架无关的报表数据源：注册一次模板与取数，包内完成分页、校验、按 ID 顺序合并。
 * 不缓存业务结果、不推断接口包装、不自动重试；鉴权与完整数据范围由宿主决定。
 */
export function createReportSource(
  reports: ReportRegistry,
  options: { onWarning?: (message: string) => void; onDatasets?: (reportId: string, datasets: DatasetRows, template: ReportTemplate) => void; maxPages?: number; maxCells?: number } = {}
): ReportSource {
  if (options.maxPages !== undefined && (!Number.isSafeInteger(options.maxPages) || options.maxPages < 1)) throw new ReportSourceError("config", "maxPages 应为正安全整数");
  if (options.maxCells !== undefined && (!Number.isSafeInteger(options.maxCells) || options.maxCells < 1)) throw new ReportSourceError("config", "maxCells 应为正安全整数");
  function definitionFor(id: string): ReportDefinition {
    const definition = Object.prototype.hasOwnProperty.call(reports, id) ? reports[id] : undefined;
    if (!definition) throw new ReportSourceError("config", `未注册报表 ${id}`);
    return definition;
  }

  const source: ReportFetcher = async ({ reportIds, params, signal, onWarning, onQueryResult, ...monitoring }) => {
    checkAbort(signal);
    const reporter = createReportTaskReporter({ ...monitoring, signal });
    // 请求发起时锁定 IDs 与参数，异步加载期间宿主的响应式对象变化不改变本次报表口径。
    const requestedIds = [...reportIds];
    const requestedParams = { ...params };
    if (requestedIds.length === 0) throw new ReportSourceError("config", "缺少报表 ID");
    // 先检查所有 ID，避免到中途才发现未注册而发出不必要的业务请求。
    const definitions = requestedIds.map(definitionFor);
    // 所有静态参数先校验；后一个报表参数非法时，也不会发出前一个数据请求。
    const declaredParams = reporter.runSync("validate", () => definitions.map((definition) => assertReportParams(
      definition.params ?? (typeof definition.template === "function" ? [] : definition.template.params) ?? [], requestedParams
    )));
    const pages: RenderPlan["pages"] = [];
    const editParts: ReportEditSessionPart[] = [];
    let usedCells = 0;
    const warnings: string[] = [];
    for (const [index, definition] of definitions.entries()) {
      checkAbort(signal);
      const reportId = requestedIds[index]!;
      const context: ReportLoadContext = { reportId, params: declaredParams[index]!, signal };
      const template = typeof definition.template === "function"
        ? await reporter.run("query", () => loadTemplate(definition.template as ReportTemplateLoader, context, warnings), reportId)
        : definition.template;
      context.params = reporter.runSync("validate", () => assertReportParams(definition.params ?? template.params ?? [], context.params), reportId);
      const data = await reporter.run("query", () => loadDatasets(definition, context, reportId, onQueryResult), reportId);
      reporter.runSync("validate", () => {
        validateDatasets(data, reportId);
        options.onDatasets?.(reportId, data, template);
        validateDataContract(definition, data, reportId);
      }, reportId);
      checkAbort(signal);
      const result = reporter.runSync("layout", () => paginateReport(template, data, definition, reportId, { maxPages: options.maxPages, usedPages: pages.length, maxCells: options.maxCells, usedCells }, signal), reportId);
      usedCells += result.cells;
      editParts.push({ template, datasets: data });
      appendTablePages(pages, result.plan, index, reportId);
      warnings.push(...result.warnings.map((message) => `${reportId}: ${message}`));
    }
    checkAbort(signal);
    const plan: RenderPlan = { schemaVersion: RENDER_PLAN_SCHEMA_VERSION, ...(editParts.some((part) => templateRequiresRecalculation(part.template)) ? { requiresRecalculation: true } : {}), pages };
    const validation = reporter.runSync("validate", () => {
      const result = validateRenderPlan(plan);
      if (!result.ok) throw new ReportSourceError("validate", `渲染计划校验失败：${result.errors.slice(0, 3).map((error) => `${error.path}: ${error.message}`).join("; ")}`);
      return result;
    });
    warnings.push(...validation.warnings.map((warning) => `${warning.path}: ${warning.message}`));
    const reflowDefinitions = definitions.map((definition) => ({ ...definition, pagination: { ...definition.pagination } }));
    const reflowLimits = { maxPages: options.maxPages, maxCells: options.maxCells };
    try { registerReportEditSession(plan, { parts: editParts, rebuild: (parts, editSignal) => reflowSource(parts, reflowDefinitions, requestedIds, reflowLimits, editSignal) }); }
    catch { warnings.push("来源数据无法建立本地重算口径；当前预览仅支持计划内编辑，请使用可序列化模板数据启用规则重算"); }
    const warn = onWarning ?? options.onWarning ?? ((message: string) => console.warn("[mach-report]", message));
    for (const message of warnings) {
      checkAbort(signal);
      warn(message);
    }
    checkAbort(signal);
    return plan;
  };
  // 多报表参数取有序并集；同名参数由首个报表定义，prop 可显式覆写。
  return Object.assign(source, {
    getParamDefs: (ids: string[]) => getReportParamDefs(reports, ids)
  });
}
