// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createMatrixTable, estimateMatrixTable, type MatrixDimensionValue, type MatrixTableOptions } from "../processing/matrix";
import { aggregateRows } from "../processing/aggregate";
import { addMatrixAxisRow, createMatrixAxis, matrixAxisKeys } from "../processing/matrix-axis";

function repeatedRows(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) => ({
    r0: `Plant${index % 2}`, r1: `Grade${index % 4}`, r2: index % 4, r3: index % 8,
    c0: 2026, c1: index % 2, c2: index % 3, c3: index % 6, value: index % 11,
  }));
}
function hierarchyOptions(): MatrixTableOptions {
  return { rowFields: ["r0", "r1", "r2", "r3"], columnFields: ["c0", "c1", "c2", "c3"], totals: true,
    measures: [{ field: "value", op: "sum" }], hierarchy: { row: { subtotals: [3, 1, 2] }, column: { subtotals: [2, 3, 1] } } };
}
function uniquePrefixes(rows: readonly Record<string, unknown>[], fields: readonly string[]): number {
  return new Set(rows.flatMap(row => fields.map((_, index) => JSON.stringify(fields.slice(0, index + 1).map(field => row[field]))))).size;
}
interface ReferenceMember { values: MatrixDimensionValue[]; kind: "member" | "subtotal" | "total" }
/** Deliberately scan the original samples per prefix; no production axis/index helpers. */
function referenceMembers(rows: readonly Record<string, unknown>[], fields: readonly string[], subtotals: readonly number[], sort: readonly string[]): ReferenceMember[] {
  const output: ReferenceMember[] = [];
  function visit(prefix: MatrixDimensionValue[], candidates: readonly Record<string, unknown>[]): void {
    if (prefix.length === fields.length) { output.push({ values: prefix, kind: "member" }); return; }
    const values: MatrixDimensionValue[] = [];
    for (const row of candidates) {
      const value = (row[fields[prefix.length]!] ?? null) as MatrixDimensionValue;
      if (!values.some(existing => existing === value)) values.push(value);
    }
    if (sort[prefix.length] !== "source") values.sort((left, right) => {
      const direction = sort[prefix.length] === "desc" ? -1 : 1;
      if (left === right) return 0;
      if (left === null || right === null) return (left === null ? -1 : 1) * direction;
      const difference = typeof left === "number" && typeof right === "number" ? left - right : `${typeof left}:${left}` < `${typeof right}:${right}` ? -1 : 1;
      return difference * direction;
    });
    for (const value of values) {
      const next = [...prefix, value];
      visit(next, candidates.filter(row => (row[fields[prefix.length]!] ?? null) === value));
      if (next.length < fields.length && subtotals.includes(next.length)) output.push({ values: next, kind: "subtotal" });
    }
  }
  visit([], rows);
  if (rows.length) output.push({ values: [], kind: "total" });
  return output;
}

describe("hierarchical matrix axis work", () => {
  it("serializes stable prefix identities per unique member, rather than per input row and pass", () => {
    const rows = repeatedRows(1024), options = hierarchyOptions();
    const expectedKeys = uniquePrefixes(rows, options.rowFields) + uniquePrefixes(rows, options.columnFields) + 2;
    let dimensionReads = 0;
    const input = rows.map(row => Object.fromEntries(Object.keys(row).map(field => [field, row[field]])));
    for (const row of input) for (const field of [...options.rowFields, ...options.columnFields]) {
      const value = row[field];
      Object.defineProperty(row, field, { enumerable: true, get: () => { dimensionReads++; return value; } });
    }
    const stringify = vi.spyOn(JSON, "stringify");
    let keyCount: number;
    try {
      const result = createMatrixTable(input, options);
      expect(result.rows.at(-1)!.total_0).toBe(rows.reduce((sum, row) => sum + Number(row.value), 0));
      keyCount = stringify.mock.calls.filter(([value]) => Array.isArray(value) && Array.isArray(value[0]) && value[0].every(field => typeof field === "string" && /^[rc]\d$/.test(field)) && Array.isArray(value[1])).length;
    } finally { stringify.mockRestore(); }
    expect(dimensionReads).toBe(input.length * 8 * 2);
    expect(keyCount).toBe(expectedKeys);
  });

  it("matches an independent full-sample reference for every leaf, prefix and grand-total cell", () => {
    const dimensions = [null, undefined, "", 0, -0, false, "0", "__proto__", "A / B"];
    const input = dimensions.flatMap((r0, index) => [0, 1, 2].map(n => ({
      r0, r1: n === 2 ? "B / C" : "C", r2: n % 2, c0: index % 2 ? 2026 : 2025, c1: n % 2, c2: n,
      value: n === 2 ? null : index + n, decimal: n === 2 ? null : index % 2 ? "0.1" : "0.2", weight: n + 1,
    })));
    const options: MatrixTableOptions = { rowFields: ["r0", "r1", "r2"], columnFields: ["c0", "c1", "c2"], totals: true,
      measures: [{ field: "value", op: "avg" }, { field: "weighted", valueField: "value", weightField: "weight", op: "weightedAvg" }, { field: "decimal", op: "sum", numeric: "decimal", digits: 3 }, { field: "count", valueField: "value", op: "count" }],
      hierarchy: { row: { subtotals: [2, 1], sort: ["asc", "desc", "source"] }, column: { subtotals: [1, 2], sort: ["desc", "asc", "source"] }, emptyLabel: "Missing", subtotalLabel: "Subtotal", totalLabel: "All" } };
    const result = createMatrixTable(input, options);
    const rowMembers = referenceMembers(input, options.rowFields, [2, 1], ["asc", "desc", "source"]);
    const columnMembers = referenceMembers(input, options.columnFields, [1, 2], ["desc", "asc", "source"]);
    expect(result.metadata!.rows.map(({ values, kind }) => ({ values, kind }))).toEqual(rowMembers);
    expect(result.metadata!.columns.map(({ values, kind, measure }) => ({ values, kind, measure }))).toEqual(columnMembers.flatMap(member => options.measures.map((_, measure) => ({ ...member, measure }))));
    const labels = (values: readonly MatrixDimensionValue[]) => values.map(value => value === null ? "Missing" : String(value));
    const expected = rowMembers.map(member => {
      const row: Record<string, unknown> = {};
      options.rowFields.forEach((_, index) => { row[`r${index}`] = member.kind === "total" ? index ? null : "All" : labels(member.values)[index] ?? (index === member.values.length ? "Subtotal" : null); });
      for (const column of result.metadata!.columns) {
        const samples = input.filter(sample => member.values.every((value, index) => (sample[options.rowFields[index] as keyof typeof sample] ?? null) === value)
          && column.values.every((value, index) => (sample[options.columnFields[index] as keyof typeof sample] ?? null) === value));
        const measure = options.measures[column.measure]!;
        row[column.field] = aggregateRows(samples, { ...measure, field: measure.valueField ?? measure.field });
      }
      return row;
    });
    expect(result.rows).toEqual(expected);
  });

  it("uses fresh dimensions on every public call and never attaches caches to source objects", () => {
    const first = Object.assign(Object.create(null) as Record<string, unknown>, { r: "__proto__", c: "x", value: 1 });
    const input = [first, first], options: MatrixTableOptions = { rowFields: ["r"], columnFields: ["c"], measures: [{ field: "value", op: "sum" }], hierarchy: {} };
    expect(createMatrixTable(input, options).rows).toEqual([{ r0: "__proto__", c0_0: 2 }]);
    first.r = "constructor"; first.c = "y"; first.value = 3;
    const result = createMatrixTable(input, options);
    expect(result.rows).toEqual([{ r0: "constructor", c0_0: 6 }]);
    expect(result.metadata!.columns[0]!.values).toEqual(["y"]);
    expect(Reflect.ownKeys(first)).toEqual(["r", "c", "value"]);
  });

  it("keeps shape and work budgets ahead of all measure reads with repeated and frozen inputs", () => {
    let measures = 0;
    const input = repeatedRows(128).map(row => Object.freeze({ ...row, get value() { measures++; throw new Error("must not read"); } }));
    const options = hierarchyOptions();
    expect(estimateMatrixTable(input, options).cells).toBeGreaterThan(0);
    for (const budget of [{ maxRows: 1 }, { maxColumns: 1 }, { maxCells: 1 }, { maxInputRows: 1 }, { maxAggregateUpdates: 1 }]) {
      expect(() => createMatrixTable(input, { ...options, ...budget })).toThrow(/预算/);
    }
    expect(measures).toBe(0);
  });

  it("retains only one prefix-key list per unique leaf even when source rows are repeated", () => {
    const rows = repeatedRows(4096), options = hierarchyOptions();
    const axis = createMatrixAxis(options.rowFields, options.hierarchy!.row, options.hierarchy!);
    for (const row of rows) addMatrixAxisRow(axis, row);
    const references = new Set(rows.map(row => matrixAxisKeys(axis, row, true)));
    expect(axis.leaves).toBe(8);
    expect(references.size).toBe(8);
    expect([...references].reduce((sum, keys) => sum + keys.length, 0)).toBe(40);
    const keys = matrixAxisKeys(axis, rows[0]!, true);
    expect(keys).toEqual([4, 3, 1, 2, 0].map(depth => JSON.stringify([options.rowFields.slice(0, depth), options.rowFields.slice(0, depth).map(field => [typeof rows[0]![field], rows[0]![field]])])));
  });

  it("preserves the first signed-zero member and rejects new dimensions after the budget pass", () => {
    const options: MatrixTableOptions = { rowFields: ["r"], columnFields: ["c"], measures: [{ field: "value", op: "sum" }], hierarchy: {} };
    const result = createMatrixTable([{ r: -0, c: "x", value: 1 }, { r: 0, c: "x", value: 2 }], options);
    expect(Object.is(result.metadata!.rows[0]!.values[0], -0)).toBe(true);
    expect(result.rows).toEqual([{ r0: "0", c0_0: 3 }]);
    let reads = 0, measures = 0;
    const unstable = { get r() { return reads++ ? "unbudgeted" : "initial"; }, c: "x", get value() { measures++; return 1; } };
    expect(() => createMatrixTable([unstable], options)).toThrow(/维度.*变化/);
    expect(measures).toBe(0);
  });
});
