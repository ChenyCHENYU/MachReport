import { afterEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, shallowRef } from "vue";
import { useReportDrill } from "../composables/useReportDrill";
import type { ReportDrillOptions } from "../drill";
import { DEFAULT_MESSAGES } from "../config";
import type { RenderPlan } from "../../schema/render-plan";
const scopes: ReturnType<typeof effectScope>[] = [];
afterEach(() => { scopes.forEach(scope => scope.stop()); scopes.length = 0; });
function fixture(open = vi.fn().mockResolvedValue(undefined), guard = vi.fn().mockResolvedValue(true)) {
  const scope = effectScope(); scopes.push(scope);
  const plan = shallowRef<RenderPlan | null>({ schemaVersion: "1", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [{ kind: "rect", leftMm: 0, topMm: 0, widthMm: 50, heightMm: 10,
    table: { id: "table", rowIndex: 0, role: "body", columnKeys: ["heat"] }, grid: { cells: [[{ value: "22W418", text: "22W418" }]] } }] }] });
  const address = { pageIndex: 0, componentIndex: 0, rowIndex: 0, columnIndex: 0 };
  const options = { actions: [{ id: "detail", label: "实绩", target: { field: "heat" }, params: { heat: { from: "value" as const } } }], open };
  const drill = scope.run(() => useReportDrill({ plan, selection: shallowRef({ anchor: address, focus: address }), options: () => options, params: () => ({ plant: "YTS0" }), view: () => ({ zoom: 1.5, scrollTop: 100, scrollLeft: 50 }), messages: () => DEFAULT_MESSAGES, busy: () => false, beforeOpen: guard }))!;
  return { drill, plan, open, guard };
}
describe("drill activation lifecycle", () => {
  it("requires the host allowlist, waits for dirty draft protection, and passes a compact return snapshot", async () => {
    const { drill, open, guard } = fixture();
    await drill.open("not-allowed"); expect(open).not.toHaveBeenCalled();
    await drill.open("detail"); expect(guard).toHaveBeenCalledOnce();
    expect(open.mock.calls[0]![0]).toMatchObject({ actionId: "detail", params: { heat: "22W418" }, view: { zoom: 1.5, scrollTop: 100 } });
    const denied = fixture(vi.fn(), vi.fn().mockResolvedValue(false));
    await denied.drill.open("detail"); expect(denied.open).not.toHaveBeenCalled();
  });
  it("deduplicates activation, cancels on replacement, and consumes late host rejection", async () => {
    let reject!: (error: Error) => void;
    const open = vi.fn<ReportDrillOptions["open"]>(() => new Promise<void>((_, fail) => { reject = fail; }));
    const { drill, plan } = fixture(open);
    const task = drill.open("detail"); await nextTick(); await drill.open("detail");
    expect(open).toHaveBeenCalledOnce(); expect(drill.pending.value).toBe(true);
    plan.value = null; await nextTick(); await task;
    expect(open.mock.calls[0]![0].signal.aborted).toBe(true);
    reject(new Error("late failure")); await nextTick(); expect(drill.error.value).toBe("");
  });
  it("shows retryable action failure without replacing report content", async () => {
    const { drill, plan } = fixture(vi.fn().mockRejectedValue(new Error("failed")));
    await drill.open("detail"); expect(drill.error.value).toBe(DEFAULT_MESSAGES.drillFailed); expect(plan.value).not.toBeNull();
  });
});
