// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTableTemplate } from "../builder/table-template";
import { createReportSource } from "../source/report-source";
import { createReportCellEditBatch } from "../editing/batch";
import { getReportCellContext } from "../editing/context";
import { getReportEditSession } from "../editing/session";
import { captureSessionGuard } from "../editing/session-snapshot";
import type { RenderPlan } from "../schema/render-plan";

function fixture(qty = 2) {
  return { template: createTableTemplate({ columns: [{ field: "qty", header: "Qty", valueType: "number" }],
    listOptions: { rowKey: "id", revisionField: "rev", sourceTokenField: "token" } }),
  datasets: { detail: [{ id: "001", qty, rev: "1", token: "original" }] } };
}
function context(plan: RenderPlan, pageIndex: number) {
  const componentIndex = plan.pages[pageIndex]!.components.findIndex(component => component.table?.role === "body");
  return getReportCellContext(plan, { pageIndex, componentIndex, rowIndex: 0, columnIndex: 0 })!;
}
describe("independent source identities", () => {
  it.each([2, 7])("isolates values, revisions and history across same-named datasets (other=%d)", async other => {
    const a = fixture(), b = fixture(other);
    const plan = await createReportSource({ orders: a, shipments: b })({ reportIds: ["orders", "shipments"], params: {} });
    const session = getReportEditSession(plan)!;
    const edits = createReportCellEditBatch(plan, [{ address: context(plan, 0).address, value: 5 }], "change");
    const next = (await session.prepare(plan, edits)).commit({ revision: "2", sourceToken: "orders-2" });
    expect(context(next, 0)).toMatchObject({ value: 5, source: { sourceScope: '[0,"orders"]', revision: "2" } });
    expect(context(next, 1)).toMatchObject({ value: other, source: { sourceScope: '[1,"shipments"]', revision: "1", sourceToken: "original" } });
    const undo = await session.prepareHistory(next, edits.edits, "previousValue", "undo");
    const restored = undo.prepared.commit({ revision: "3" });
    expect(context(restored, 0).value).toBe(2); expect(context(restored, 1).value).toBe(other);
    expect(a.datasets.detail[0]!.qty).toBe(2); expect(b.datasets.detail[0]!.qty).toBe(other);
  });
  it("permits independent edits when the same report ID is repeated", async () => {
    const spec = fixture(), plan = await createReportSource({ report: spec })({ reportIds: ["report", "report"], params: {} });
    const batch = createReportCellEditBatch(plan, [0, 1].map(pageIndex => ({ address: context(plan, pageIndex).address, value: pageIndex + 5 })), "both");
    const next = (await getReportEditSession(plan)!.prepare(plan, batch)).commit();
    expect([context(next, 0).value, context(next, 1).value]).toEqual([5, 6]);
  });
  it("detects scope forgery before recalculation or persistence", async () => {
    const plan = await createReportSource({ report: fixture() })({ reportIds: ["report"], params: {} });
    const batch = createReportCellEditBatch(plan, [{ address: context(plan, 0).address, value: 5 }], "forged");
    batch.edits[0]!.source = { ...batch.edits[0]!.source!, sourceScope: "another" };
    await expect(getReportEditSession(plan)!.prepare(plan, batch)).rejects.toMatchObject({ code: "conflict" });
  });
});
describe("bounded immutable-value mutation guard", () => {
  it("does not scan large unused string bytes, while still detecting changes and enforcing exact snapshots", () => {
    const spec = fixture();
    const parts = [{ ...spec, datasets: { detail: Array.from({ length: 96 }, (_, index) => ({ id: index, qty: 2, unused: "x".repeat(1024 * 1024) })) } }];
    const started = performance.now(), guard = captureSessionGuard(parts);
    expect(guard()).toBe(true);
    // The previous char-by-char hash took >300ms for this fixture; descriptor work is bounded by property count.
    expect(performance.now() - started).toBeLessThan(150);
    parts[0]!.datasets.detail[0]!.unused = "changed";
    expect(guard()).toBe(false);
  });
  it("rejects deep, cyclic and accessor data without executing getters", () => {
    const spec = fixture(); let deep: unknown = 0;
    for (let index = 0; index < 140; index++) deep = { deep };
    expect(() => captureSessionGuard([{ ...spec, datasets: { detail: [{ deep }] } }])).toThrow("limit");
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    expect(() => captureSessionGuard([{ ...spec, datasets: { detail: [cycle] } }])).toThrow("conflict");
    let called = 0; const accessor = Object.defineProperty({}, "qty", { enumerable: true, get() { called++; return 2; } });
    expect(() => captureSessionGuard([{ ...spec, datasets: { detail: [accessor] } }])).toThrow("conflict"); expect(called).toBe(0);
  });
});
