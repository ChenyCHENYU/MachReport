// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import * as expressions from "../processing/expressions";
import { computeDataset, type ComputedField } from "../processing/computed";
import { registerComputedDataset, forkComputedDataset } from "../processing/computation-workspace";
import { createTableTemplate } from "../builder/table-template";
import { createReportEditSession } from "../editing/session";
import { createReportCellEditBatch } from "../editing/batch";
import type { RenderPlan } from "../schema/render-plan";

const fields: ComputedField[] = [
  { field: "amount", expression: { op: "multiply", args: [{ field: "qty" }, { field: "price" }] } },
  { field: "double", expression: { op: "multiply", args: [{ field: "amount" }, { value: 2 }] } },
  { field: "fee", expression: { op: "multiply", args: [{ field: "price" }, { value: 0.1 }] } },
];
function evaluationCounter() {
  let count = 0;
  const original = expressions.compileReportExpression;
  const spy = vi.spyOn(expressions, "compileReportExpression").mockImplementation((...args) => {
    const read = original(...args);
    return (context) => { count++; return read(context); };
  });
  return { get count() { return count; }, reset() { count = 0; }, stop() { spy.mockRestore(); } };
}
function edit(plan: RenderPlan, id: number, value: number) {
  for (const [pageIndex, page] of plan.pages.entries()) for (const [componentIndex, component] of page.components.entries()) {
    if (component.table?.role !== "body" || component.table.source?.rowKey !== id) continue;
    return createReportCellEditBatch(plan, [{ address: { pageIndex, componentIndex, rowIndex: 0, columnIndex: component.table.columnKeys.indexOf("qty") }, value }], `qty-${id}-${value}`);
  }
  throw new Error("missing source row");
}

describe("owned incremental computation", () => {
  it("runs the real edit DAG only for changed dependencies after the first transaction, including undo/redo", async () => {
    const template = createTableTemplate({ columns: ["id", "qty", "price", "amount", "double", "fee"].map(field => ({ field, header: field, valueType: "number" as const })), listOptions: { rowKey: "id", computed: fields } });
    const datasets = { detail: Array.from({ length: 200 }, (_, id) => ({ id, qty: 2, price: 5 })) };
    const counter = evaluationCounter();
    try {
      const session = createReportEditSession({ template, datasets });
      counter.reset();
      const first = (await session.prepare(session.plan, edit(session.plan, 0, 3))).commit();
      expect(counter.count).toBe(600); // Establish the private baseline; public input is never cached.
      counter.reset();
      const batch = edit(first, 1, 4), prepared = await session.prepare(first, batch);
      expect(counter.count).toBe(2); // amount + double, no other row and no independent fee.
      expect(session.plan).toBe(first);
      const next = prepared.commit();
      counter.reset();
      const undo = await session.prepareHistory(next, batch.edits, "previousValue", "undo");
      expect(counter.count).toBe(2);
      const restored = undo.prepared.commit(); counter.reset();
      (await session.prepareHistory(restored, batch.edits, "value", "redo")).prepared.commit();
      expect(counter.count).toBe(2);
      expect(datasets.detail[1]!.qty).toBe(2);
    } finally { counter.stop(); }
  });

  it("isolates failed/stale candidates and does not reuse a rejected candidate's results", () => {
    const source = [{ qty: 2, price: 5 }]; registerComputedDataset(source);
    const counter = evaluationCounter();
    try {
      const initial = computeDataset(source, { fields });
      const failed = [{ qty: 3, price: 5 }]; forkComputedDataset(source, failed);
      const accepted = [{ qty: 4, price: 5 }]; forkComputedDataset(source, accepted);
      expect(computeDataset(failed, { fields }).rows[0]!.amount).toBe(15);
      counter.reset();
      expect(computeDataset(source, { fields }).rows).toEqual(initial.rows);
      expect(counter.count).toBe(0);
      expect(computeDataset(accepted, { fields }).rows[0]!.double).toBe(40);
      expect(counter.count).toBe(2);
    } finally { counter.stop(); }
  });

  it("rebuilds group/dataset passes and downstream row fields when aggregate inputs or group membership change", () => {
    const definitions: ComputedField[] = [
      { field: "groupQty", scope: "group", groupBy: ["group"], expression: { aggregate: "sum", field: "qty" } },
      { field: "allQty", scope: "dataset", expression: { aggregate: "sum", field: "qty" } },
      { field: "groupDouble", expression: { op: "multiply", args: [{ field: "groupQty" }, { value: 2 }] } },
    ];
    const source = [{ group: "A", qty: 2 }, { group: "A", qty: 3 }, { group: "B", qty: 0 }]; registerComputedDataset(source);
    computeDataset(source, { fields: definitions });
    const next = [{ group: "B", qty: 4 }, source[1]!, source[2]!]; forkComputedDataset(source, next);
    const result = computeDataset(next, { fields: definitions }).rows;
    expect(result.map(row => [row.groupQty, row.allQty, row.groupDouble])).toEqual([[4, 7, 8], [3, 7, 6], [4, 7, 8]]);
  });

  it("keeps public mutable data, adapter row positions, null/zero/error mode and decimal rules exact", () => {
    const publicRows = [{ qty: 2, price: 5 }];
    computeDataset(publicRows, { fields }); publicRows[0]!.qty = 0;
    expect(computeDataset(publicRows, { fields }).rows[0]!.amount).toBe(0);
    registerComputedDataset(publicRows);
    let calls = 0;
    const formula = { evaluate: (_expression: string, context: { rowIndex: number }) => { calls++; return context.rowIndex; } };
    const adapter: ComputedField[] = [{ field: "index", expression: "trusted", dependsOn: [] }];
    computeDataset(publicRows, { fields: adapter, formula }); computeDataset(publicRows, { fields: adapter, formula });
    expect(calls).toBe(2);
    const invalid: ComputedField[] = [{ field: "invalid", expression: { op: "divide", args: [{ value: 1 }, { field: "qty" }] } }];
    expect(computeDataset(publicRows, { fields: invalid, onError: "null" }).issues).toHaveLength(1);
    expect(computeDataset(publicRows, { fields: invalid, onError: "null" }).issues).toHaveLength(1);
    expect(() => computeDataset(publicRows, { fields: invalid })).toThrow(/除以零/);
    const decimal: ComputedField[] = [{ field: "precise", numeric: "decimal", digits: 3, expression: { op: "multiply", args: [{ value: "0.1" }, { value: "0.2" }] } }];
    expect(computeDataset(publicRows, { fields: decimal }).rows[0]!.precise).toBe("0.020");
    decimal[0]!.digits = 2;
    expect(computeDataset(publicRows, { fields: decimal }).rows[0]!.precise).toBe("0.02");
  });

  it("bounds owned programs and never confuses nonfinite/negative-zero constants", () => {
    const rows = [{}]; registerComputedDataset(rows);
    for (let value = 0; value < 17; value++) computeDataset(rows, { fields: [{ field: "x", expression: { value } }] });
    const counter = evaluationCounter();
    try {
      computeDataset(rows, { fields: [{ field: "x", expression: { value: 0 } }] });
      expect(counter.count).toBe(1); // Evicted, rather than retaining unbounded revisions.
      expect(Object.is(computeDataset(rows, { fields: [{ field: "x", expression: { value: -0 } }] }).rows[0]!.x, -0)).toBe(true);
      expect(() => computeDataset(rows, { fields: [{ field: "x", expression: { value: { $negativeZero: true } } as never }] })).toThrow(/常量.*有限 JSON 标量/);
      computeDataset(rows, { fields: [{ field: "x", expression: { value: null } }] });
      expect(() => computeDataset(rows, { fields: [{ field: "x", expression: { value: NaN } }] })).toThrow(/有限/);
    } finally { counter.stop(); }
  });

  it("falls back to full evaluation instead of retaining oversized definition or dependency caches", () => {
    const rows = Array.from({ length: 5001 }, () => ({})); registerComputedDataset(rows);
    const wide: ComputedField[] = [{ field: "x", expression: { op: "add", args: Array.from({ length: 100 }, (_, index) => ({ field: `f${index}` })) } }];
    const counter = evaluationCounter();
    try {
      computeDataset(rows, { fields: wide }); counter.reset();
      expect(computeDataset(rows, { fields: wide }).rows[0]!.x).toBeNull();
      expect(counter.count).toBe(5001);
      const large: ComputedField[] = [{ field: "large", expression: { value: "x".repeat(1_100_000) } }];
      const one = [{}]; registerComputedDataset(one); counter.reset();
      computeDataset(one, { fields: large }); computeDataset(one, { fields: large });
      expect(counter.count).toBe(2);
    } finally { counter.stop(); }
  });
});
