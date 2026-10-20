// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createReportSource } from "../source/report-source";
import { createTemplate } from "../builder/template-builder";
import { parseReportTemplate, serializeReportTemplate } from "../source/template-registry";
import { formatReportDateRange, isReportMonth, isReportYear, parseReportDateRange, reportParamsJsonSchema, validateReportParamDefinitions, validateReportParams } from "../source/param-validation";
import type { ReportParamDef } from "../layout/paginate";

const definitions: ReportParamDef[] = [
  { field: "month", type: "month", min: "2024-01", max: "2026-12", defaultValue: "2026-10" },
  { field: "year", type: "year", min: "2024", max: "2026" },
  { field: "period", type: "dateRange", required: true, min: "2024-02-01", max: "2026-12-31" },
];
function template() { return { ...createTemplate().page(100, 80).text("test", { leftMm: 0, topMm: 0, widthMm: 40, heightMm: 8 }).build(), params: definitions }; }

describe("calendar parameter wire contracts", () => {
  it("keeps exact string query values and leap dates across source loading and template serialization", async () => {
    const period = formatReportDateRange({ start: "2024-02-29", end: "2026-10-20" });
    expect(parseReportDateRange(period)).toEqual({ start: "2024-02-29", end: "2026-10-20" });
    const result = validateReportParams(definitions, { year: "2026", period });
    expect(result).toMatchObject({ ok: true, values: { month: "2026-10", year: "2026", period }, typedValues: { month: "2026-10", year: "2026", period } });
    const doc = parseReportTemplate({ schemaVersion: "1.0", id: "calendar", name: "Calendar", template: template() });
    expect(parseReportTemplate(serializeReportTemplate(doc)).template.params).toEqual(definitions);
    const load = vi.fn(() => ({}));
    await createReportSource({ calendar: { template: doc.template, load } })({ reportIds: ["calendar"], params: { year: "2026", period } });
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ params: { month: "2026-10", year: "2026", period } }));
  });
  it.each(["2026-10-20/", "/2026-10-20", "2026-10-21/2026-10-20", "2025-02-29/2025-03-01", "0000-01-01/2026-10-20", "2026-10-20/2026-10-20/", "2026-1-01/2026-10-20"])("rejects partial, reversed and invalid date ranges: %s", value => {
    expect(parseReportDateRange(value)).toBeUndefined();
    expect(validateReportParams([{ field: "period", type: "dateRange" }], { period: value }).issues).toEqual([expect.objectContaining({ field: "period", code: "type", path: "$.params.period" })]);
  });
  it("applies inclusive boundaries to both endpoints and accepts same-day ranges", () => {
    const defs: ReportParamDef[] = [{ field: "p", type: "dateRange", min: "2026-10-01", max: "2026-10-31" }];
    expect(validateReportParams(defs, { p: "2026-10-01/2026-10-31" }).ok).toBe(true);
    expect(validateReportParams(defs, { p: "2026-10-20/2026-10-20" }).ok).toBe(true);
    expect(validateReportParams(defs, { p: "2026-09-30/2026-11-01" }).issues.map(issue => issue.code)).toEqual(["minimum", "maximum"]);
    expect(() => formatReportDateRange({ start: "2026-10-21", end: "2026-10-20" })).toThrow(RangeError);
  });
  it("validates fixed-width months/years and preserves leading zeroes", () => {
    expect(isReportYear("0001")).toBe(true); expect(isReportYear("9999")).toBe(true);
    expect(isReportMonth("0001-01")).toBe(true); expect(isReportMonth("9999-12")).toBe(true);
    for (const value of ["2026-1", "2026-00", "2026-13", "0000-10", " 2026-10", "2026-10\n"]) expect(isReportMonth(value)).toBe(false);
    for (const value of ["0000", "26", "10000", "2026.0", "+2026", "2026\n"]) expect(isReportYear(value)).toBe(false);
    expect(validateReportParams([{ field: "y", type: "year" }], { y: "0001" }).values.y).toBe("0001");
    expect(validateReportParams(definitions, { year: "2027", month: "2023-12", period: "2026-10-20/2026-10-20" }).issues.map(issue => issue.code)).toEqual(["minimum", "maximum"]);
  });
  it("rejects invalid metadata/defaults before either JSON/schema export or business loading", async () => {
    for (const def of [
      { field: "m", type: "month", min: "2026-01-01" },
      { field: "y", type: "year", min: 2026 },
      { field: "p", type: "dateRange", min: "2026-10-01/2026-10-20" },
      { field: "p", type: "dateRange", defaultValue: "2026-10-20/" },
      { field: "m", type: "month", min: "2026-11", max: "2026-10" },
    ] as ReportParamDef[]) {
      expect(validateReportParamDefinitions([def])).toEqual(expect.arrayContaining([expect.objectContaining({ code: "definition" })]));
      expect(() => reportParamsJsonSchema([def])).toThrow();
    }
    const load = vi.fn(() => ({}));
    const source = createReportSource({ calendar: { template: template(), load } });
    await expect(source({ reportIds: ["calendar"], params: { period: "2026-10-20/" } })).rejects.toMatchObject({ code: "params" });
    expect(load).not.toHaveBeenCalled();
  });
  it("describes lexical formats honestly and retains calendar/order/boundary extensions for backend validators", () => {
    expect(reportParamsJsonSchema(definitions)).toMatchObject({ properties: {
      month: { type: "string", pattern: "^(?!0000)[0-9]{4}-(0[1-9]|1[0-2])(?![\\s\\S])", "x-report-minimum": "2024-01" },
      year: { type: "string", pattern: "^(?!0000)[0-9]{4}(?![\\s\\S])" },
      period: { type: "string", "x-report-date-range": { separator: "/", ordered: true, calendarDates: true }, "x-report-maximum": "2026-12-31" },
    } });
    const properties = reportParamsJsonSchema(definitions).properties as Record<string, { pattern?: string }>;
    for (const [field, value] of [["month", "2026-10"], ["year", "2026"], ["period", "2026-10-01/2026-10-20"]]) {
      const pattern = new RegExp(properties[field!]!.pattern!); expect(pattern.test(value!)).toBe(true); expect(pattern.test(`${value}\n`)).toBe(false);
    }
    expect(validateReportParams([{ field: "period", type: "dateRange" }], { period: "" })).toMatchObject({ ok: true, values: { period: "" }, typedValues: {} });
  });
});
