// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createReportRuntime } from "../server/runtime";
import { createReportSource } from "../source/report-source";
import type { ReportTemplate } from "../layout/paginate";
import type { PlanComponent } from "../schema/render-plan";

function staticTemplate(): ReportTemplate {
  return { pages: [{ widthMm: 100, heightMm: 60, components: [{ kind: "rect", leftMm: 1, topMm: 1, widthMm: 20, heightMm: 10, grid: { colWidthsMm: [10, 10], rowHeightsMm: [5, 5], cells: [[{ text: "A" }, { text: "B" }], [{ text: "C" }, { text: "D" }]] } }] }] };
}
describe("global incremental cell budgets", () => {
  it("shares the remaining cell budget across reports before returning a partial plan", async () => {
    const definition = { template: staticTemplate() };
    const source = createReportSource({ first: definition, second: definition }, { maxCells: 7 });
    await expect(source({ reportIds: ["first", "second"], params: {} })).rejects.toMatchObject({ code: "validate", cause: { code: "cell-limit", limit: 7, actual: 8 } });
    expect((await createReportSource({ first: definition, second: definition }, { maxCells: 8 })({ reportIds: ["first", "second"], params: {} })).pages).toHaveLength(2);
  });

  it("counts repeated anchors and list headers in the real pagination budget", async () => {
    const template: ReportTemplate = { pages: [{ widthMm: 100, heightMm: 60, components: [
      { ...staticTemplate().pages[0]!.components[0]! as PlanComponent, pageAnchor: "header" },
      { kind: "list", dataset: "rows", leftMm: 1, topMm: 20, widthMm: 90, rowHeightMm: 30, columns: [{ field: "value", header: "Value", widthMm: 90 }] }
    ] }] };
    const reports = { sample: { template, datasets: { rows: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }] } } };
    // Input estimate: static 4 + list header 1 + rows 4 = 9. Repeated actual grids exceed 12.
    await expect(createReportRuntime({ reports, budget: { maxCells: 12 } }).prepare({ reportIds: ["sample"] })).rejects.toMatchObject({ code: "budget", path: "$.budget.maxCells" });
    const prepared = await createReportRuntime({ reports, budget: { maxCells: 100 } }).prepare({ reportIds: ["sample"] });
    expect(prepared.stats.pages).toBeGreaterThan(1);
    expect(prepared.stats.cells).toBeGreaterThan(12);
  });

  it("rejects invalid aggregate limits rather than silently dropping the guard", () => {
    expect(() => createReportSource({}, { maxCells: 0 })).toThrow(/正安全整数/);
    expect(() => createReportSource({}, { maxCells: NaN })).toThrow(/正安全整数/);
  });
});
