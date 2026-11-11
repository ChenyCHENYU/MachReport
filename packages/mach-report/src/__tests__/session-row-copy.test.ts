// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTableTemplate } from "../builder/table-template";
import { updateSessionRows, type ReportEditSessionPart, type SessionRow } from "../editing/session-data";
import { captureSessionGuard, snapshotSessionParts } from "../editing/session-snapshot";
import { computeDataset, type ComputedField } from "../processing/computed";
import * as expressions from "../processing/expressions";

afterEach(() => vi.restoreAllMocks());
const template = () => createTableTemplate({ columns: [{ field: "id", header: "ID" }], listOptions: { rowKey: "id" } });
function change(parts: readonly ReportEditSessionPart[], partIndex: number, dataset: string, rowIndex: number, field: string, value: unknown) {
  const row: SessionRow = { partIndex, dataset, rowIndex, row: parts[partIndex]!.datasets[dataset]![rowIndex]!, binding: { rowKey: "id" } };
  return { row, field, value };
}

describe("copy-on-write batch row updates", () => {
  it("isolates parts, datasets and row positions while preserving every untouched array and row", () => {
    const parts: ReportEditSessionPart[] = [
      { template: template(), datasets: { detail: [{ id: "1", qty: 1, note: "before" }, { id: "2", qty: 2 }], other: [{ id: "1", qty: 3 }], untouched: [{ id: "1", qty: 4 }] } },
      { template: template(), datasets: { detail: [{ id: "1", qty: 5 }, { id: "2", qty: 6 }] } },
      { template: template(), datasets: { detail: [{ id: "1", qty: 7 }] } },
    ];
    for (const part of parts) for (const rows of Object.values(part.datasets)) {
      rows.forEach(row => Object.freeze(row)); Object.freeze(rows);
    }
    const next = updateSessionRows(parts, [
      change(parts, 0, "detail", 0, "qty", 10), change(parts, 0, "detail", 0, "note", "after"),
      change(parts, 0, "detail", 0, "qty", 11), change(parts, 0, "other", 0, "qty", 30),
      change(parts, 1, "detail", 1, "qty", 60),
    ]);
    expect(next[0]!.datasets.detail![0]).toEqual({ id: "1", qty: 11, note: "after" });
    expect(next[0]!.datasets.other![0]).toEqual({ id: "1", qty: 30 });
    expect(next[1]!.datasets.detail![1]).toEqual({ id: "2", qty: 60 });
    expect(next[0]!.datasets.detail).not.toBe(parts[0]!.datasets.detail);
    expect(next[0]!.datasets.detail![0]).not.toBe(parts[0]!.datasets.detail![0]);
    expect(next[0]!.datasets.detail![1]).toBe(parts[0]!.datasets.detail![1]);
    expect(next[0]!.datasets.untouched).toBe(parts[0]!.datasets.untouched);
    expect(next[1]!.datasets.detail![0]).toBe(parts[1]!.datasets.detail![0]);
    expect(next[2]!.datasets.detail).toBe(parts[2]!.datasets.detail);
    expect(parts[0]!.datasets.detail![0]).toEqual({ id: "1", qty: 1, note: "before" });
    expect(parts[0]!.datasets.other![0]!.qty).toBe(3); expect(parts[1]!.datasets.detail![1]!.qty).toBe(6);
    expect(updateSessionRows(parts, [])[0]!.datasets.detail).toBe(parts[0]!.datasets.detail);
  });

  it("writes special names as ordinary own data and never invokes inherited setters", () => {
    const inherited = "__mach_report_batch_inherited__", marker = Symbol("copy-semantics"), setter = vi.fn(), getter = vi.fn(() => "inherited");
    Object.defineProperty(Object.prototype, inherited, { configurable: true, get: getter, set: setter });
    try {
      const row = Object.assign(Object.create(null) as Record<string, unknown>, { id: "1", constructor: "before" });
      Object.defineProperty(row, "fixed", { value: 1, enumerable: true, writable: false, configurable: false });
      // The internal helper retains normal spread semantics; public session guards
      // still reject symbol-bearing source rows before establishing ownership.
      Object.defineProperty(row, marker, { value: "retained", enumerable: true });
      const datasets = Object.fromEntries([["__proto__", [row]]]);
      const parts = [{ template: template(), datasets }];
      const next = updateSessionRows(parts, [
        change(parts, 0, "__proto__", 0, "__proto__", { injected: true }),
        change(parts, 0, "__proto__", 0, "constructor", false),
        change(parts, 0, "__proto__", 0, inherited, 0),
        change(parts, 0, "__proto__", 0, inherited, "last"),
        change(parts, 0, "__proto__", 0, "fixed", 2),
      ]);
      const updated = next[0]!.datasets.__proto__![0]!;
      expect(Object.getPrototypeOf(updated)).toBe(Object.prototype);
      expect(Object.getOwnPropertyDescriptor(updated, "__proto__")).toEqual({ value: { injected: true }, enumerable: true, configurable: true, writable: true });
      expect(Object.getOwnPropertyDescriptor(updated, inherited)).toEqual({ value: "last", enumerable: true, configurable: true, writable: true });
      expect(updated.constructor).toBe(false); expect(updated.fixed).toBe(2);
      expect(Object.getOwnPropertyDescriptor(updated, marker)).toEqual({ value: "retained", enumerable: true, configurable: true, writable: true });
      expect(setter).not.toHaveBeenCalled(); expect(getter).not.toHaveBeenCalled();
      expect(Object.prototype.hasOwnProperty.call(row, "__proto__")).toBe(false); expect(Object.prototype.hasOwnProperty.call(row, inherited)).toBe(false);
      expect(row.constructor).toBe("before"); expect(row.fixed).toBe(1);
      expect(Object.prototype.hasOwnProperty.call(Object.prototype, "injected")).toBe(false);
    } finally { delete (Object.prototype as Record<string, unknown>)[inherited]; }
  });

  it("preserves the 10000-field batch's order, values and original source without cascading row copies", () => {
    const fields = Array.from({ length: 10_000 }, (_, index) => `field_${index}`);
    const original = Object.fromEntries([["id", "1"], ...fields.map(field => [field, 0])]);
    const parts = [{ template: template(), datasets: { detail: [original] } }];
    const started = performance.now();
    const next = updateSessionRows(parts, fields.map((field, index) => change(parts, 0, "detail", 0, field, index)));
    const elapsed = performance.now() - started;
    const updated = next[0]!.datasets.detail![0]!;
    expect(Object.keys(updated)).toEqual(Object.keys(original));
    expect(fields.every((field, index) => updated[field] === index && original[field] === 0)).toBe(true);
    // The full supported batch must remain comfortably bounded. The old per-field
    // spread copies 100 million properties and exceeds this generous local budget.
    expect(elapsed).toBeLessThan(1000);
  });

  it("forks the final row values into computation caches without contaminating the baseline", () => {
    const definitions: ComputedField[] = [
      { field: "amount", expression: { op: "multiply", args: [{ field: "qty" }, { field: "price" }] } },
      { field: "double", expression: { op: "multiply", args: [{ field: "amount" }, { value: 2 }] } },
      { field: "fee", expression: { op: "multiply", args: [{ field: "price" }, { value: 0.1 }] } },
    ];
    const source = [{ template: template(), datasets: { detail: [{ id: "1", qty: 2, price: 5 }, { id: "2", qty: 2, price: 5 }] } }];
    const parts = snapshotSessionParts(source), rows = parts[0]!.datasets.detail!;
    let calls = 0;
    const compile = expressions.compileReportExpression;
    vi.spyOn(expressions, "compileReportExpression").mockImplementation((...args) => {
      const read = compile(...args); return context => { calls++; return read(context); };
    });
    const baseline = computeDataset(rows, { fields: definitions }); calls = 0;
    const next = updateSessionRows(parts, [change(parts, 0, "detail", 0, "qty", 3), change(parts, 0, "detail", 0, "price", 7), change(parts, 0, "detail", 1, "qty", 4)]);
    const computed = computeDataset(next[0]!.datasets.detail!, { fields: definitions });
    expect(computed.rows.map(row => [row.amount, row.double, row.fee])).toEqual([[21, 42, 0.7000000000000001], [20, 40, 0.5]]);
    expect(calls).toBe(5); calls = 0;
    expect(computeDataset(rows, { fields: definitions })).toEqual(baseline); expect(calls).toBe(0);
    expect(source[0]!.datasets.detail).toEqual([{ id: "1", qty: 2, price: 5 }, { id: "2", qty: 2, price: 5 }]);
  });

  it("does not relax the session ownership fence or execute source accessors", () => {
    const read = vi.fn(() => 1), row = { id: "1" };
    Object.defineProperty(row, "qty", { enumerable: true, get: read });
    expect(() => captureSessionGuard([{ template: template(), datasets: { detail: [row] } }])).toThrow("conflict");
    expect(read).not.toHaveBeenCalled();
    const symbolRow = { id: "1", [Symbol("host")]: 1 };
    expect(() => captureSessionGuard([{ template: template(), datasets: { detail: [symbolRow] } }])).toThrow("conflict");
  });
});
