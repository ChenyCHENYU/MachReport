// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createCrossTable } from "../processing/cross-table";
import { createMatrixTable } from "../processing/matrix";

describe("shared pivot aggregation", () => {
  it("does not read measures for hidden row/column/grand totals", () => {
    let reads = 0;
    const rows = Array.from({ length: 200 }, (_, index) => ({ row: String(index % 4), column: "A", get value() { reads++; return "0.1"; } }));
    const result = createCrossTable(rows, { rowField: "row", columnField: "column", valueField: "value", aggregate: "sum", numeric: "decimal", totals: false });
    expect(reads).toBe(rows.length);
    expect(result.rows).toHaveLength(4); expect(result.rows[0]!.c0).toBe("5");
  });
  it("shares dimensions across measures and preserves exact weighted totals, null count and output order", () => {
    let dimensions = 0;
    const rows = [{ weight: "1", value: "0.1" }, { weight: "3", value: "0.3" }, { weight: "0", value: null }].map(row => ({ ...row,
      get plant() { dimensions++; return "YTS0"; }, get month() { dimensions++; return "2026-10"; },
    }));
    const result = createMatrixTable(rows, { rowFields: ["plant"], columnFields: ["month"], measures: [
      { field: "sum", valueField: "value", op: "sum", numeric: "decimal" },
      { field: "weighted", valueField: "value", weightField: "weight", op: "weightedAvg", numeric: "decimal", digits: 2 },
      { field: "count", valueField: "value", op: "count" },
    ], totals: true });
    expect(dimensions).toBe(rows.length * 4); // one cardinality + one accumulation pass, independent of measure count
    expect(result.columns.map(column => column.field)).toEqual(["rowLabel", "c0_0", "total_0", "c0_1", "total_1", "c0_2", "total_2"]);
    expect(result.rows).toEqual([
      { rowLabel: "YTS0", c0_0: "0.4", total_0: "0.4", c0_1: "0.25", total_1: "0.25", c0_2: 2, total_2: 2 },
      { rowLabel: "合计", c0_0: "0.4", total_0: "0.4", c0_1: "0.25", total_1: "0.25", c0_2: 2, total_2: 2 },
    ]);
  });
  it("rejects an expansion budget before reading measure payloads", () => {
    let reads = 0;
    const rows = Array.from({ length: 100 }, (_, index) => ({ row: index, column: index, get value() { reads++; return 1; } }));
    expect(() => createMatrixTable(rows, { rowFields: ["row"], columnFields: ["column"], measures: [{ field: "value", op: "sum" }], maxCells: 20 })).toThrow("预算");
    expect(reads).toBe(0);
  });
});
