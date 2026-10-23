import type { ReportTaskMonitoring, ReportTaskObserver } from "../source/task-events";
import type { ReportRegistry } from "../source/report-source";
import type { ReportDiagnostic } from "../source/provider";
import type { RenderPlan } from "../schema/render-plan";
import type { ReportParamValidation } from "../source/param-validation";
import type { PaginateOptions, ReportParamDef } from "../layout/paginate";
import type { AssetRenderOptions } from "../output/assets";

/** Licensed local font bytes; never downloaded implicitly by the runtime. */
export interface ReportPdfFontOptions {
  customFontBytes?: Uint8Array | ArrayBuffer;
  customFontName?: string;
  customFontFaces?: { regular: Uint8Array | ArrayBuffer; bold?: Uint8Array | ArrayBuffer; italic?: Uint8Array | ArrayBuffer; boldItalic?: Uint8Array | ArrayBuffer };
}
export interface ReportRuntimeInput extends ReportTaskMonitoring {
  reportIds: string[]; params?: Record<string, string>; signal?: AbortSignal;
  /** Prepare using the same licensed font bytes later supplied to PDF output. */
  pdf?: ReportPdfFontOptions;
}
export interface ReportRuntimeBudget {
  maxRows?: number;
  maxPages?: number;
  maxCells?: number;
  maxOutputBytes?: number;
  /** Bound the plain JSON snapshot accepted by exportPrepared (default 64 MB). */
  maxPreparedBytes?: number;
  maxDurationMs?: number;
}
export interface ReportRuntimeStats { rows: number; pages: number; cells: number; durationMs: number; outputBytes?: number }
/** One query occurrence; repeated report IDs retain independent provenance. */
export interface ReportRuntimeSource {
  reportId: string;
  reportIndex: number;
  reportScope: string;
  revision?: string;
  sourceToken?: string;
}
export interface PreparedReport {
  plan: RenderPlan;
  diagnostics: ReportDiagnostic[];
  stats: ReportRuntimeStats;
  revisions: Record<string, { revision?: string; sourceToken?: string }>;
  /** Ordered occurrences; legacy revisions remains last-value-by-ID for compatibility. */
  sources?: ReportRuntimeSource[];
  /** Captured metrics identity; absence on old saved instances remains supported with diagnostics. */
  layout?: { textMetrics: "heuristic" | "provided" | "font-bytes"; fontFingerprint?: string };
}
export interface ReportRuntimeExportInput extends ReportRuntimeInput {
  format: "pdf" | "xlsx";
  /** strict 在编码前拒绝已识别的输出降级；默认保留诊断并继续。 */
  fidelity?: "warn" | "strict";
  xlsx?: { sheetMode?: "auto" | "pages" | "continuous"; valueMode?: "text" | "raw"; paperSize?: "auto" | "a3" | "a4" | "a5" };
}
/** Encode an existing plan without querying providers or repaginating. */
export interface ReportRuntimePreparedExportInput extends ReportTaskMonitoring {
  prepared: PreparedReport;
  format: ReportRuntimeExportInput["format"];
  fidelity?: ReportRuntimeExportInput["fidelity"];
  pdf?: ReportPdfFontOptions;
  xlsx?: ReportRuntimeExportInput["xlsx"];
  signal?: AbortSignal;
}
export interface ReportRuntimeExportResult extends Omit<PreparedReport, "plan"> {
  bytes: Uint8Array;
  format: "pdf" | "xlsx";
  contentType: string;
}
/** 可用 worker_threads/进程/RPC 实现；接收可序列化请求，signal 由桥接层映射为取消消息。 */
export interface ReportRuntimeExecutor {
  /** Old custom executors may omit this; the runtime explicitly rejects unsupported prepared output. */
  exportPrepared?(input: Omit<ReportRuntimePreparedExportInput, "signal" | "onEvent">, signal?: AbortSignal, onEvent?: ReportTaskObserver): Promise<ReportRuntimeExportResult>;
  prepare(input: Omit<ReportRuntimeInput, "signal" | "onEvent">, signal?: AbortSignal, onEvent?: ReportTaskObserver): Promise<PreparedReport>;
  export(input: Omit<ReportRuntimeExportInput, "signal" | "onEvent">, signal?: AbortSignal, onEvent?: ReportTaskObserver): Promise<ReportRuntimeExportResult>;
}
export interface ReportRuntimeOptions {
  reports: ReportRegistry;
  /** Trusted local renderers, shared by preview preparation and export; configure inside an executor's runtime. */
  assets?: Omit<AssetRenderOptions, "signal">;
  budget?: ReportRuntimeBudget;
  /** 各定义可覆盖默认分页配置；PDF自带字体时，自动使用字体字节度量以保持排版与输出一致。 */
  pagination?: PaginateOptions;
  executor?: ReportRuntimeExecutor;
}
export interface ReportDescription {
  id: string;
  params: ReportParamDef[];
  paramsSchema: Record<string, unknown>;
  datasetsSchema: Record<string, Record<string, unknown>>;
  /** Provider 的可选远程能力；runtime 自身始终提供 PDF/XLSX 导出。 */
  capabilities: { save: boolean; export: boolean; templates: boolean };
}
export interface ReportRuntime {
  describe(reportIds?: string[]): ReportDescription[];
  validate(input: Omit<ReportRuntimeInput, "signal">): ReportParamValidation;
  prepare(input: ReportRuntimeInput): Promise<PreparedReport>;
  export(input: ReportRuntimeExportInput): Promise<ReportRuntimeExportResult>;
  exportPrepared(input: ReportRuntimePreparedExportInput): Promise<ReportRuntimeExportResult>;
}
