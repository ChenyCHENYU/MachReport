import type { ReportRegistry } from "../source/report-source";
import type { ReportDiagnostic } from "../source/provider";
import type { RenderPlan } from "../schema/render-plan";
import type { ReportParamValidation } from "../source/param-validation";
import type { PaginateOptions, ReportParamDef } from "../layout/paginate";

export interface ReportRuntimeInput { reportIds: string[]; params?: Record<string, string>; signal?: AbortSignal }
export interface ReportRuntimeBudget {
  maxRows?: number;
  maxPages?: number;
  maxCells?: number;
  maxOutputBytes?: number;
  maxDurationMs?: number;
}
export interface ReportRuntimeStats { rows: number; pages: number; cells: number; durationMs: number; outputBytes?: number }
export interface PreparedReport {
  plan: RenderPlan;
  diagnostics: ReportDiagnostic[];
  stats: ReportRuntimeStats;
  revisions: Record<string, { revision?: string; sourceToken?: string }>;
}
export interface ReportRuntimeExportInput extends ReportRuntimeInput {
  format: "pdf" | "xlsx";
  /** PDF 中文需宿主显式提供有授权的字体；不隐式下载字体或资源。 */
  pdf?: {
    customFontBytes?: Uint8Array | ArrayBuffer;
    customFontName?: string;
    customFontFaces?: { regular: Uint8Array | ArrayBuffer; bold?: Uint8Array | ArrayBuffer; italic?: Uint8Array | ArrayBuffer; boldItalic?: Uint8Array | ArrayBuffer };
  };
  xlsx?: { sheetMode?: "auto" | "pages" | "continuous"; valueMode?: "text" | "raw"; paperSize?: "auto" | "a3" | "a4" | "a5" };
}
export interface ReportRuntimeExportResult extends Omit<PreparedReport, "plan"> {
  bytes: Uint8Array;
  format: "pdf" | "xlsx";
  contentType: string;
}
/** 可用 worker_threads/进程/RPC 实现；接收可序列化请求，signal 由桥接层映射为取消消息。 */
export interface ReportRuntimeExecutor {
  prepare(input: Omit<ReportRuntimeInput, "signal">, signal?: AbortSignal): Promise<PreparedReport>;
  export(input: Omit<ReportRuntimeExportInput, "signal">, signal?: AbortSignal): Promise<ReportRuntimeExportResult>;
}
export interface ReportRuntimeOptions {
  reports: ReportRegistry;
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
}
