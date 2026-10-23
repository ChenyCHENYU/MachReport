/** Optional business explanations never replace raw data or schema validation. */
export type ReportValueState = "missing-source" | "not-applicable" | "not-calculable";
export interface ReportDataTarget {
  datasetId: string;
  field: string;
  rowKey?: string | number;
  /** Use table identity when the same dataset appears in several tables. */
  tableId?: string;
  /** Assigned by the source/runtime when several reports share dataset names. */
  reportScope?: string;
}

export function isReportDataTarget(value: unknown): value is ReportDataTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const target = value as Record<string, unknown>;
  const name = (input: unknown) => typeof input === "string" && input.trim().length > 0 && input.length <= 256;
  if (!name(target.datasetId) || !name(target.field)) return false;
  if (target.tableId !== undefined && !name(target.tableId)) return false;
  if (target.reportScope !== undefined && (typeof target.reportScope !== "string" || !target.reportScope.trim() || target.reportScope.length > 4096)) return false;
  if (target.rowKey === undefined) return true;
  return typeof target.rowKey === "string" ? target.rowKey.trim().length > 0 && target.rowKey.length <= 1024 : typeof target.rowKey === "number" && Number.isFinite(target.rowKey);
}
export function isReportValueState(value: unknown): value is ReportValueState {
  return value === "missing-source" || value === "not-applicable" || value === "not-calculable";
}
export function hasValidDataExplanation(value: { target?: unknown; valueState?: unknown }): boolean {
  if (value.target !== undefined && !isReportDataTarget(value.target)) return false;
  return value.valueState === undefined || (isReportValueState(value.valueState) && value.target !== undefined);
}
