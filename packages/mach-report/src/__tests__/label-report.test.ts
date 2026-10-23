// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createLabelTemplate, createReportSource, defineLabelReport, type DatasetContract, type LabelReportDefinitionOptions, type LabelReportRows, type ReportLoadContext, type ReportTemplate } from "../index";
import { createReportRuntime } from "../server/runtime";

interface Material { id: string; weight: number; copies?: number }
const rows: readonly Material[] = Object.freeze([Object.freeze({ id: "0001", weight: 0 }), Object.freeze({ id: "0002", weight: 25.125 })]);
const contract: DatasetContract = { rowKey: "id", fields: [{ field: "id", type: "text", required: true }, { field: "weight", type: "number", required: true }] };
function template(): ReportTemplate {
  return createLabelTemplate({ dataset: "materials", rowKey: "id", pages: [
    { components: [{ kind: "text", leftMm: 2, topMm: 2, widthMm: 60, heightMm: 8, style: { fontSize: 8 }, binding: { field: "id" } }] },
    { components: [{ kind: "text", leftMm: 2, topMm: 2, widthMm: 60, heightMm: 8, style: { fontSize: 8 }, binding: { field: "weight", format: { kind: "number", digits: 3 } } }] }
  ] });
}
function source(options: LabelReportDefinitionOptions) { return createReportSource({ labels: defineLabelReport(options) }); }
const request = { reportIds: ["labels"], params: {} };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

describe("flat label report definition", () => {
  it("maps named readonly business rows and one contract to the template dataset without copying", async () => {
    const definition = defineLabelReport({ template: template(), rows, dataSchema: contract });
    expect(definition.datasets?.materials).toBe(rows);
    expect(definition.dataSchema).toEqual({ materials: contract });
    expect((await createReportSource({ labels: definition })(request)).pages.map(page => page.components[0]?.text)).toEqual(["0001", "0.000", "0002", "25.125"]);
    expect(rows).toEqual([{ id: "0001", weight: 0 }, { id: "0002", weight: 25.125 }]);
  });

  it("uses template copy/face order, source dataset metadata and page budgets", async () => {
    const label = template(); label.repeat!.copies = { field: "copies" };
    const definition = defineLabelReport({ template: label, rows: [{ id: "001", weight: 0, copies: 2 }] });
    const plan = await createReportSource({ labels: definition })(request);
    expect(plan.pages.map(page => page.components[0]?.text)).toEqual(["001", "0.000", "001", "0.000"]);
    expect(plan.pages[2]?.meta?.record).toMatchObject({ dataset: "materials", rowKey: "001", copyIndex: 1, copyCount: 2, templatePageIndex: 0 });
    await expect(createReportSource({ labels: definition }, { maxPages: 3 })(request)).rejects.toMatchObject({ code: "validate", cause: { limit: 3, actual: 4 } });
  });

  it("returns no pages for an explicitly empty row array", async () => {
    expect((await source({ template: template(), rows: [] })(request)).pages).toEqual([]);
  });

  it("passes params and AbortSignal to a row loader and reuses parameter metadata", async () => {
    const controller = new AbortController();
    const load = vi.fn((context: ReportLoadContext) => {
      expect(context).toMatchObject({ reportId: "labels", params: { plant: "YTS0" }, signal: controller.signal });
      return Promise.resolve(rows);
    });
    const fetcher = source({ template: template(), load, dataSchema: contract, params: [{ field: "plant", label: "厂别", type: "text", required: true }] });
    expect(fetcher.getParamDefs(["labels"])).toMatchObject([{ field: "plant", required: true }]);
    await expect(fetcher({ ...request, params: { plant: "YTS0" }, signal: controller.signal })).resolves.toMatchObject({ pages: expect.any(Array) });
    expect(load).toHaveBeenCalledOnce();
    await expect(fetcher(request)).rejects.toMatchObject({ name: "ReportParamValidationError" });
    expect(load).toHaveBeenCalledOnce();
  });

  it("isolates concurrent row requests rather than retaining a mutable current dataset", async () => {
    const first = deferred<LabelReportRows>(), second = deferred<LabelReportRows>();
    const fetcher = source({ template: template(), load: ({ params }) => params.batch === "first" ? first.promise : second.promise });
    const a = fetcher({ ...request, params: { batch: "first" } }), b = fetcher({ ...request, params: { batch: "second" } });
    second.resolve([{ id: "B", weight: 2 }]); first.resolve([{ id: "A", weight: 1 }]);
    const results = await Promise.all([a, b]);
    expect(results.map(plan => plan.pages[0]?.components[0]?.text)).toEqual(["A", "B"]);
  });

  it("settles cancellation promptly even when a loader ignores its signal, without processing late rows", async () => {
    const controller = new AbortController(), pending = deferred<LabelReportRows>(), observed = vi.fn();
    const fetcher = createReportSource({ labels: defineLabelReport({ template: template(), load: () => pending.promise }) }, { onDatasets: observed });
    const result = fetcher({ ...request, signal: controller.signal });
    controller.abort("query replaced");
    await expect(result).rejects.toMatchObject({ name: "AbortError", cause: "query replaced" });
    pending.resolve(rows);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(observed).not.toHaveBeenCalled();
  });

  it("does not coerce values when a single dataset contract rejects invalid business data", async () => {
    const fetcher = source({ template: template(), load: () => [{ id: "001", weight: "0" }], dataSchema: contract });
    await expect(fetcher(request)).rejects.toMatchObject({ code: "validate", cause: { issues: [expect.objectContaining({ field: "weight", path: "$.datasets.materials[0].weight", code: "type" })] } });
  });

  it("retains data validation budgets and caller pagination options", async () => {
    await expect(source({ template: template(), rows, dataSchema: contract, dataValidation: { maxRows: 1 } })(request)).rejects.toMatchObject({ code: "validate", cause: { issues: [expect.objectContaining({ code: "budget" })] } });
    await expect(source({ template: template(), rows, pagination: { maxPages: 3 } })(request)).rejects.toMatchObject({ code: "validate", cause: { limit: 3, actual: 4 } });
  });

  it("works unchanged in Node runtime and counts records independently of faces", async () => {
    const runtime = createReportRuntime({ reports: { labels: defineLabelReport({ template: template(), rows, dataSchema: contract }) } });
    const prepared = await runtime.prepare({ reportIds: ["labels"] });
    expect(prepared.stats).toMatchObject({ rows: 2, pages: 4 });
  });

  it("retains source fetch errors and rejects wrapped responses rather than displaying false empty labels", async () => {
    const cause = new Error("HTTP failed");
    await expect(source({ template: template(), load: () => { throw cause; } })(request)).rejects.toMatchObject({ code: "fetch", cause });
    const malformed = { items: rows } as unknown as LabelReportRows;
    await expect(source({ template: template(), load: () => malformed })(request)).rejects.toMatchObject({ code: "validate", message: expect.stringContaining("数据映射失败") });
    expect(() => defineLabelReport({ template: template(), rows: malformed })).toThrow(/对象数组/);
    await expect(source({ template: template(), load: () => [null] as unknown as LabelReportRows })(request)).rejects.toMatchObject({ code: "validate", message: expect.stringContaining("应为对象数组") });
  });

  it("rejects ordinary/dynamic templates and ambiguous or missing row sources before querying", () => {
    expect(() => defineLabelReport({ template: { pages: [] }, rows })).toThrow(/repeat/);
    expect(() => defineLabelReport({ template: (() => template()) as unknown as ReportTemplate, rows })).toThrow(/repeat/);
    for (const data of [{ rows, load: () => rows }, {}, { load: "invalid" }]) {
      expect(() => defineLabelReport({ template: template(), ...data } as unknown as LabelReportDefinitionOptions)).toThrow(/只能配置 rows 或 load/);
    }
    const invalid = template(); invalid.repeat!.dataset = "__proto__";
    expect(() => defineLabelReport({ template: invalid, rows })).toThrow(/数据集/);
  });
});
