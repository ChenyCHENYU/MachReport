// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createLabelTemplate } from "../builder/label-template";
import { paginateTemplate, paginateTemplatePages, type PaginateOptions } from "../layout/paginate";
import { createRecordTextWrapper } from "../layout/record-pages-text";
import { heuristicMeasurer, type TextMeasureOptions } from "../layout/textwrap";
import type { PlanComponent } from "../schema/render-plan";

const text = (patch: Partial<PlanComponent> = {}): PlanComponent => ({ kind: "text", leftMm: 2, topMm: 2, widthMm: 76, heightMm: 8, style: { fontSize: 8 }, text: "STATIC", ...patch });
const metrics: TextMeasureOptions = { fontSizePt: 8 };
const measurer = () => ({ measureMm: vi.fn(heuristicMeasurer.measureMm) });

describe("request-scoped repeated-label text layout", () => {
  it("measures static labels and repeated bound values once while retaining every unique serial", () => {
    const measure = measurer();
    const template = createLabelTemplate({ dataset: "labels", components: [text(), text({ topMm: 12, binding: { field: "grade" } }), text({ topMm: 22, binding: { field: "serial" } })] });
    const labels = Array.from({ length: 1000 }, (_, index) => ({ grade: index % 2 ? "S304H3" : "S316LS", serial: `MR${index}` }));
    const result = paginateTemplate(template, { labels }, { measurer: measure });
    expect(result.plan.pages).toHaveLength(1000);
    expect(measure.measureMm).toHaveBeenCalledTimes(1003);
    expect(result.plan.pages[999]!.components.map(component => component.lines)).toEqual([["STATIC"], ["S304H3"], ["MR999"]]);
  });

  it("reuses measurement across copies without sharing mutable output lines", () => {
    const measure = measurer();
    const template = createLabelTemplate({ dataset: "labels", copies: 1000, components: [text({ binding: { field: "serial" } })] });
    const pages = paginateTemplatePages(template, { labels: [{ serial: "MR001" }] }, { measurer: measure });
    const first = pages.next().value!;
    first.components[0]!.lines![0] = "host edit";
    const second = pages.next().value!;
    expect(second.components[0]!.lines).toEqual(["MR001"]);
    expect(second.components[0]!.lines).not.toBe(first.components[0]!.lines);
    expect(measure.measureMm).toHaveBeenCalledTimes(1);
    pages.return(undefined);
  });

  it("isolates pagination invocations and different template geometry", () => {
    const measure = measurer(), template = createLabelTemplate({ dataset: "labels", components: [text()] });
    for (let index = 0; index < 2; index++) paginateTemplate(template, { labels: [{}] }, { measurer: measure });
    expect(measure.measureMm).toHaveBeenCalledTimes(2);
    const original = JSON.stringify(template);
    paginateTemplate(template, { labels: [{}, {}] });
    expect(JSON.stringify(template)).toBe(original);
    const wrapper = createRecordTextWrapper();
    const broad = wrapper("AAAA BBBB", 76, metrics, heuristicMeasurer);
    const narrow = wrapper("AAAA BBBB", 9, metrics, heuristicMeasurer);
    expect(broad).toEqual(["AAAA BBBB"]);
    expect(narrow.length).toBeGreaterThan(1);
  });

  it("rechecks current height and diagnostic row on a cache hit", () => {
    const template = createLabelTemplate({ dataset: "labels", components: [text()] });
    const pages = paginateTemplatePages(template, { labels: [{}, {}] });
    expect(pages.next().done).toBe(false);
    (template.pages[0]!.components[0] as PlanComponent).heightMm = 0.5;
    expect(() => pages.next()).toThrow(expect.objectContaining({ rowIndex: 1, path: "$.pages.0.components.0" }));
  });

  it("still cancels between copies that only contain cached text", () => {
    const controller = new AbortController(), measure = measurer();
    const template = createLabelTemplate({ dataset: "labels", copies: 2, components: [text()] });
    const pages = paginateTemplatePages(template, { labels: [{}] }, { measurer: measure, signal: controller.signal });
    expect(pages.next().done).toBe(false);
    controller.abort(new Error("cancel cached label"));
    expect(() => pages.next()).toThrow("cancel cached label");
    expect(measure.measureMm).toHaveBeenCalledTimes(1);
  });

  it("refreshes layout when a host changes font metrics or the measurer between lazy pages", () => {
    const template = createLabelTemplate({ dataset: "labels", components: [text()] });
    const first = measurer(), second = measurer(), options: PaginateOptions = { measurer: first };
    const pages = paginateTemplatePages(template, { labels: [{}, {}, {}] }, options);
    pages.next();
    (template.pages[0]!.components[0] as PlanComponent).style!.fontSize = 9;
    pages.next();
    expect(first.measureMm.mock.calls.map(([, style]) => style.fontSizePt)).toEqual([8, 9]);
    options.measurer = second;
    pages.next();
    expect(second.measureMm).toHaveBeenCalledTimes(1);
  });
});

describe("bounded label wrap cache", () => {
  it("uses a complete font and geometry key and independently returned line arrays", () => {
    const wrap = createRecordTextWrapper(), measure = measurer();
    const first = wrap("LABEL", 60, metrics, measure);
    first[0] = "mutated";
    expect(wrap("LABEL", 60, metrics, measure)).toEqual(["LABEL"]);
    for (const option of [{ fontSizePt: 9 }, { ...metrics, fontFamily: "Custom" }, { ...metrics, bold: true }, { ...metrics, italic: true }, { ...metrics, letterSpacingPt: 0.2 }]) wrap("LABEL", 60, option, measure);
    wrap("LABEL", 61, metrics, measure);
    expect(measure.measureMm).toHaveBeenCalledTimes(7);
  });

  it("evicts the least recently used entry at the entry budget", () => {
    const wrap = createRecordTextWrapper(), measure = measurer();
    for (let index = 0; index < 512; index++) wrap(`VALUE${index}`, 76, metrics, measure);
    wrap("VALUE0", 76, metrics, measure);
    wrap("VALUE512", 76, metrics, measure);
    wrap("VALUE0", 76, metrics, measure);
    expect(measure.measureMm).toHaveBeenCalledTimes(513);
    wrap("VALUE1", 76, metrics, measure);
    expect(measure.measureMm).toHaveBeenCalledTimes(514);
  });

  it("also bounds retained text when fewer than 512 entries contain large field values", () => {
    const wrap = createRecordTextWrapper(), measure = { measureMm: vi.fn(() => 1) };
    const values = Array.from({ length: 9 }, (_, index) => `${index}${"A".repeat(16_000)}`);
    for (const value of values) wrap(value, 76, metrics, measure);
    wrap(values[0]!, 76, metrics, measure);
    expect(measure.measureMm).toHaveBeenCalledTimes(10);
  });

  it("does not retain oversized entries or failed measurements", () => {
    const wrap = createRecordTextWrapper(), measure = { measureMm: vi.fn(() => 1) };
    const large = "A".repeat(140_000);
    wrap(large, 76, metrics, measure); wrap(large, 76, metrics, measure);
    expect(measure.measureMm).toHaveBeenCalledTimes(2);
    const failing = { measureMm: vi.fn(() => { throw new Error("font unavailable"); }) };
    for (let index = 0; index < 2; index++) expect(() => wrap("LABEL", 76, metrics, failing)).toThrow("font unavailable");
    expect(failing.measureMm).toHaveBeenCalledTimes(2);
  });
});
