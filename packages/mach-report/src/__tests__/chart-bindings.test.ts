// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createReportChartData, type ReportChartBinding } from "../processing/chart-data";
import { paginateTemplate, type ReportTemplate } from "../layout/paginate";
import { createTableTemplate } from "../builder/table-template";
import { createReportEditSession } from "../editing/session";
import { createReportCellEditBatch } from "../editing/batch";
import { validateReportTemplate } from "../source/template-registry";
import { validateRenderPlan } from "../schema/validate";
import { collectTemplateDatasetBindings } from "../source/template-bindings";
import { reportDateDefault } from "../source/date-defaults";

const binding: ReportChartBinding = { dataset: "detail", categoryField: "shift", type: "bar", measures: [{ field: "qty", op: "sum", label: "产重" }] };
function template(): ReportTemplate { return { pages: [{ widthMm: 210, heightMm: 297, components: [{ kind: "chart", leftMm: 10, topMm: 10, widthMm: 160, heightMm: 60, chartBinding: binding }] }] }; }
describe("declarative chart aggregation and portable defaults", () => {
  it("aggregates each category once and retains typed categories, zero, null and stable source inputs", () => {
    const rows = [{ shift: "0001", qty: 0 }, { shift: "0001", qty: 3 }, { shift: null, qty: null }, { shift: "甲", qty: 8 }];
    const result = createReportChartData(rows, binding);
    expect(result).toEqual({ categories: ["0001", "—", "甲"], series: [{ name: "产重", values: [3, null, 8] }] });
    expect(rows[0]!.qty).toBe(0);
    expect(createReportChartData([{ shift: 1, qty: 1 }, { shift: "1", qty: 2 }], binding).series[0]!.values).toEqual([1, 2]);
  });
  it("reuses exact aggregation before bounded numeric plotting and rejects implicit number coercion", () => {
    const decimal = { ...binding, measures: [{ field: "qty", op: "avg" as const, numeric: "decimal" as const, digits: 2 }] };
    expect(createReportChartData([{ shift: "A", qty: "0.1" }, { shift: "A", qty: "0.2" }], decimal).series[0]!.values).toEqual([0.15]);
    expect(() => createReportChartData([{ shift: "A", qty: "00123" }], binding)).toThrow(/不能隐式/);
    expect(createReportChartData([{ shift: "B", qty: 1 }, { shift: "A", qty: 2 }], { ...binding, sort: "asc" }).categories).toEqual(["A", "B"]);
  });
  it("fails before category expansion and rejects malformed declarations and cancellation", () => {
    expect(() => createReportChartData([{ shift: "A" }, { shift: "B" }], { ...binding, maxCategories: 1 })).toThrow(/分类超出/);
    expect(() => createReportChartData([{}, {}], { ...binding, maxRows: 1 })).toThrow(/行数预算/);
    for (const patch of [{ measures: [] }, { categoryField: "__proto__" }, { type: "pie" }, { maxCategories: 201 }, { sort: "guess" }])
      expect(() => createReportChartData([], { ...binding, ...patch } as ReportChartBinding)).toThrow();
    const controller = new AbortController(); controller.abort();
    expect(() => createReportChartData([{}], binding, controller.signal)).toThrow(/取消/);
  });
  it("resolves chart bindings for static and flow pages, validates references and reports missing datasets", () => {
    const input = template(); expect(validateReportTemplate(input).ok).toBe(true);
    expect(collectTemplateDatasetBindings(input)[0]!.fields.map(item => item.field)).toEqual(["shift", "qty"]);
    const plan = paginateTemplate(input, { detail: [{ shift: "甲", qty: 3 }] }).plan;
    expect(plan.pages[0]!.components.some(item => item.kind === "rect")).toBe(true);
    expect(plan.pages[0]!.components.every(item => !item.chartBinding)).toBe(true);
    expect(validateRenderPlan(plan).ok).toBe(true);
    expect(() => paginateTemplate(input, {})).toThrow(/未提供/);
    expect(paginateTemplate(input, { detail: [] }).plan.pages[0]!.components[0]!.text).toBe("—");
    expect(validateRenderPlan({ schemaVersion: "test", pages: [{ pageWidthMm: 210, pageHeightMm: 297, components: input.pages[0]!.components }] }).ok).toBe(false);
  });
  it("recomputes a bound chart in the existing edit transaction without mutating the prior plan", async () => {
    const input = createTableTemplate({ columns: [{ header: "编号", field: "id" }, { header: "班别", field: "shift" }, { header: "产重", field: "qty", valueType: "number" }], listOptions: { rowKey: "id" } });
    input.pages[0]!.components.push(template().pages[0]!.components[0]!);
    const session = createReportEditSession({ template: input, datasets: { detail: [{ id: "001", shift: "甲", qty: 3 }] } });
    const initial = session.plan, page = initial.pages[0]!;
    const componentIndex = page.components.findIndex(item => item.table?.role === "body");
    const before = page.components.find(item => item.kind === "rect" && !item.grid)!.heightMm;
    const edits = createReportCellEditBatch(initial, [{ address: { pageIndex: 0, componentIndex, rowIndex: 0, columnIndex: 2 }, value: 0 }], "chart-edit");
    const prepared = await session.prepare(initial, edits);
    expect(prepared.plan.pages[0]!.components.find(item => item.kind === "rect" && !item.grid)!.heightMm).toBe(0);
    expect(initial.pages[0]!.components.find(item => item.kind === "rect" && !item.grid)!.heightMm).toBe(before);
  });
  it("resolves explicit business time zones and calendar boundaries without consulting a hidden clock", () => {
    const now = Date.parse("2026-01-31T20:00:00Z");
    expect(reportDateDefault({ preset: "today", now, timeZone: "Asia/Shanghai" })).toBe("2026-02-01");
    expect(reportDateDefault({ preset: "yesterday", now, timeZone: "Asia/Shanghai" })).toBe("2026-01-31");
    expect(reportDateDefault({ preset: "month-start", now, timeZone: "UTC", offsetDays: -1 })).toBe("2025-12-31");
    expect(reportDateDefault({ preset: "month-end", now: new Date("2024-02-15T12:00:00Z"), timeZone: "UTC" })).toBe("2024-02-29");
    expect(() => reportDateDefault({ preset: "today", now: NaN, timeZone: "UTC" })).toThrow();
    expect(() => reportDateDefault({ preset: "today", now, timeZone: "" })).toThrow();
    expect(() => reportDateDefault({ preset: "today", now, timeZone: "UTC", offsetDays: 1.5 })).toThrow();
    expect(() => reportDateDefault({ preset: "today", now, timeZone: "Invalid/Zone" })).toThrow();
  });
});
