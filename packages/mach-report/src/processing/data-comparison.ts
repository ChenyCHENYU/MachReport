import type { ReportCellValue } from "../editing/context";
import { addDecimal, compareDecimal, divideDecimal, parseDecimal, printDecimal, type DecimalValue } from "./decimal";
import { assertDataFields, assertDataSource, dataLimit, dataValue, indexDataRecords, ReportDataError, type ReportDataLimits, type ReportDataRecord, type ReportDataSnapshot } from "./data-records";

export interface ReportDataComparisonField {
  field: string;
  label?: string;
  /** Numeric comparison is explicit; identifiers containing digits stay text. */
  type?: "value" | "decimal";
  /** Absolute decimal tolerance, inclusive. No binary floating-point subtraction. */
  tolerance?: string;
  /** Fractional ratio digits. changeRatio is (after - before) / before, not a percent. */
  ratioDigits?: number;
  zeroDenominator?: "omit" | "zero-if-equal";
  missing?: "distinct" | "empty-equivalent" | "zero";
}
export interface ReportDataComparisonOptions extends ReportDataLimits {
  fields: readonly ReportDataComparisonField[];
  maxDifferences?: number;
}
export interface ReportDataDifference {
  rowKey: string | number;
  kind: "added" | "removed" | "changed";
  field: string;
  label: string;
  before: ReportCellValue | undefined;
  after: ReportCellValue | undefined;
  /** Exact base-ten difference. Undefined when either input is missing/non-numeric. */
  delta?: string;
  changeRatio?: string;
  ratioUnavailable?: "zero-denominator" | "missing";
}
export interface ReportDataComparison {
  sourceScope?: string;
  datasetId: string;
  differences: readonly ReportDataDifference[];
  counts: { added: number; removed: number; changed: number; unchanged: number; cells: number };
}
interface CompiledComparisonField extends ReportDataComparisonField { toleranceValue: DecimalValue }
function isEmpty(value: unknown): boolean { return value === undefined || value === null || value === ""; }
function decimalValue(value: ReportCellValue | undefined, field: ReportDataComparisonField): DecimalValue | undefined {
  if (isEmpty(value)) return field.missing === "zero" ? parseDecimal(0) : undefined;
  return parseDecimal(value);
}
function negate(value: DecimalValue): DecimalValue { return { coefficient: -value.coefficient, scale: value.scale }; }
function numericResult(before: ReportCellValue | undefined, after: ReportCellValue | undefined, field: CompiledComparisonField, includeEqualMetrics: boolean): { equal: boolean; delta?: string; changeRatio?: string; ratioUnavailable?: ReportDataDifference["ratioUnavailable"] } {
  const a = decimalValue(before, field), b = Object.is(before, after) ? a : decimalValue(after, field);
  if (!a || !b) return { equal: sameMissing(before, after, field), ratioUnavailable: "missing" };
  const delta = addDecimal(b, negate(a)), absolute = { ...delta, coefficient: delta.coefficient < 0n ? -delta.coefficient : delta.coefficient };
  const equal = compareDecimal(absolute, field.toleranceValue) <= 0;
  if (equal && !includeEqualMetrics) return { equal };
  if (a.coefficient === 0n) return { equal, delta: printDecimal(delta), ...(delta.coefficient === 0n && field.zeroDenominator === "zero-if-equal" ? { changeRatio: "0" } : { ratioUnavailable: "zero-denominator" as const }) };
  return { equal, delta: printDecimal(delta), changeRatio: printDecimal(divideDecimal(delta, a, field.ratioDigits ?? 12)) };
}
function sameMissing(before: ReportCellValue | undefined, after: ReportCellValue | undefined, field: ReportDataComparisonField): boolean {
  return field.missing === "empty-equivalent" && isEmpty(before) && isEmpty(after) || Object.is(before, after);
}
function validateFields(options: ReportDataComparisonOptions): CompiledComparisonField[] {
  assertDataFields(options.fields.map(field => field.field), dataLimit(options.maxFields, 256, 1024));
  for (const field of options.fields) {
    if (field.type !== undefined && !["decimal", "value"].includes(field.type)) throw new ReportDataError("value", "Invalid comparison field type");
    if (field.missing && !["distinct", "empty-equivalent", "zero"].includes(field.missing)) throw new ReportDataError("value", "Invalid missing-value policy");
    if (field.zeroDenominator && !["omit", "zero-if-equal"].includes(field.zeroDenominator)) throw new ReportDataError("value", "Invalid zero-denominator policy");
    if (field.missing === "zero" && field.type !== "decimal") throw new ReportDataError("value", "Zero missing-value policy requires a decimal field");
    if (field.tolerance !== undefined && (field.type !== "decimal" || compareDecimal(parseDecimal(field.tolerance), parseDecimal(0)) < 0)) throw new ReportDataError("value", "Tolerance requires a non-negative decimal");
    if (field.ratioDigits !== undefined && (!Number.isInteger(field.ratioDigits) || field.ratioDigits < 0 || field.ratioDigits > 100)) throw new ReportDataError("value", "Invalid ratio precision");
  }
  return options.fields.map(field => ({ ...field, toleranceValue: parseDecimal(field.tolerance ?? "0") }));
}
function compareRow(before: ReportDataRecord | undefined, after: ReportDataRecord | undefined, fields: readonly CompiledComparisonField[], target: ReportDataDifference[], max: number): boolean {
  let changed = false;
  for (const field of fields) {
    const left = before ? dataValue(before, field.field) : undefined, right = after ? dataValue(after, field.field) : undefined;
    const numeric = field.type === "decimal" ? numericResult(left, right, field, !before || !after) : { equal: sameMissing(left, right, field) };
    if (before && after && numeric.equal) continue;
    changed = true;
    if (target.length >= max) throw new ReportDataError("limit", "Report differences exceed their budget");
    const { equal: _equal, ...metrics } = numeric;
    target.push({ rowKey: (after ?? before)!.rowKey, kind: before ? after ? "changed" : "removed" : "added", field: field.field, label: field.label ?? field.field, before: left, after: right, ...metrics });
  }
  return changed;
}
/** Stable-key comparison of business data or instance snapshots. Never compares report coordinates. */
export function compareReportData(before: ReportDataSnapshot, after: ReportDataSnapshot, options: ReportDataComparisonOptions): ReportDataComparison {
  assertDataSource(before); assertDataSource(after); const compiledFields = validateFields(options);
  if (before.datasetId !== after.datasetId || before.sourceScope !== after.sourceScope) throw new ReportDataError("identity", "Comparison requires the same business dataset and source scope");
  const fields = options.fields.map(field => field.field), left = indexDataRecords(before.rows, fields, options), right = indexDataRecords(after.rows, fields, options);
  const max = dataLimit(options.maxDifferences, 20_000, 100_000), differences: ReportDataDifference[] = [];
  const counts = { added: 0, removed: 0, changed: 0, unchanged: 0, cells: 0 };
  for (const [key, row] of left) {
    const current = right.get(key);
    const changed = compareRow(row, current, compiledFields, differences, max);
    if (!current) counts.removed++; else if (changed) counts.changed++; else counts.unchanged++;
  }
  for (const [key, row] of right) if (!left.has(key)) { compareRow(undefined, row, compiledFields, differences, max); counts.added++; }
  counts.cells = differences.length;
  return { sourceScope: after.sourceScope, datasetId: after.datasetId, differences, counts };
}
