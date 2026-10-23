// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createLabelTemplate } from "../builder/label-template";
import { createTemplate } from "../builder/template-builder";
import { paginateTemplate, paginateTemplatePages, type ReportTemplate, type TemplatePage } from "../layout/paginate";
import { ReportBindingError } from "../layout/record-pages";
import type { PlanComponent } from "../schema/render-plan";
import { validateReportTemplate, defineReportTemplate } from "../source/template-registry";
import { createReportSource } from "../source/report-source";
import { collectTemplateDatasetBindings } from "../source/template-bindings";
import { diffReportTemplates } from "../source/template-diff";
import { reviewReportTemplate } from "../source/template-review";
import { createReportRuntime } from "../server/runtime";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const text = (field: string, patch: Partial<PlanComponent> = {}): PlanComponent => ({ kind: "text", leftMm: 2, topMm: 2, widthMm: 60, heightMm: 8, style: { fontSize: 8 }, binding: { field }, ...patch });
function label(components: PlanComponent[] = [text("id")], patch: Partial<ReportTemplate["repeat"]> = {}): ReportTemplate {
  return createLabelTemplate({ dataset: "products", rowKey: "id", components, ...patch });
}
function boundText(template: ReportTemplate, row: Record<string, unknown>): string | undefined {
  return paginateTemplate(template, { products: [row] }).plan.pages[0]?.components[0]?.text;
}

describe("fixed industrial label pages", () => {
  it("declares 80×55mm zero-margin labels and keeps an independent JSON template", () => {
    const component = text("id"), template = label([component]);
    expect(template.pages[0]).toMatchObject({ widthMm: 80, heightMm: 55, marginTopMm: 0, marginBottomMm: 0, marginLeftMm: 0, marginRightMm: 0 });
    component.binding!.field = "changed";
    expect((template.pages[0]!.components[0] as PlanComponent).binding?.field).toBe("id");
    expect(validateReportTemplate(template).ok).toBe(true);
  });
  it("inherits custom dimensions across front/back faces in record → copy → face order", () => {
    const template = createLabelTemplate({ dataset: "products", rowKey: "id", copies: { field: "copies" }, widthMm: 100, heightMm: 60, pages: [{ components: [text("id", { binding: { field: "id", prefix: "Front " } })] }, { components: [text("id", { binding: { field: "id", prefix: "Back " } })] }] });
    const plan = paginateTemplate(template, { products: [{ id: "001", copies: 2 }, { id: "002", copies: 1 }] }).plan;
    expect(plan.pages.map(page => page.components[0]!.text)).toEqual(["Front 001", "Back 001", "Front 001", "Back 001", "Front 002", "Back 002"]);
    expect(plan.pages.map(page => [page.pageWidthMm, page.pageHeightMm])).toEqual(Array.from({ length: 6 }, () => [100, 60]));
    expect(plan.pages[2]!.meta?.record).toEqual({ dataset: "products", rowIndex: 0, rowKey: "001", copyIndex: 1, copyCount: 2, templatePageIndex: 0 });
  });
  it("supports the chain builder without changing ordinary page defaults", () => {
    const template = createTemplate().repeat({ dataset: "products" }).page(80, 55, { marginTopMm: 0, marginBottomMm: 0, marginLeftMm: 0, marginRightMm: 0 }).text("Static", { widthMm: 20, heightMm: 8 }).build();
    expect(paginateTemplate(template, { products: [{ id: "001" }, { id: "002" }] }).plan.pages).toHaveLength(2);
  });
  it("returns zero pages for an empty dataset, including front/back copies", () => {
    const template = createLabelTemplate({ dataset: "products", copies: 3, pages: [{ components: [] }, { components: [] }] });
    expect(paginateTemplate(template, { products: [] }).plan.pages).toEqual([]);
    expect([...paginateTemplatePages(template, { products: [] })]).toEqual([]);
  });
  it("checks record keys and complete page budget before touching bound payloads", () => {
    let reads = 0;
    const first = { id: "001", get payload() { reads++; return "not read"; } };
    expect(() => paginateTemplate(label([text("payload")], { copies: 2 }), { products: [first, { id: "002" }] }, { maxPages: 3 })).toThrow(/上限 3/);
    expect(reads).toBe(0);
    expect(() => paginateTemplate(label(), { products: [{ id: "001" }, { id: "001" }] })).toThrow(/主键重复/);
    expect(paginateTemplate(label(), { products: [{ id: "1" }, { id: 1 }] }).plan.pages).toHaveLength(2);
  });
  it("bounds default repeated pages and total components without allocating output pages", () => {
    expect(() => paginateTemplate(label([], { copies: 1000 }), { products: Array.from({ length: 11 }, (_, i) => ({ id: i })) })).toThrow(/上限 10000/);
    const components = Array.from({ length: 251 }, () => text("id"));
    expect(() => paginateTemplate(label(components, { copies: 1000 }), { products: [{ id: "001" }] })).toThrow(/组件总量/);
  });
  it.each(["cells", "null slots", "nested null slots"])("budgets repeated grid %s before binding payloads or allocating the first page", kind => {
    const grid: PlanComponent = { kind: "rect", leftMm: 2, topMm: 2, widthMm: 60, heightMm: 30, grid: { cells: [Array.from({ length: 251 }, () => kind === "cells" ? { text: "" } : null)] } };
    const component: PlanComponent = kind === "nested null slots" ? { kind: "rect", leftMm: 2, topMm: 2, widthMm: 60, heightMm: 30, grid: { cells: [[{ children: [grid] }]] } } : grid;
    const template = label([component, text("payload")], { copies: 1000 });
    let reads = 0, measurements = 0;
    const row = { id: "001", get payload() { reads++; return "not read"; } };
    expect(() => paginateTemplate(template, { products: [row] }, { measurer: { measureMm: () => { measurements++; return 1; } } })).toThrow(/组件总量（含网格行、槽位及嵌套组件）.*250000/);
    expect(reads).toBe(0);
    expect(measurements).toBe(0);
  });
  it("keeps ordinary maxCells semantics while budgeting null grid slots separately", () => {
    const component: PlanComponent = { kind: "rect", leftMm: 2, topMm: 2, widthMm: 60, heightMm: 30, grid: { cells: [[null, null]] } };
    const plan = paginateTemplate(label([component], { copies: 2 }), { products: [{ id: "001" }] }, { maxCells: 1 }).plan;
    expect(plan.pages).toHaveLength(2);
    expect(plan.pages[1]!.components[0]!.grid!.cells).toEqual([[null, null]]);
  });
  it.each([0, -1, 1.5, 1001, "2", true, null])("rejects invalid copy count %s", copies => {
    const template = label([], { copies: { field: "count" } });
    expect(() => paginateTemplate(template, { products: [{ id: "001", count: copies }] })).toThrow(/1\.\.1000/);
  });
  it("honours cancellation between lazy pages", () => {
    const controller = new AbortController();
    const pages = paginateTemplatePages(label(), { products: [{ id: "001" }, { id: "002" }] }, { signal: controller.signal });
    expect(pages.next().done).toBe(false);
    controller.abort(new Error("stop labels"));
    expect(() => pages.next()).toThrow("stop labels");
  });
  it("shares source/runtime page-budget errors and counts records without counting copies twice", async () => {
    const template = label([text("id")], { copies: 2 });
    const reports = { coil: { template, datasets: { products: [{ id: "001" }, { id: "002" }] } } };
    const runtime = createReportRuntime({ reports, budget: { maxPages: 3 } });
    await expect(runtime.prepare({ reportIds: ["coil"] })).rejects.toMatchObject({ code: "budget", path: "$.budget.maxPages" });
    const prepared = await createReportRuntime({ reports }).prepare({ reportIds: ["coil"] });
    expect(prepared.stats).toMatchObject({ rows: 2, pages: 4 });
    await expect(createReportRuntime({ reports, budget: { maxRows: 1 } }).prepare({ reportIds: ["coil"] })).rejects.toMatchObject({ code: "budget", path: "$.budget.maxRows" });
  });
  it("accepts an empty label report after the preceding report exhausts the shared page budget", async () => {
    const source = createReportSource({ first: { template: label(), datasets: { products: [{ id: "001" }] } }, empty: { template: label(), datasets: { products: [] } } }, { maxPages: 1 });
    expect((await source({ reportIds: ["first", "empty"], params: {} })).pages).toHaveLength(1);
  });
});

describe("label record bindings", () => {
  it("preserves real zero, false, leading zero identifiers and decimal precision", () => {
    expect(boundText(label([text("value")]), { id: "1", value: 0 })).toBe("0");
    expect(boundText(label([text("value")]), { id: "1", value: false })).toBe("false");
    expect(boundText(label([text("value")]), { id: "1", value: "000108" })).toBe("000108");
    const template = label([text("value", { binding: { field: "value", format: { kind: "number", digits: 3 }, prefix: "重量 ", suffix: " kg" } })]);
    expect(boundText(template, { id: "1", value: "1284.225" })).toBe("重量 1284.225 kg");
  });
  it("reads literal own fields and applies emptyText only to empty values", () => {
    const template = label([text("product.grade", { binding: { field: "product.grade", emptyText: "—", prefix: "Grade " } })]);
    expect(boundText(template, { id: "1", "product.grade": "S304H3" })).toBe("Grade S304H3");
    expect(boundText(template, { id: "1", "product.grade": null })).toBe("—");
    expect(() => boundText(template, { id: "1", product: { grade: "S304H3" } })).toThrow(/自有数据字段/);
    const inherited = Object.assign(Object.create({ "product.grade": "hidden" }) as Record<string, unknown>, { id: "1" });
    expect(() => boundText(template, inherited)).toThrow(ReportBindingError);
  });
  it("never executes accessors or converts structured objects into labels", () => {
    let reads = 0;
    expect(() => boundText(label([text("value")]), { id: "1", get value() { reads++; return "bad"; } })).toThrow(/访问器/);
    expect(reads).toBe(0);
    expect(() => boundText(label([text("value")]), { id: "1", value: { secret: "not serialized" } })).toThrow(/有限数字/);
  });
  it("removes template bindings and stale text/image assets without mutating input", () => {
    const template = label([text("id", { lines: ["OLD"], richParagraphs: [{ segments: [{ text: "OLD" }] }] }), { ...text("id"), kind: "qrcode", imageData: PNG, code: { errorCorrection: "M" } }]);
    const before = JSON.stringify(template), datasets = { products: [{ id: "00108" }] }, dataBefore = JSON.stringify(datasets);
    const components = paginateTemplate(template, datasets).plan.pages[0]!.components;
    expect(components[0]).toMatchObject({ text: "00108", lines: ["00108"] });
    expect(components[0]!.binding).toBeUndefined(); expect(components[0]!.richParagraphs).toBeUndefined();
    expect(components[1]).toMatchObject({ code: { value: "00108", errorCorrection: "M" }, fallbackText: "00108" });
    expect(components[1]!.binding).toBeUndefined(); expect(components[1]!.imageData).toBeUndefined();
    expect(JSON.stringify(template)).toBe(before); expect(JSON.stringify(datasets)).toBe(dataBefore);
  });
  it("accepts bound PNG/JPEG data URLs, leaves optional empty images blank and rejects remote URLs", () => {
    const template = label([{ ...text("logo"), kind: "image" }]);
    expect(paginateTemplate(template, { products: [{ id: "1", logo: PNG }] }).plan.pages[0]!.components[0]!.imageData).toBe(PNG);
    expect(paginateTemplate(template, { products: [{ id: "1", logo: null }] }).plan.pages[0]!.components).toEqual([]);
    expect(() => paginateTemplate(template, { products: [{ id: "1", logo: "https://example.com/logo.png" }] })).toThrow(/PNG\/JPEG/);
  });
  it("rejects text overflow before producing labels that cover codes in PDF", () => {
    expect(() => boundText(label([text("value", { widthMm: 10, heightMm: 4 })]), { id: "1", value: "Product description too long for a tiny label" })).toThrow(/文字需要约/);
  });
  it("runs through the existing source API and validates samples/schema bindings", async () => {
    const template = label([text("grade")], { copies: { field: "count" } });
    const source = createReportSource({ coil: { template, load: () => ({ products: [{ id: "001", grade: "S304H3", count: 1 }] }) } });
    expect((await source({ reportIds: ["coil"], params: {} })).pages[0]!.components[0]!.text).toBe("S304H3");
    const refs = collectTemplateDatasetBindings(template);
    expect(refs[0]!.fields.map(item => item.field)).toEqual(["id", "count", "grade"]);
    const document = defineReportTemplate({ id: "coil", name: "Coil", template });
    const review = reviewReportTemplate(document, { dataSchemas: { products: { fields: [{ field: "id", type: "text" }] } } });
    expect(review.issues.filter(issue => issue.code === "field").map(issue => issue.field)).toEqual(["count", "grade"]);
    const next = defineReportTemplate({ id: "coil", name: "Coil", template: label([text("grade")], { copies: 2 }) });
    expect(diffReportTemplates(document, next).changes.find(change => change.path === "$.template.repeat.copies")?.breaking).toBe(true);
  });
  it("locates output diagnostics in the original template after an optional image is omitted", () => {
    const document = defineReportTemplate({ id: "coil", name: "Coil", template: label([{ ...text("logo"), kind: "image" }, { ...text("id"), kind: "qrcode" }]) });
    const review = reviewReportTemplate(document, { fixtures: [{ name: "no logo", datasets: { products: [{ id: "001", logo: null }] } }], formats: ["pdf"] });
    expect(review.issues.find(issue => issue.code === "output")?.path).toBe("$.template.pages[0].components[1]");
  });
  it("binds nested components while preserving null grid placeholders", () => {
    const component: PlanComponent = { kind: "rect", leftMm: 2, topMm: 2, widthMm: 50, heightMm: 15, grid: { cells: [[{ children: [text("id")] }, null]] } };
    const children = paginateTemplate(label([component]), { products: [{ id: "001" }] }).plan.pages[0]!.components[0]!.grid!.cells[0];
    expect(children?.[0]?.children?.[0]).toMatchObject({ text: "001" });
    expect(children?.[0]?.children?.[0]?.binding).toBeUndefined();
    expect(children?.[1]).toBeNull();
  });
});

describe("label template validation", () => {
  it("requires repeat for bindings and rejects unsafe fields/options", () => {
    expect(validateReportTemplate({ pages: [{ widthMm: 80, heightMm: 55, components: [text("id")] }] }).errors[0]?.message).toMatch(/repeat/);
    for (const field of ["", "constructor", "__proto__", "prototype"]) expect(() => label([text(field)])).toThrow(/绑定字段/);
    expect(() => label([text("id")], { copies: 0 })).toThrow(/复制数/);
    expect(() => createLabelTemplate({ dataset: "products", components: [], pages: [] })).toThrow(/只能选择一种/);
  });
  it("rejects label components outside physical paper and dynamic layouts", () => {
    expect(() => label([text("id", { leftMm: 75, widthMm: 20 })])).toThrow(/纸张边界/);
    const page: TemplatePage = { widthMm: 80, heightMm: 55, layout: "wide", components: [] };
    expect(validateReportTemplate({ repeat: { dataset: "products" }, pages: [page] }).errors[0]?.message).toMatch(/固定尺寸/);
    const dynamic = createTemplate().page(80, 55).list("products", { widthMm: 60 }, [{ header: "ID", field: "id", widthMm: 60 }]).build();
    dynamic.repeat = { dataset: "products" };
    expect(validateReportTemplate(dynamic).errors[0]?.message).toMatch(/固定组件/);
  });
  it("reports missing datasets and row keys with precise locations", () => {
    expect(() => paginateTemplate(label(), {})).toThrow(/\$\.datasets.products/);
    expect(() => paginateTemplate(label(), { products: [{ value: 1 }] })).toThrow(/products\[0\].id/);
    expect(() => paginateTemplate(label(), { products: [{ id: " " }] })).toThrow(/主键/);
  });
  it("performs label binding configuration validation on direct paginator input too", () => {
    const template = label(), component = template.pages[0]!.components[0] as PlanComponent;
    component.binding = { field: "id", format: { kind: "number", digits: 101 } };
    expect(() => paginateTemplate(template, { products: [{ id: 1 }] })).toThrow(/精度/);
    component.binding = { field: "constructor" };
    expect(() => paginateTemplate(template, { products: [{ id: "1" }] })).toThrow(/绑定字段/);
  });
});
