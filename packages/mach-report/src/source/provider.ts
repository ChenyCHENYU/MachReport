import type { DatasetRows } from "../layout/paginate";
import type { ReportCellEdit } from "../editing/apply";
import type { ReportDefinition, ReportLoadContext } from "./report-source";
import type { ReportTemplateDocument, ReportTemplateSummary } from "./template-registry";
import type { ReportDataTarget, ReportValueState } from "./data-explanation";

export interface ReportDiagnostic {
  code: string; message: string; path?: string; severity: "warning" | "error" | "info";
  /** Optional explanation supplied by the business source, not inferred from blank cells. */
  valueState?: ReportValueState;
  target?: ReportDataTarget;
}
export interface ReportQueryResult {
  datasets: DatasetRows;
  revision?: string;
  sourceToken?: string;
  diagnostics?: ReportDiagnostic[];
}
export interface ReportSaveInput extends ReportLoadContext {
  requestId: string;
  expectedRevision?: string;
  sourceToken?: string;
  edits: readonly ReportCellEdit[];
  action?: "edit" | "undo" | "redo" | "restore";
}
export interface ReportSaveResult {
  revision: string;
  sourceToken?: string;
  conflicts?: Array<{ editIndex: number; code: string; message: string }>;
  diagnostics?: ReportDiagnostic[];
}
export interface ReportProviderExportInput extends ReportLoadContext { format: "pdf" | "xlsx" }
export interface ReportProviderExportResult { bytes: Uint8Array; contentType: string; fileName?: string; diagnostics?: ReportDiagnostic[] }
export interface ReportTemplateProvider {
  list(context: { signal?: AbortSignal }): Promise<ReportTemplateSummary[]>;
  get(id: string, context: { signal?: AbortSignal }): Promise<ReportTemplateDocument | undefined>;
}
/** 查询是唯一基础能力；权限、HTTP、数据库和事务都留在宿主适配器内。 */
export interface ReportProvider {
  query(context: ReportLoadContext): ReportQueryResult | Promise<ReportQueryResult>;
  save?(input: ReportSaveInput): ReportSaveResult | Promise<ReportSaveResult>;
  export?(input: ReportProviderExportInput): ReportProviderExportResult | Promise<ReportProviderExportResult>;
  templates?: ReportTemplateProvider;
}

export function createProviderReport(definition: Omit<ReportDefinition, "load" | "datasets"> & { provider: ReportProvider }): ReportDefinition {
  return definition;
}
