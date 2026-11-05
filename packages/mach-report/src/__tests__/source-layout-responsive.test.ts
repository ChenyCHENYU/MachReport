// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createTemplate } from "../builder/template-builder";
import { paginateTemplate, paginateTemplateAsync } from "../layout/paginate";
import { createReportSource } from "../source/report-source";
import type { ReportTaskEvent } from "../source/task-events";
import { createTableTemplate } from "../builder/table-template";
import { createReportCellEditBatch } from "../editing/batch";
import { getReportEditSession } from "../editing/session";
import { snapshotLayoutPart } from "../editing/session-snapshot";

const template = createTemplate().page(90, 40)
  .text("{page} / {totalPages}", { leftMm: 5, topMm: 1, widthMm: 60, heightMm: 5 })
  .list("rows", { leftMm: 5, topMm: 8, widthMm: 70 }, [{ field: "id", header: "编号", widthMm: 70 }])
  .build();
const datasets = { rows: Array.from({ length: 160 }, (_, id) => ({ id })) };

describe("responsive source layout", () => {
  it("preserves the synchronous plan, page anchors, warnings and chart accounting", async () => {
    const warn = vi.fn();
    const expected = paginateTemplate(template, datasets);
    const actual = await paginateTemplateAsync(template, datasets, { onWarning: warn });
    expect(actual).toEqual(expected);
    expect(actual.plan.pages.length).toBeGreaterThan(8);
    expect(actual.plan.pages[0]?.components.find(component => component.kind === "text")?.text).toBe(`1 / ${actual.plan.pages.length}`);
    expect(warn.mock.calls.map(([warning]) => warning)).toEqual(actual.warnings);
  });

  it("delivers a real timer cancellation during the first query layout", async () => {
    const controller = new AbortController(), events: ReportTaskEvent[] = [];
    const warning = vi.fn(), load = vi.fn(() => datasets);
    const source = createReportSource({ report: { template, load } });
    const reason = new Error("superseded query");
    const pending = source({ reportIds: ["report"], params: {}, signal: controller.signal, onWarning: warning,
      onEvent(event) {
        events.push(event);
        if (event.stage === "layout" && event.status === "started") setTimeout(() => controller.abort(reason), 0);
      },
    });
    await expect(pending).rejects.toMatchObject({ name: "AbortError", cause: reason });
    expect(load).toHaveBeenCalledOnce();
    expect(events).toContainEqual(expect.objectContaining({ stage: "layout", status: "started" }));
    expect(events).not.toContainEqual(expect.objectContaining({ stage: "layout", status: "completed" }));
    expect(warning).not.toHaveBeenCalled();
  });

  it("lets an interaction heartbeat run before the complete plan is returned", async () => {
    let received = false;
    const heartbeat = vi.fn(() => { expect(received).toBe(false); });
    const source = createReportSource({ report: { template, datasets } });
    const plan = await source({ reportIds: ["report"], params: {}, onEvent(event) {
      if (event.stage === "layout" && event.status === "started") setTimeout(heartbeat, 0);
    } });
    received = true;
    expect(heartbeat).toHaveBeenCalledOnce();
    expect(plan.pages).toHaveLength(paginateTemplate(template, datasets).plan.pages.length);
  });

  it("locks template and rows before yielding, even when the host changes every original row", async () => {
    const current = structuredClone(template), rows = Array.from({ length: 160 }, (_, id) => ({ id }));
    const expected = paginateTemplate(current, { rows }).plan;
    let changed = false;
    const source = createReportSource({ report: { template: current, datasets: { rows } } });
    const plan = await source({ reportIds: ["report"], params: {}, onEvent(event) {
      if (event.stage === "layout" && event.status === "started") setTimeout(() => {
        rows.forEach(row => row.id += 1000);
        current.pages[0]!.components = [];
        changed = true;
      }, 0);
    } });
    expect(changed).toBe(true);
    // Source scoping adds only metadata; all values, rows and page anchors retain
    // the one captured query result, rather than a mixture of old/new host state.
    expect(plan.pages.map(page => page.components.map(component => component.grid?.cells ?? component.text)))
      .toEqual(expected.pages.map(page => page.components.map(component => component.grid?.cells ?? component.text)));
  });

  it("binds subsequent edit/reflow to the same owned source snapshot", async () => {
    const current = createTableTemplate({ columns: [{ field: "qty", header: "Qty", valueType: "number", editable: true }], listOptions: { rowKey: "id" } });
    const rows = Array.from({ length: 400 }, (_, id) => ({ id: String(id), qty: 2 }));
    const source = createReportSource({ report: { template: current, datasets: { detail: rows } } });
    const plan = await source({ reportIds: ["report"], params: {}, onEvent(event) {
      if (event.stage === "layout" && event.status === "started") setTimeout(() => {
        rows.forEach(row => row.qty = 999); current.pages[0]!.components = [];
      }, 0);
    } });
    const componentIndex = plan.pages[0]!.components.findIndex(component => component.table?.role === "body");
    const batch = createReportCellEditBatch(plan, [{ address: { pageIndex: 0, componentIndex, rowIndex: 0, columnIndex: 0 }, value: 3 }], "owned");
    const next = (await getReportEditSession(plan)!.prepare(plan, batch)).commit();
    const values = next.pages.flatMap(page => page.components).filter(component => component.table?.role === "body").map(component => component.grid!.cells[0]![0]!.value);
    expect(values).toEqual([3, ...Array(399).fill(2)]);
    expect(rows.every(row => row.qty === 999)).toBe(true);
  });

  it("preserves Date, BigInt, undefined and immutable large strings without JSON conversion", () => {
    const original = { template, datasets: { rows: [{ id: 1, date: new Date("2026-11-05T00:00:00Z"), exact: 12n, optional: undefined, large: "x".repeat(1_000_000) }] } };
    const snapshot = snapshotLayoutPart(original);
    const row = snapshot.datasets.rows![0]!;
    expect(row.date).toEqual(original.datasets.rows[0]!.date);
    expect(row.date).not.toBe(original.datasets.rows[0]!.date);
    expect(row.exact).toBe(12n);
    expect(Object.prototype.hasOwnProperty.call(row, "optional")).toBe(true);
    expect(row.large).toBe(original.datasets.rows[0]!.large);
    expect(snapshot.template).not.toBe(template);
  });

  it.each(["function", "accessor", "prototype"])("preserves readonly %s data using its synchronous compatibility boundary", async kind => {
    const rows: Record<string, unknown>[] = Array.from({ length: 160 }, (_, id) => ({ id }));
    const getter = vi.fn(() => { throw new Error("Unused accessor must not run"); });
    if (kind === "function") rows[0]!.unused = () => "unused";
    if (kind === "accessor") Object.defineProperty(rows[0], "unused", { enumerable: true, get: getter });
    if (kind === "prototype") Object.setPrototypeOf(rows[0], { unused: "inherited" });
    const warning = vi.fn(), heartbeat = vi.fn();
    const source = createReportSource({ report: { template, datasets: { rows } } }, { onWarning: warning });
    const plan = await source({ reportIds: ["report"], params: {}, onEvent(event) {
      if (event.stage === "layout" && event.status === "started") setTimeout(heartbeat, 0);
    } });
    expect(plan.pages.length).toBeGreaterThan(8);
    expect(heartbeat).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
    expect(getReportEditSession(plan)).toBeUndefined();
    expect(warning).toHaveBeenCalledOnce();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(heartbeat).toHaveBeenCalledOnce();
  });
});
