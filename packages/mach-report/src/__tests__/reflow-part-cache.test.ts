// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTableTemplate } from "../builder/table-template";
import { createReportSource } from "../source/report-source";
import { createReportCellEditBatch } from "../editing/batch";
import { getReportEditSession } from "../editing/session";
import { getReportCellContext } from "../editing/context";
import * as pagination from "../editing/session-pagination";
import type { RenderPlan } from "../schema/render-plan";
import { createReflowPartCache } from "../source/reflow-cache";
import { accountSourcePagination, createSourcePaginationBudget } from "../source/source-pagination-budget";

afterEach(() => vi.restoreAllMocks());
function input(title: string) {
  return { template: createTableTemplate({ title, columns: [{ field: "qty", header: "Qty", valueType: "number" }, { field: "amount", header: "Amount" }], listOptions: { rowKey: "id", computed: [{ field: "amount", expression: { op: "multiply", args: [{ field: "qty" }, { value: 3 }] } }] } }), datasets: { detail: [{ id: "1", qty: 2 }] } };
}
function change(plan: RenderPlan, value: number) {
  const componentIndex = plan.pages[0]!.components.findIndex(component => component.table?.role === "body");
  return createReportCellEditBatch(plan, [{ address: { pageIndex: 0, componentIndex, rowIndex: 0, columnIndex: 0 }, value }], `qty-${value}`);
}
describe("private report-part reflow reuse", () => {
  it("reflows changed A and skips unchanged B after the private baseline is established", async () => {
    const reports = { A: input("A"), B: input("B") }, source = createReportSource(reports), initial = await source({ reportIds: ["A", "B"], params: {} });
    const session = getReportEditSession(initial)!, rebuild = vi.spyOn(pagination, "reflowReportTemplateResult");
    const first = (await session.prepare(initial, change(initial, 4))).commit();
    expect(rebuild).toHaveBeenCalledTimes(2); rebuild.mockClear();
    const next = (await session.prepare(first, change(first, 5))).commit();
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(rebuild.mock.calls[0]![0].pages[0]!.components.some(component => component.kind === "text" && component.text === "A")).toBe(true);
    const fresh = await createReportSource({ A: { ...reports.A, datasets: { detail: [{ id: "1", qty: 5 }] } }, B: reports.B })({ reportIds: ["A", "B"], params: {} });
    expect(next).toEqual(fresh); expect(reports.A.datasets.detail[0]!.qty).toBe(2);
  });
  it("invalidates a reused part when a published shared grid is changed", async () => {
    const source = createReportSource({ A: input("A"), B: input("B") }), plan = await source({ reportIds: ["A", "B"], params: {} }), session = getReportEditSession(plan)!;
    const first = (await session.prepare(plan, change(plan, 4))).commit();
    const row = first.pages[1]!.components.find(component => component.table?.role === "body")!;
    row.grid!.cells[0]![1]!.value = 999;
    const rebuild = vi.spyOn(pagination, "reflowReportTemplateResult"), next = (await session.prepare(first, change(first, 5))).commit();
    expect(rebuild).toHaveBeenCalledTimes(2);
    const index = next.pages[1]!.components.findIndex(component => component.table?.role === "body");
    expect(getReportCellContext(next, { pageIndex: 1, componentIndex: index, rowIndex: 0, columnIndex: 1 })!.value).toBe(6);
  });
  it("does not let an uncommitted or cancelled candidate change the baseline", async () => {
    const source = createReportSource({ A: input("A"), B: input("B") }), plan = await source({ reportIds: ["A", "B"], params: {} }), session = getReportEditSession(plan)!;
    const first = (await session.prepare(plan, change(plan, 4))).commit();
    const rejected = await session.prepare(first, change(first, 99));
    expect(session.plan).toBe(first);
    const accepted = (await session.prepare(first, change(first, 5))).commit();
    expect(() => rejected.commit()).toThrow("conflict"); expect(session.plan).toBe(accepted);
    const controller = new AbortController(); controller.abort();
    await expect(session.prepare(accepted, change(accepted, 6), { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
  it("counts cached page, cell and chart allocations against the full request ledger", () => {
    const plan: RenderPlan = { schemaVersion: "mach-report/1", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [{ kind: "rect", leftMm: 0, topMm: 0, widthMm: 10, heightMm: 10, grid: { cells: [[{ text: "x" }]] } }] }] };
    for (const limits of [{ maxPages: 1 }, { maxCells: 1 }, { maxChartComponents: 1 }]) {
      const budget = createSourcePaginationBudget(limits), result = { plan, chartComponents: 1 };
      accountSourcePagination(budget, result);
      expect(() => accountSourcePagination(budget, result)).toThrow();
    }
  });
  it("does not cache custom formula, measurement or warning callbacks", async () => {
    const cached = createReflowPartCache(), part = input("custom");
    for (const options of [{ formula: { evaluate: () => 1 } }, { measurer: { measureMm: () => 1 } }, { onWarning: () => {} }]) {
      const build = vi.fn(() => pagination.reflowReportTemplateResult(part.template, part.datasets));
      await cached(0, part, options, build); await cached(0, part, options, build);
      expect(build).toHaveBeenCalledTimes(2);
    }
  });
  it("isolates late concurrent results and failed builders by private part identity", async () => {
    const cached = createReflowPartCache(), first = input("first"), second = input("second");
    const a = await pagination.reflowReportTemplateResult(first.template, first.datasets), b = await pagination.reflowReportTemplateResult(second.template, second.datasets);
    let finish!: (result: typeof a) => void;
    const pending = cached(0, first, {}, () => new Promise(resolve => { finish = resolve; }));
    expect(await cached(0, second, {}, async () => b)).toBe(b);
    finish(a); expect(await pending).toBe(a);
    const build = vi.fn(async () => b);
    expect(await cached(0, second, {}, build)).toBe(b); expect(build).toHaveBeenCalledOnce();
    await expect(cached(0, first, {}, async () => { throw new Error("layout failed"); })).rejects.toThrow("layout failed");
    build.mockClear(); expect(await cached(0, second, {}, build)).toBe(b); expect(build).not.toHaveBeenCalled();
  });
  it("does not retain aborted or structurally unguardable layout results", async () => {
    const cached = createReflowPartCache(), part = input("plain"), controller = new AbortController();
    const result = await pagination.reflowReportTemplateResult(part.template, part.datasets);
    controller.abort();
    await cached(0, part, { signal: controller.signal }, async () => result);
    const build = vi.fn(async () => result);
    await cached(0, part, {}, build); expect(build).toHaveBeenCalledOnce();
    const exotic = createReflowPartCache();
    Object.defineProperty(result.plan, "unused", { value: () => {}, enumerable: true });
    const unguardable = vi.fn(async () => result);
    await exotic(0, part, {}, unguardable); await exotic(0, part, {}, unguardable);
    expect(unguardable).toHaveBeenCalledTimes(2);
  });
});
