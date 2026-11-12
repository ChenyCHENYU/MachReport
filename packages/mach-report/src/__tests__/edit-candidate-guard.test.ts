// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTableTemplate } from "../builder/table-template";
import { createReportCellEditBatch } from "../editing/batch";
import { getReportCellContext } from "../editing/context";
import { createReportEditSession, registerReportEditSession } from "../editing/session";
import * as snapshots from "../editing/session-snapshot";
import { paginateTemplate } from "../layout/paginate";
import type { GridCell, PlanComponent, RenderPlan } from "../schema/render-plan";

afterEach(() => vi.restoreAllMocks());
function fixture(computed = true) {
  const template = createTableTemplate({ columns: [
    { field: "id", header: "ID" }, { field: "qty", header: "Quantity", valueType: "number" },
    { field: "price", header: "Price", valueType: "number" }, { field: "amount", header: "Amount", valueType: "number" },
    { field: "note", header: "Note" }
  ], listOptions: { rowKey: "id", ...(computed ? { computed: [{ field: "amount", expression: { op: "multiply" as const, args: [{ field: "qty" }, { field: "price" }] } }] } : {}) } });
  return { template, datasets: { detail: [{ id: "1", qty: 2, price: 3, note: "before" }, { id: "2", qty: 1, price: 4, note: "other" }] } };
}
function context(plan: RenderPlan, field: string, key = "1") {
  for (const [pageIndex, page] of plan.pages.entries()) for (const [componentIndex, component] of page.components.entries()) {
    if (component.table?.role !== "body" || component.table.source?.rowKey !== key) continue;
    return getReportCellContext(plan, { pageIndex, componentIndex, rowIndex: 0, columnIndex: component.table.columnKeys.indexOf(field) })!;
  }
  throw new Error("Missing cell");
}
function batch(plan: RenderPlan, field = "qty", value: string | number = 5) {
  return createReportCellEditBatch(plan, [{ address: context(plan, field).address, value }], "candidate");
}
function mutableComponent(plan: RenderPlan, field: string): PlanComponent {
  const address = context(plan, field).address;
  return plan.pages[address.pageIndex]!.components[address.componentIndex]!;
}
function mutableCell(plan: RenderPlan, field: string): GridCell {
  const address = context(plan, field).address;
  return mutableComponent(plan, field).grid!.cells[address.rowIndex]![address.columnIndex]!;
}
const validation = { rules: [{ id: "amount-cap", field: "amount", assert: { field: "amount", op: "<=" as const, value: 100 }, message: "amount exceeds cap" }] };

describe("prepared edit plan consistency", () => {
  it("detaches dates and scalar values while retaining repeated styles inside the preview", () => {
    const input = fixture(false), plan = paginateTemplate(input.template, input.datasets).plan;
    const date = new Date("2026-11-12T00:00:00Z");
    plan.pages[0]!.meta = { first: date, second: date, zero: -0, id: "0001", missing: undefined };
    const copy = snapshots.snapshotCandidatePlan(plan), meta = copy.pages[0]!.meta!;
    expect(meta.first).not.toBe(date); expect(meta.first).toBe(meta.second);
    expect((meta.first as Date).getTime()).toBe(date.getTime());
    (meta.first as Date).setTime(0); expect(date.getTime()).not.toBe(0);
    expect(Object.is(meta.zero, -0)).toBe(true); expect(meta.id).toBe("0001");
    expect(Object.prototype.hasOwnProperty.call(meta, "missing")).toBe(true);
    expect(context(copy, "note").cell.style).toBe(context(copy, "note", "2").cell.style);
    expect(context(copy, "note").cell.style).not.toBe(context(plan, "note").cell.style);
  });

  it.each(["before-validation", "after-validation"])("rejects modified computed values %s and leaves the session retryable", async when => {
    const input = fixture(), session = createReportEditSession(input), initial = session.plan;
    const change = batch(initial), prepared = await session.prepare(initial, change);
    const amount = context(prepared.plan, "amount");
    expect(amount.value).toBe(15);
    if (when === "after-validation") expect(prepared.validate(validation)).toEqual([]);
    mutableCell(prepared.plan, "amount").value = 999; mutableCell(prepared.plan, "amount").text = "999";
    if (when === "before-validation") expect(() => prepared.validate(validation)).toThrow("conflict");
    expect(() => prepared.commit({ revision: "2" })).toThrow("conflict");
    expect(session.plan).toBe(initial); expect(input.datasets.detail[0]!.qty).toBe(2);
    const retry = (await session.prepare(initial, change)).commit({ revision: "2", sourceToken: "new" });
    expect(context(retry, "qty").value).toBe(5); expect(context(retry, "amount").value).toBe(15);
    expect(context(retry, "qty").source).toMatchObject({ revision: "2", sourceToken: "new" });
  });

  it.each(["source", "geometry", "accessor"])("rejects candidate %s changes without executing getters", async kind => {
    const session = createReportEditSession(fixture()), initial = session.plan;
    const prepared = await session.prepare(initial, batch(initial)), candidate = prepared.plan;
    const amount = context(candidate, "amount"), read = vi.fn(() => 999);
    if (kind === "source") mutableComponent(candidate, "qty").table!.source!.rowKey = "another";
    if (kind === "geometry") mutableComponent(candidate, "amount").heightMm += 1;
    if (kind === "accessor") Object.defineProperty(amount.cell, "value", { configurable: true, enumerable: true, get: read });
    expect(() => prepared.commit()).toThrow("conflict"); expect(read).not.toHaveBeenCalled();
    expect(session.plan).toBe(initial);
  });

  it("detaches exposed local patches from current rows while preserving internal geometry sharing", async () => {
    const session = createReportEditSession(fixture(false)), initial = session.plan;
    const prepared = await session.prepare(initial, batch(initial, "note", "after")), candidate = prepared.plan;
    expect(context(candidate, "note", "2").component).not.toBe(context(initial, "note", "2").component);
    expect(context(candidate, "note", "2").component).toEqual(context(initial, "note", "2").component);
    const other = context(candidate, "note", "2").address;
    candidate.pages[other.pageIndex]!.components[other.componentIndex]!.grid!.cells[0]![other.columnIndex]!.text = "changed preview";
    expect(context(initial, "note", "2").cell.text).toBe("other");
    mutableCell(candidate, "note").text = "not the saved value";
    expect(() => prepared.commit()).toThrow("conflict"); expect(session.plan).toBe(initial);
  });

  it("publishes untouched private geometry instead of the detached preview", async () => {
    const session = createReportEditSession(fixture(false)), initial = session.plan;
    const prepared = await session.prepare(initial, batch(initial, "note", "after")), preview = prepared.plan;
    const committed = prepared.commit();
    expect(committed).not.toBe(preview); expect(committed).toEqual(preview);
    expect(context(committed, "note", "2").component).toBe(context(initial, "note", "2").component);
    expect(context(committed, "note").cell.style).toBe(context(initial, "note").cell.style);
  });

  it("keeps unexposed built-in candidates private without adding a full-plan capture", async () => {
    const session = createReportEditSession(fixture()), initial = session.plan;
    const capture = vi.spyOn(snapshots, "capturePlanGuard");
    const prepared = await session.prepare(initial, batch(initial));
    expect(prepared.validate(validation)).toEqual([]);
    const committed = prepared.commit();
    expect(capture).not.toHaveBeenCalled(); expect(context(committed, "amount").value).toBe(15);
  });

  it("captures an exposed owned candidate once and retains immutable raw strings by value", async () => {
    const session = createReportEditSession(fixture()), initial = session.plan;
    const capture = vi.spyOn(snapshots, "capturePlanGuard");
    const prepared = await session.prepare(initial, batch(initial));
    const first = prepared.plan;
    expect(prepared.plan).toBe(first); expect(capture).toHaveBeenCalledTimes(1);
    expect(prepared.validate(validation)).toEqual([]);
    expect(context(prepared.commit(), "amount").value).toBe(15);
  });

  it("fences custom rebuild results even before their public plan getter is used", async () => {
    const input = fixture(), initial = paginateTemplate(input.template, input.datasets).plan;
    let retained: RenderPlan | undefined;
    const session = registerReportEditSession(initial, { parts: [input], rebuild: async parts => {
      retained = paginateTemplate(parts[0]!.template, parts[0]!.datasets).plan; return retained;
    } });
    const prepared = await session.prepare(initial, batch(initial));
    mutableCell(retained!, "amount").value = 999;
    expect(() => prepared.commit()).toThrow("conflict"); expect(session.plan).toBe(initial);
  });
});
