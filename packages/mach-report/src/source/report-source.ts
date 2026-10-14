import { paginateTemplate, type DatasetRows, type PaginateOptions, type ReportParamDef, type ReportTemplate } from "../layout/paginate";
import { RENDER_PLAN_SCHEMA_VERSION, type RenderPlan } from "../schema/render-plan";
import { validateRenderPlan } from "../schema/validate";
import { getReportParamDefs } from "./report-params";
import { ReportTemplateError, validateReportTemplate } from "./template-registry";

/** 取数与排版共同使用的请求上下文；取消只影响本次调用。 */
export interface ReportLoadContext {
  reportId: string;
  params: Record<string, string>;
  signal?: AbortSignal;
}

export interface ReportFetchInput {
  reportIds: string[];
  params: Record<string, string>;
  signal?: AbortSignal;
  /** 本次分页与计划告警；未提供时使用数据源配置的告警通道。 */
  onWarning?: (message: string) => void;
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

/**
 * 框架无关的报表数据源：注册一次模板与取数，包内完成分页、校验、按 ID 顺序合并。
 * 不缓存业务结果、不推断接口包装、不自动重试；鉴权与完整数据范围由宿主决定。
 */
export function createReportSource(
  reports: ReportRegistry,
  options: { onWarning?: (message: string) => void } = {}
): ReportSource {
  function definitionFor(id: string): ReportDefinition {
    const definition = Object.prototype.hasOwnProperty.call(reports, id) ? reports[id] : undefined;
    if (!definition) throw new ReportSourceError("config", `未注册报表 ${id}`);
    return definition;
  }

  const source: ReportFetcher = async ({ reportIds, params, signal, onWarning }) => {
    checkAbort(signal);
    // 请求发起时锁定 IDs 与参数，异步加载期间宿主的响应式对象变化不改变本次报表口径。
    const requestedIds = [...reportIds];
    const requestedParams = { ...params };
    if (requestedIds.length === 0) throw new ReportSourceError("config", "缺少报表 ID");
    // 先检查所有 ID，避免到中途才发现未注册而发出不必要的业务请求。
    const definitions = requestedIds.map(definitionFor);
    const pages: RenderPlan["pages"] = [];
    const warnings: string[] = [];
    for (const [index, definition] of definitions.entries()) {
      checkAbort(signal);
      const reportId = requestedIds[index]!;
      const context: ReportLoadContext = { reportId, params: { ...requestedParams }, signal };
      let template: ReportTemplate;
      if (typeof definition.template === "function") {
        try {
          template = await cancellable(definition.template(context), signal);
          checkAbort(signal);
          const validation = validateReportTemplate(template);
          if (!validation.ok) {
            throw new ReportSourceError("validate", `报表 ${reportId} 模板校验失败：${validation.errors.slice(0, 3).map((error) => `${error.path}: ${error.message}`).join("; ")}`);
          }
          warnings.push(...validation.warnings.map((warning) => `${reportId}: ${warning.path}: ${warning.message}`));
        } catch (error) {
          if (signal?.aborted) throw abortError(signal);
          if (error instanceof ReportSourceError) throw error;
          if (error instanceof ReportTemplateError) throw new ReportSourceError("validate", `报表 ${reportId} 模板校验失败：${error.message}`, error);
          throw new ReportSourceError("fetch", `报表 ${reportId} 模板加载失败：${error instanceof Error ? error.message : String(error)}`, error);
        }
      } else template = definition.template;
      let data: DatasetRows;
      try {
        data = await cancellable(definition.load ? definition.load(context) : definition.datasets ?? {}, signal);
      } catch (error) {
        if (signal?.aborted) throw abortError(signal);
        if (error instanceof ReportSourceError) throw error;
        throw new ReportSourceError("fetch", `报表 ${reportId} 取数失败：${error instanceof Error ? error.message : String(error)}`, error);
      }
      checkAbort(signal);
      validateDatasets(data, reportId);
      let result;
      try {
        result = paginateTemplate(template, data, definition.pagination);
      } catch (error) {
        throw new ReportSourceError("validate", `报表 ${reportId} 排版失败：${error instanceof Error ? error.message : String(error)}`, error);
      }
      // 同一模板可被多个报表或重复 ID 使用；逻辑表身份仅在本次合并计划内唯一。
      // 只克隆带来源的组件，不改动宿主模板或数据。
      const tableIds = new Map<string, string>();
      const scopedTableId = (id: string): string => {
        let scoped = tableIds.get(id);
        if (scoped === undefined) { scoped = JSON.stringify([index, reportId, id]); tableIds.set(id, scoped); }
        return scoped;
      };
      for (const page of result.plan.pages) pages.push({
        ...page,
        components: page.components.map((component) => component.table ? {
          ...component,
          table: { ...component.table, id: scopedTableId(component.table.id) }
        } : component)
      });
      warnings.push(...result.warnings.map((message) => `${reportId}: ${message}`));
    }
    checkAbort(signal);
    const plan: RenderPlan = { schemaVersion: RENDER_PLAN_SCHEMA_VERSION, pages };
    const validation = validateRenderPlan(plan);
    if (!validation.ok) {
      throw new ReportSourceError("validate", `渲染计划校验失败：${validation.errors.slice(0, 3).map((error) => `${error.path}: ${error.message}`).join("; ")}`);
    }
    warnings.push(...validation.warnings.map((warning) => `${warning.path}: ${warning.message}`));
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
