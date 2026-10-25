// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { countTemplatePages, paginateTemplate, paginateTemplatePages, PaginateChartComponentLimitError, type ReportTemplate } from "../layout/paginate";
import * as charts from "../processing/charts";
import type { ReportChartBinding } from "../processing/chart-data";
import type { PlanComponent } from "../schema/render-plan";

const binding: ReportChartBinding = { dataset: "detail", categoryField: "shift", type: "bar", measures: [{ field: "qty", op: "sum" }] };
const datasets = { detail: [{ shift: "甲", qty: 3 }] };
function chart(nid = "chart", topMm = 10): PlanComponent {
  return { kind: "chart", nid, leftMm: 10, topMm, widthMm: 160, heightMm: 60, chartBinding: binding };
}
function pages(count: number): ReportTemplate {
  return { pages: Array.from({ length: count }, () => ({ widthMm: 210, heightMm: 297, components: [chart()] })) };
}
afterEach(() => vi.restoreAllMocks());

describe("operation-scoped chart primitive budgets", () => {
  it("shares the budget across template pages and stops before expanding the next chart", () => {
    const render = vi.spyOn(charts, "createChartComponents");
    const perChart = paginateTemplate(pages(1), datasets).plan.pages[0]!.components.length;
    render.mockClear();
    const iterator = paginateTemplatePages(pages(2), datasets, { maxChartComponents: perChart * 2 - 1 });
    expect(iterator.next().value!.components).toHaveLength(perChart);
    expect(() => iterator.next()).toThrow(PaginateChartComponentLimitError);
    expect(render).toHaveBeenCalledTimes(1);
    expect(paginateTemplate(pages(2), datasets, { maxChartComponents: perChart * 2 }).plan.pages).toHaveLength(2);
    expect(paginateTemplate(pages(1), datasets, { maxChartComponents: perChart }).plan.pages).toHaveLength(1);
  });

  it("shares the same budget when flow moves charts to continuation pages", () => {
    const template: ReportTemplate = { pages: [{ widthMm: 210, heightMm: 100, components: [chart("a"), chart("b", 80)], flow: { bands: [{ componentIds: ["a"], topMm: 10, heightMm: 60 }, { componentIds: ["b"], topMm: 80, heightMm: 60 }] } }] };
    const output = paginateTemplate(template, datasets).plan;
    expect(output.pages).toHaveLength(2);
    const render = vi.spyOn(charts, "createChartComponents");
    expect(() => paginateTemplate(template, datasets, { maxChartComponents: output.pages[0]!.components.length })).toThrow(/图表图元数量预计超出上限/);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("keeps total-page counting bounded without double-charging the output pass", () => {
    const template = pages(2);
    for (const page of template.pages) page.components.push({ kind: "text", leftMm: 0, topMm: 280, widthMm: 30, heightMm: 5, pageAnchor: "footer", text: "{page}/{totalPages}" });
    const count = paginateTemplate(pages(1), datasets).plan.pages[0]!.components.length;
    expect(() => countTemplatePages(template, datasets, { maxChartComponents: count })).toThrow(PaginateChartComponentLimitError);
    const output = [...paginateTemplatePages(template, datasets, { maxChartComponents: count * 2 })];
    expect(output).toHaveLength(2);
    expect(output[1]!.components[output[1]!.components.length - 1]!.text).toBe("2/2");
  });

  it("retains cancellation between pages and does not share used capacity across calls", () => {
    const controller = new AbortController(), render = vi.spyOn(charts, "createChartComponents");
    const iterator = paginateTemplatePages(pages(2), datasets, { signal: controller.signal });
    iterator.next(); controller.abort();
    expect(() => iterator.next()).toThrow(/取消/);
    expect(render).toHaveBeenCalledTimes(1);
    expect(paginateTemplate(pages(1), datasets).plan.pages).toHaveLength(1);
  });

  it("counts empty chart placeholders separately from grid cells and validates the limit", () => {
    expect(() => paginateTemplate(pages(2), { detail: [] }, { maxChartComponents: 1 })).toThrow(PaginateChartComponentLimitError);
    expect(paginateTemplate(pages(1), datasets, { maxCells: 1 }).plan.pages[0]!.components.length).toBeGreaterThan(1);
    for (const maxChartComponents of [0, -1, 1.5, NaN, Infinity, 1_000_001]) expect(() => paginateTemplate(pages(1), datasets, { maxChartComponents })).toThrow(/maxChartComponents/);
    expect(paginateTemplate(pages(1), { detail: [] }, { maxChartComponents: 1 }).plan.pages[0]!.components).toHaveLength(1);
    expect(paginateTemplate(pages(1), datasets, { maxChartComponents: 1_000_000 }).plan.pages).toHaveLength(1);
  });

  it("enforces the default cap before many dense charts can allocate their primitive arrays", () => {
    const measures = Array.from({ length: 12 }, (_, index) => ({ field: `v${index}`, op: "sum" as const }));
    const input = { detail: Array.from({ length: 200 }, (_, index) => Object.fromEntries([["shift", `分类${index}`], ...measures.map(measure => [measure.field, index])])) };
    const template = pages(8);
    for (const page of template.pages) page.components[0] = { ...chart(), chartBinding: { ...binding, type: "line", showValues: true, measures } };
    const render = vi.spyOn(charts, "createChartComponents");
    expect(() => paginateTemplate(template, input)).toThrow(/上限 50000/);
    expect(render).toHaveBeenCalledTimes(6);
  });

  it("reserves an upper bound for every supported plot, including nulls, zero and labels", () => {
    for (const type of ["bar", "line", "stackedBar", "percentBar"] as const) for (const showValues of [false, true]) {
      const options: charts.ReportChartOptions = { type, showValues, leftMm: 0, topMm: 0, widthMm: 100, heightMm: 60, title: "产重", categories: ["A", "B", "C", "D"], series: [{ name: "甲", values: [1, null, 0, 2] }, { name: "乙", values: [null, 0, 3, 1] }] };
      expect(charts.chartComponentUpperBound(options)).toBeGreaterThanOrEqual(charts.createChartComponents(options).length);
    }
  });
});
