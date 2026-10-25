// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTableTemplate } from "../builder/table-template";
import { createReportRuntime } from "../server/runtime";
import { paginateTemplate } from "../layout/paginate";
import { createChartComponents } from "../processing/charts";
import { createReportChartData, type ReportChartBinding } from "../processing/chart-data";
import { validateRenderPlan } from "../schema/validate";
describe("cross-output product behavior", () => {
  it("keeps static bar notes informational through the server codec and rejects budgets before output", async () => {
    const template = createTableTemplate({ columns: [{ field: "value", header: "Value", visual: { kind: "dataBar" } }] });
    const runtime = createReportRuntime({ reports: { report: { template, datasets: { detail: [{ value: 0 }, { value: 8 }] } } } });
    const result = await runtime.export({ reportIds: ["report"], format: "xlsx", fidelity: "strict", xlsx: { valueMode: "raw", paperSize: "a4" } });
    expect(result.bytes[0]).toBe(80);
    expect(result.diagnostics.some(item => item.code === "xlsx-snapshot" && item.severity === "info")).toBe(true);
    expect(result.diagnostics.some(item => item.severity === "warning")).toBe(false);
    await expect(runtime.export({ reportIds: ["report"], format: "xlsx", xlsx: { maxDataBars: 0 } })).rejects.toThrow(/数据条|dataBar/i);
  });
  it("renders mixed signed stacks and huge finite percentage values without mutating input", () => {
    const base = { leftMm: 0, topMm: 0, widthMm: 160, heightMm: 80, categories: ["A", "B"], series: [{ name: "One", values: [1e308, 0] }, { name: "Two", values: [1e308, null] }] };
    const result = createChartComponents({ ...base, type: "percentBar", showValues: true });
    expect(validateRenderPlan({ schemaVersion: "test", pages: [{ pageWidthMm: 210, pageHeightMm: 297, components: result }] }).ok).toBe(true);
    expect(result.some(item => item.text === "50%")).toBe(true);
    expect(base.series[0]!.values[0]).toBe(1e308);
    expect(() => createChartComponents({ ...base, type: "stackedBar" })).toThrow(/溢出/);
    expect(() => createChartComponents({ ...base, type: "percentBar", series: [{ name: "negative", values: [-1, 2] }] })).toThrow(/非负/);
    const signed = createChartComponents({ ...base, type: "stackedBar", series: [{ name: "A", values: [-3, 4] }, { name: "B", values: [-2, 6] }] });
    expect(signed.filter(item => item.kind === "rect")).toHaveLength(4);
    expect(signed.every(item => Number.isFinite(item.heightMm) && item.heightMm >= 0)).toBe(true);
  });
  it("rejects canceled empty sources and sparse measures before producing empty output", () => {
    const binding: ReportChartBinding = { dataset: "detail", categoryField: "shift", type: "bar", measures: [{ op: "count" }] };
    const abort = new AbortController(); abort.abort();
    expect(() => createReportChartData([], binding, abort.signal)).toThrow(/取消/);
    expect(() => createReportChartData([], { ...binding, measures: new Array(1) })).toThrow(/度量/);
    const template = { pages: [{ widthMm: 210, heightMm: 297, components: [{ kind: "chart" as const, nid: "chart", leftMm: 0, topMm: 10, widthMm: 100, heightMm: 60, chartBinding: binding }], flow: { bands: [{ componentIds: ["chart"], topMm: 10, heightMm: 60 }] } }] };
    expect(paginateTemplate(template, { detail: [{ shift: "A" }] }).plan.pages[0]!.components.some(item => item.kind === "rect")).toBe(true);
  });
  it("rejects custom chart iterators and slot getters without executing them", () => {
    let reads = 0;
    const measures = [{ op: "count" as const }];
    Object.defineProperty(measures, Symbol.iterator, { get() { reads++; throw new Error("iterator must not run"); } });
    expect(() => createReportChartData([], { dataset: "detail", categoryField: "shift", type: "bar", measures })).toThrow(/迭代器/);
    const values: number[] = [2];
    Object.defineProperty(values, "0", { get() { reads++; return 2; } });
    expect(() => createChartComponents({ type: "bar", categories: ["A"], series: [{ name: "N", values }], leftMm: 0, topMm: 0, widthMm: 100, heightMm: 50 })).toThrow(/访问器/);
    expect(reads).toBe(0);
  });
});
