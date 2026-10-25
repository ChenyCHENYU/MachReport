// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createTextMeasurementCache } from "../layout/text-measure-cache";
import { heuristicMeasurer } from "../layout/textwrap";
import { paginateTemplate } from "../layout/paginate";
import { createTableTemplate } from "../builder/table-template";

describe("pagination-owned measurement cache", () => {
  it("deduplicates actual token measurements across 1000 identical rows without changing grids", () => {
    const measureMm = vi.fn(heuristicMeasurer.measureMm);
    const template = createTableTemplate({ columns: [{ field: "grade", header: "Grade" }, { field: "qty", header: "Qty" }] });
    const datasets = { detail: Array.from({ length: 1000 }, () => ({ grade: "S304L", qty: 42 })) };
    const actual = paginateTemplate(template, datasets, { measurer: { measureMm } }).plan;
    expect(actual).toEqual(paginateTemplate(template, datasets).plan);
    expect(actual.pages.flatMap(page => page.components).filter(component => component.table?.role === "body")).toHaveLength(1000);
    expect(measureMm.mock.calls.length).toBeLessThan(20);
  });

  it("keys every metric input and caches zero widths", () => {
    const measureMm = vi.fn(() => 0), cached = createTextMeasurementCache({ measureMm });
    const base = { fontSizePt: 10 };
    for (const options of [base, { ...base, fontSizePt: 11 }, { ...base, fontFamily: "Other" }, { ...base, bold: true }, { ...base, italic: true }, { ...base, letterSpacingPt: 1 }]) {
      expect(cached.measureMm("value", options)).toBe(0);
      expect(cached.measureMm("value", options)).toBe(0);
    }
    expect(measureMm).toHaveBeenCalledTimes(6);
  });

  it("does not retain invalid widths or unbounded text and evicts old entries", () => {
    const measureMm = vi.fn(() => 1), cached = createTextMeasurementCache({ measureMm });
    for (let index = 0; index < 4097; index++) cached.measureMm(String(index), { fontSizePt: 10 });
    cached.measureMm("0", { fontSizePt: 10 });
    expect(measureMm).toHaveBeenCalledTimes(4098);
    const long = "x".repeat(140_000);
    cached.measureMm(long, { fontSizePt: 10 }); cached.measureMm(long, { fontSizePt: 10 });
    expect(measureMm).toHaveBeenCalledTimes(4100);
    const invalid = vi.fn(() => NaN), noInvalid = createTextMeasurementCache({ measureMm: invalid });
    noInvalid.measureMm("x", { fontSizePt: 10 }); noInvalid.measureMm("x", { fontSizePt: 10 });
    expect(invalid).toHaveBeenCalledTimes(2);
  });

  it("bounds retained text independently of entry count and refreshes recent entries", () => {
    const measureMm = vi.fn(() => 1), cached = createTextMeasurementCache({ measureMm }), options = { fontSizePt: 10 };
    const first = "a".repeat(40_000), second = "b".repeat(40_000), third = "c".repeat(40_000), fourth = "d".repeat(40_000);
    for (const text of [first, second, third, first, fourth, first]) cached.measureMm(text, options);
    expect(measureMm).toHaveBeenCalledTimes(4);
    cached.measureMm(second, options); expect(measureMm).toHaveBeenCalledTimes(5);
  });

  it("starts fresh for each pagination so host font calibration changes are observed", () => {
    const template = createTableTemplate({ columns: [{ field: "text", header: "Text", widthMm: 20 }] });
    const datasets = { detail: [{ text: "some words some words some words" }] };
    let scale = 1;
    const measurer = { measureMm: (text: string) => text.length * scale };
    const small = paginateTemplate(template, datasets, { measurer }).plan;
    scale = 10;
    const large = paginateTemplate(template, datasets, { measurer }).plan;
    const height = (plan: typeof small) => plan.pages.flatMap(page => page.components).find(component => component.table?.role === "body")!.heightMm;
    expect(height(large)).toBeGreaterThan(height(small));
  });
});
