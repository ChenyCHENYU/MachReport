// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createReportSource } from "../source/report-source";
import { createReportRuntime } from "../server/runtime";
import { getReportEditSession } from "../editing/session";
import { createReportCellEditBatch } from "../editing/batch";
import { createTableTemplate } from "../builder/table-template";
import { paginateTemplate, type ReportTemplate } from "../layout/paginate";
import * as charts from "../processing/charts";

function fixture() {
  const template: ReportTemplate = { pages: [{ widthMm: 210, heightMm: 297, components: [{ kind: "chart", leftMm: 10, topMm: 10, widthMm: 160, heightMm: 60, chartBinding: { dataset: "detail", categoryField: "shift", type: "bar", measures: [{ field: "qty", op: "sum" }] } }] }] };
  const datasets = { detail: [{ id: "001", shift: "甲", qty: 3 }, { id: "002", shift: "甲", qty: 0 }] };
  return { template, datasets };
}
afterEach(() => vi.restoreAllMocks());

describe("combined report and reflow chart budgets", () => {
  it("shares remaining capacity across report IDs and repeated occurrences before primitive allocation", async () => {
    const definition = fixture(), single = paginateTemplate(definition.template, definition.datasets).chartComponents;
    const render = vi.spyOn(charts, "createChartComponents");
    const source = createReportSource({ a: definition }, { maxChartComponents: single * 2 - 1 });
    await expect(source({ reportIds: ["a", "a"], params: {} })).rejects.toMatchObject({ code: "validate", cause: { code: "chart-component-limit", limit: single * 2 - 1, estimated: single * 2 } });
    expect(render).toHaveBeenCalledTimes(1);
    expect((await createReportSource({ a: definition }, { maxChartComponents: single * 2 })({ reportIds: ["a", "a"], params: {} })).pages).toHaveLength(2);
    expect((await source({ reportIds: ["a"], params: {} })).pages).toHaveLength(1);
  });

  it("honors smaller per-report limits and allows nonchart reports after the chart budget is consumed", async () => {
    const definition = fixture(), single = paginateTemplate(definition.template, definition.datasets).chartComponents;
    const local = createReportSource({ a: { ...definition, pagination: { maxChartComponents: single - 1 } } }, { maxChartComponents: single * 2 });
    await expect(local({ reportIds: ["a"], params: {} })).rejects.toMatchObject({ cause: { limit: single - 1 } });
    const plain = { template: { pages: [{ widthMm: 100, heightMm: 100, components: [] }] } };
    const source = createReportSource({ a: definition, plain }, { maxChartComponents: single });
    expect((await source({ reportIds: ["a", "plain"], params: {} })).pages).toHaveLength(2);
    const render = vi.spyOn(charts, "createChartComponents");
    await expect(source({ reportIds: ["a", "a"], params: {} })).rejects.toMatchObject({ cause: { limit: single, estimated: single + 1 } });
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("retains the combined limit during edit reflow and rejects atomically before persistence", async () => {
    const definition = fixture();
    const template = createTableTemplate({ columns: [{ field: "id", header: "编号" }, { field: "shift", header: "班别" }, { field: "qty", header: "产重", valueType: "number" }], listOptions: { rowKey: "id" } });
    template.pages[0]!.components.push(definition.template.pages[0]!.components[0]!);
    const source = createReportSource({ a: { ...definition, template }, b: { ...definition, template } }, { maxChartComponents: 28 });
    const plan = await source({ reportIds: ["a", "b"], params: {} }), session = getReportEditSession(plan)!;
    expect(session).toBeDefined();
    const componentIndex = plan.pages[0]!.components.findIndex(component => component.table?.role === "body");
    const edit = createReportCellEditBatch(plan, [{ address: { pageIndex: 0, componentIndex, rowIndex: 0, columnIndex: 1 }, value: "乙" }], "split-category");
    const render = vi.spyOn(charts, "createChartComponents");
    await expect(session.prepare(plan, edit)).rejects.toMatchObject({ code: "chart-component-limit", limit: 28, estimated: 30 });
    expect(render).toHaveBeenCalledTimes(1);
    expect(session.plan).toBe(plan);
    expect(definition.datasets.detail[0]!.shift).toBe("甲");
    const valid = createReportCellEditBatch(plan, [{ address: { pageIndex: 0, componentIndex, rowIndex: 0, columnIndex: 2 }, value: 1 }], "same-category");
    const prepared = await session.prepare(plan, valid);
    expect(prepared.commit().pages).toHaveLength(plan.pages.length);
  });

  it("maps Runtime expansion limits to a structured budget error and validates the hard cap", async () => {
    const reports = { a: fixture() };
    await expect(createReportRuntime({ reports, budget: { maxChartComponents: 27 } }).prepare({ reportIds: ["a", "a"] })).rejects.toMatchObject({ name: "ReportRuntimeError", code: "budget", path: "$.budget.maxChartComponents" });
    expect((await createReportRuntime({ reports, budget: { maxChartComponents: 28 } }).prepare({ reportIds: ["a", "a"] })).plan.pages).toHaveLength(2);
    for (const maxChartComponents of [0, -1, 1.5, NaN, Infinity, 1_000_001]) {
      expect(() => createReportRuntime({ reports, budget: { maxChartComponents } })).toThrow();
      expect(() => createReportSource(reports, { maxChartComponents })).toThrow(/maxChartComponents/);
    }
    expect(() => createReportRuntime({ reports, budget: { maxChartComponents: 1_000_001 } })).toThrow(expect.objectContaining({ code: "budget", path: "$.budget.maxChartComponents" }));
  });

  it("keeps the default 50000 primitive cap across dense reports sharing one source request", async () => {
    const definition = fixture(), chart = definition.template.pages[0]!.components[0]!;
    if (chart.kind !== "chart") throw new Error("Expected chart");
    const measures = Array.from({ length: 12 }, (_, index) => ({ field: `v${index}`, op: "sum" as const }));
    chart.chartBinding = { ...chart.chartBinding!, type: "line", showValues: true, measures };
    const detail = Array.from({ length: 200 }, (_, index) => Object.fromEntries([["shift", `分类${index}`], ...measures.map(measure => [measure.field, index])]));
    const render = vi.spyOn(charts, "createChartComponents");
    const source = createReportSource({ a: { template: definition.template, datasets: { detail } } });
    await expect(source({ reportIds: Array.from({ length: 8 }, () => "a"), params: {} })).rejects.toMatchObject({ cause: { code: "chart-component-limit", limit: 50_000 } });
    expect(render).toHaveBeenCalledTimes(6);
  });
});
