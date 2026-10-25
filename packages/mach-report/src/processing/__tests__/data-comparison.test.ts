// @vitest-environment node
import { describe, expect, it } from "vitest";
import { compareReportData, type ReportDataComparisonOptions } from "../data-comparison";
import { dataLimit, dataRowKey, indexDataRecords, type ReportDataSnapshot } from "../data-records";
function snapshot(rows: ReportDataSnapshot["rows"]): ReportDataSnapshot { return { datasetId: "production", sourceScope: "plant", rows }; }
const options: ReportDataComparisonOptions = { fields: [{ field: "weight", type: "decimal", label: "重量" }, { field: "grade" }] };
describe("stable business dataset comparison", () => {
  it("compares reordered keys and added/removed rows, not physical row numbers", () => {
    const result = compareReportData(snapshot([{ rowKey: "A", values: { weight: "10", grade: "S304" } }, { rowKey: "B", values: { weight: 3 } }, { rowKey: "D", values: { weight: 2 } }]), snapshot([{ rowKey: "C", values: { weight: 7 } }, { rowKey: "A", values: { weight: "11", grade: "S304" } }, { rowKey: "B", values: { weight: "3.000" } }]), options);
    expect(result.counts).toEqual({ added: 1, removed: 1, changed: 1, unchanged: 1, cells: 5 });
    expect(result.differences[0]).toMatchObject({ rowKey: "A", kind: "changed", field: "weight", delta: "1", changeRatio: "0.1" });
    expect(result.differences.filter(item => item.kind === "removed").every(item => item.rowKey === "D")).toBe(true);
  });
  it("subtracts huge decimals exactly and applies inclusive absolute tolerance", () => {
    const result = compareReportData(snapshot([{ rowKey: 1, values: { weight: "9007199254740993.001" } }]), snapshot([{ rowKey: 1, values: { weight: "9007199254740993.003" } }]), { fields: [{ field: "weight", type: "decimal", tolerance: "0.001" }] });
    expect(result.differences[0]!.delta).toBe("0.002");
    expect(compareReportData(snapshot([{ rowKey: 1, values: { weight: "1.001" } }]), snapshot([{ rowKey: 1, values: { weight: "1.002" } }]), { fields: [{ field: "weight", type: "decimal", tolerance: "0.001" }] }).counts.unchanged).toBe(1);
  });
  it("keeps identifiers/text exact, distinguishes numeric and string row keys and preserves zero", () => {
    const result = compareReportData(snapshot([{ rowKey: 1, values: { grade: "001" } }]), snapshot([{ rowKey: "1", values: { grade: "1" } }]), { fields: [{ field: "grade" }] });
    expect(result.counts).toMatchObject({ added: 1, removed: 1, changed: 0 });
    expect(compareReportData(snapshot([{ rowKey: "A", values: { weight: 0 } }]), snapshot([{ rowKey: "A", values: { weight: null } }]), options).differences[0]).toMatchObject({ before: 0, after: null, ratioUnavailable: "missing" });
  });
  it("makes missing-value and zero-denominator policies explicit", () => {
    const left = snapshot([{ rowKey: "A", values: { weight: null } }]), right = snapshot([{ rowKey: "A", values: { weight: "" } }]);
    expect(compareReportData(left, right, { fields: [{ field: "weight", type: "decimal" }] }).counts.changed).toBe(1);
    expect(compareReportData(left, right, { fields: [{ field: "weight", type: "decimal", missing: "empty-equivalent" }] }).counts.unchanged).toBe(1);
    expect(compareReportData(left, snapshot([{ rowKey: "A", values: { weight: 5 } }]), { fields: [{ field: "weight", type: "decimal", missing: "zero" }] }).differences[0]).toMatchObject({ delta: "5", ratioUnavailable: "zero-denominator" });
    expect(compareReportData(snapshot([]), snapshot([{ rowKey: "A", values: { weight: "0" } }]), { fields: [{ field: "weight", type: "decimal", missing: "zero", zeroDenominator: "zero-if-equal" }] }).differences[0]!.changeRatio).toBe("0");
  });
  it("refuses wrong datasets, ambiguous keys, invalid numbers and oversized differences", () => {
    expect(() => compareReportData(snapshot([]), { datasetId: "other", rows: [] }, options)).toThrow("same business");
    expect(() => compareReportData(snapshot([{ rowKey: "A", values: {} }, { rowKey: "A", values: {} }]), snapshot([]), options)).toThrow("Duplicate");
    expect(() => compareReportData(snapshot([{ rowKey: "A", values: { weight: false } }]), snapshot([]), options)).toThrow("十进制");
    expect(() => compareReportData(snapshot([]), snapshot([{ rowKey: "A", values: {} }]), { ...options, maxDifferences: 1 })).toThrow("budget");
    expect(() => compareReportData(snapshot([]), snapshot([]), { fields: [] })).toThrow("allowlist");
    expect(() => compareReportData(snapshot([]), snapshot([]), { fields: [{ field: "a", type: "decimal", tolerance: "-1" }] })).toThrow("Tolerance");
    expect(() => compareReportData(snapshot([]), snapshot([]), { fields: [{ field: "a", ratioDigits: 101 }] })).toThrow("precision");
    expect(() => compareReportData(snapshot([]), snapshot([]), { fields: [{ field: "a", missing: "zero" }] })).toThrow("requires");
  });
  it("validates and copies own scalar data without invoking value accessors", () => {
    let invoked = false;
    const values = Object.defineProperty({}, "weight", { get() { invoked = true; return 2; } });
    expect(() => indexDataRecords([{ rowKey: "A", values }], ["weight"])).toThrow("scalar");
    expect(invoked).toBe(false);
    expect(() => indexDataRecords([{ rowKey: "A", values: { weight: NaN } }], ["weight"])).toThrow("finite");
    expect(() => indexDataRecords([{ rowKey: "A", values: {} }], ["weight"], { maxRows: 0 })).toThrow("budget");
    expect(() => dataRowKey(Number.MAX_SAFE_INTEGER + 1)).toThrow("stable");
    expect(() => dataRowKey("")).toThrow("stable");
    expect(() => dataLimit(1.5, 100, 200)).toThrow("budget");
    expect(() => compareReportData({ datasetId: "", rows: [] }, snapshot([]), options)).toThrow("dataset");
  });
  it("does not invoke record/key/value getters or overridden array iterators", () => {
    let invoked = 0;
    const getterRow = Object.defineProperty({ values: {} }, "rowKey", { get() { invoked++; return "A"; } });
    expect(() => indexDataRecords([getterRow as never], ["weight"])).toThrow("own scalar");
    const rows = [{ rowKey: "A", values: { weight: 1 } }];
    Object.defineProperty(rows, Symbol.iterator, { value() { invoked++; throw new Error("untrusted iterator"); } });
    expect(indexDataRecords(rows, ["weight"]).size).toBe(1);
    const sparse = Array(1); expect(() => indexDataRecords(sparse, ["weight"])).toThrow("Sparse");
    expect(invoked).toBe(0);
  });
  it("compares a large reordered unchanged dataset within a bounded linear workload", () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => ({ rowKey: `R${index}`, values: { weight: `${index}.001`, grade: "S304" } }));
    const result = compareReportData(snapshot(rows), snapshot([...rows].reverse()), options);
    expect(result.counts).toEqual({ added: 0, removed: 0, changed: 0, unchanged: 10_000, cells: 0 });
    expect(() => compareReportData(snapshot(rows), snapshot(rows), { ...options, maxRows: 100 })).toThrow("budget");
  });

});
