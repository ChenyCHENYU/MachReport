import type { ReportCellValue } from "../editing/context";

/** A business record, never a physical report row index. */
export interface ReportDataRecord {
  rowKey: string | number;
  values: Readonly<Record<string, ReportCellValue>>;
}
export interface ReportDataSnapshot {
  sourceScope?: string;
  datasetId: string;
  rows: readonly ReportDataRecord[];
}
export interface ReportDataLimits { maxRows?: number; maxFields?: number; maxCells?: number }
export class ReportDataError extends Error {
  constructor(public readonly code: "identity" | "duplicate" | "limit" | "value" | "conflict", message: string) { super(message); this.name = "ReportDataError"; }
}
export function dataLimit(value: number | undefined, fallback: number, ceiling: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > ceiling) throw new ReportDataError("limit", "Invalid report data budget");
  return result;
}
export function dataRowKey(value: unknown): string {
  if (typeof value === "string" && value.length > 0 && value.length <= 2048) return `s:${value}`;
  if (typeof value === "number" && Number.isSafeInteger(value)) return `n:${Object.is(value, -0) ? 0 : value}`;
  throw new ReportDataError("identity", "A stable string or safe integer business key is required");
}
export function assertDataSource(source: Pick<ReportDataSnapshot, "sourceScope" | "datasetId">): void {
  if (typeof source.datasetId !== "string" || !source.datasetId.trim() || source.datasetId.length > 2048) throw new ReportDataError("identity", "A dataset identity is required");
  if (source.sourceScope !== undefined && (typeof source.sourceScope !== "string" || !source.sourceScope.trim() || source.sourceScope.length > 2048)) throw new ReportDataError("identity", "Invalid source scope");
}
export function assertDataFields(fields: readonly string[], maxFields = 256): void {
  if (!Array.isArray(fields) || !fields.length || fields.length > maxFields) throw new ReportDataError("limit", "A bounded explicit field allowlist is required");
  const seen = new Set<string>();
  for (const field of fields) {
    if (typeof field !== "string" || !field.trim() || field.length > 2048 || ["__proto__", "constructor", "prototype"].includes(field)) throw new ReportDataError("identity", "Invalid report field");
    if (seen.has(field)) throw new ReportDataError("duplicate", "Duplicate report field");
    seen.add(field);
  }
}
export function dataValue(record: ReportDataRecord, field: string): ReportCellValue | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(record.values, field);
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) throw new ReportDataError("value", "Report values must be plain scalar data");
  const value: unknown = descriptor.value;
  if (value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "number" && Number.isFinite(value)) return value;
  throw new ReportDataError("value", "Report values must be finite scalar data");
}
function recordData(input: unknown): ReportDataRecord {
  if (!input || typeof input !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new ReportDataError("value", "Report records must be plain data");
  const rowKey = Object.getOwnPropertyDescriptor(input, "rowKey"), values = Object.getOwnPropertyDescriptor(input, "values");
  if (!rowKey || !("value" in rowKey) || !values || !("value" in values) || !values.value || typeof values.value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(values.value))) throw new ReportDataError("value", "Report records require own scalar keys and plain values");
  return { rowKey: rowKey.value as string | number, values: values.value as ReportDataRecord["values"] };
}
/** Validate before allocation; copied scalars isolate an asynchronous preview from loader mutations. */
export function indexDataRecords(rows: readonly ReportDataRecord[], fields: readonly string[], limits: ReportDataLimits = {}): Map<string, ReportDataRecord> {
  const maxRows = dataLimit(limits.maxRows, 50_000, 100_000), maxCells = dataLimit(limits.maxCells, 1_000_000, 2_000_000);
  if (!Array.isArray(rows) || Object.getPrototypeOf(rows) !== Array.prototype || rows.length > maxRows || rows.length * fields.length > maxCells) throw new ReportDataError("limit", "Report data exceeds its budget");
  const result = new Map<string, ReportDataRecord>();
  for (let index = 0; index < rows.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(rows, index);
    if (!descriptor || !("value" in descriptor)) throw new ReportDataError("value", "Sparse or accessor report records are unsupported");
    const row = recordData(descriptor.value);
    const key = dataRowKey(row.rowKey);
    if (result.has(key)) throw new ReportDataError("duplicate", "Duplicate business row key");
    const values: Record<string, ReportCellValue> = Object.create(null) as Record<string, ReportCellValue>;
    for (const field of fields) { const value = dataValue(row, field); if (value !== undefined) values[field] = value; }
    result.set(key, { rowKey: row.rowKey, values });
  }
  return result;
}
