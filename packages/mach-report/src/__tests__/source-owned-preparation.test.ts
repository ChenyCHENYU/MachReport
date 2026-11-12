// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTemplate } from "../builder/template-builder";
import { snapshotLayoutPart, snapshotLayoutPartAsync } from "../editing/session-snapshot";
import { createReportSource } from "../source/report-source";
import { createReportRuntime } from "../server/runtime";
import { validateDatasetRows, iterateDatasetValidation, type DatasetContract } from "../schema/dataset";
import { drainCooperatively } from "../processing/cooperative";
import * as computed from "../processing/computed";
import * as predicates from "../processing/predicate";
import * as preparation from "../layout/list-preparation";
import { paginateTemplate, estimateListLayoutCells, type DatasetRows, type ReportTemplate } from "../layout/paginate";
import { inspectOwnedSource } from "../source/owned-inspection";

afterEach(() => vi.restoreAllMocks());
const plainTemplate = createTemplate().page(100, 80).list("rows", { leftMm: 0, topMm: 10, widthMm: 80 }, [{ field: "id", header: "ID", widthMm: 80 }]).build();
function matrixTemplate(): ReportTemplate {
  const template = structuredClone(plainTemplate), list = template.pages[0]!.components[0]!;
  if (list.kind !== "list") throw new Error("expected list");
  list.computed = [{ field: "dimension", expression: { field: "plant" } }];
  list.rowVisibleWhen = { field: "value", op: ">", value: 0 };
  list.matrix = { rowFields: ["dimension"], columnFields: ["shift"], measures: [{ field: "value", op: "sum" }] };
  return template;
}

describe("owned cooperative preparation", () => {
  it("captures original descriptors before yielding and never mixes later host mutation", async () => {
    const rows = Array.from({ length: 4000 }, (_, id) => ({ id, date: new Date(1000 + id), exact: 10n, empty: undefined, zero: -0 }));
    const original = { template: structuredClone(plainTemplate), datasets: { rows } };
    const expected = snapshotLayoutPart(original);
    const pending = snapshotLayoutPartAsync(original);
    rows.forEach(row => { row.id += 100; row.date.setTime(999999); });
    original.template.pages[0]!.components = [];
    expect(await pending).toEqual(expected);
    expect((await pending).datasets.rows![0]).not.toBe(rows[0]);
  });

  it("delivers timer cancellation during allocation without falling back to mutable input", async () => {
    const controller = new AbortController(), getter = vi.fn();
    const rows = Array.from({ length: 4000 }, (_, id) => ({ id }));
    setTimeout(() => { Object.defineProperty(rows[3999], "unused", { enumerable: true, get: getter }); controller.abort("new query"); }, 0);
    const pending = snapshotLayoutPartAsync({ template: plainTemplate, datasets: { rows } }, controller.signal);
    await expect(pending).rejects.toMatchObject({ name: "AbortError", cause: "new query" });
    expect(getter).not.toHaveBeenCalled();
    const stopped = new AbortController(); stopped.abort("already stopped");
    await expect(snapshotLayoutPartAsync({ template: plainTemplate, datasets: {} }, stopped.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("keeps snapshot scalar/Date policy, rejects getters and cycles without executing host code", async () => {
    const getter = vi.fn(() => 1), row: Record<string, unknown> = { id: 1 };
    Object.defineProperty(row, "unused", { get: getter, enumerable: true });
    await expect(snapshotLayoutPartAsync({ template: plainTemplate, datasets: { rows: [row] } })).rejects.toMatchObject({ code: "conflict" });
    expect(getter).not.toHaveBeenCalled();
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    await expect(snapshotLayoutPartAsync({ template: plainTemplate, datasets: { rows: [cyclic] } })).rejects.toMatchObject({ code: "conflict" });
    const record = Object.assign(Object.create(null), { id: 3, stamp: new Date(NaN), absent: undefined, big: "x".repeat(100000) });
    const part = { template: plainTemplate, datasets: { rows: [record] } };
    expect(await snapshotLayoutPartAsync(part)).toEqual(snapshotLayoutPart(part));
  });

  it("keeps contract error ordering, limits and cross-slice duplicate keys exactly", async () => {
    const contract: DatasetContract = { rowKey: "id", fields: [{ field: "id", type: "text", required: true }, { field: "n", type: "number", min: 0 }] };
    const rows = Array.from({ length: 9000 }, (_, index) => ({ id: String(index), n: index }));
    rows[8300]!.id = "2"; rows[8400]!.n = -1;
    const options = { path: "$.datasets.rows", maxIssues: 2 };
    const expected = validateDatasetRows(rows, contract, options), beat = vi.fn();
    setTimeout(beat, 0);
    const result = await drainCooperatively(iterateDatasetValidation(rows, contract, options));
    expect(result).toEqual(expected);
    expect(result.issues.map(issue => issue.path)).toEqual(["$.datasets.rows[8300].id", "$.datasets.rows[8400].n"]);
    expect(beat).toHaveBeenCalledOnce();
    expect(await drainCooperatively(iterateDatasetValidation(rows, contract, { maxRows: 10 }))).toEqual(validateDatasetRows(rows, contract, { maxRows: 10 }));
    await expect(drainCooperatively(iterateDatasetValidation([], { fields: [] }))).rejects.toThrow(/fields/);
  });

  it("shares one declarative matrix compute/filter result between budget preflight and layout", async () => {
    const template = matrixTemplate(), rows = [{ plant: "A", shift: "day", value: 2 }, { plant: "B", shift: "night", value: -1 }];
    const expected = paginateTemplate(template, { rows }).plan;
    const computation = vi.spyOn(computed, "iterateComputedDataset"), syncComputation = vi.spyOn(computed, "computeDataset"), predicate = vi.spyOn(predicates, "compileReportPredicate");
    const provider = vi.fn(async () => ({ datasets: { rows } }));
    const result = await createReportRuntime({ reports: { report: { template, provider: { query: provider } } } }).prepare({ reportIds: ["report"] });
    expect(computation.mock.calls.length + syncComputation.mock.calls.length).toBe(1);
    expect(predicate).toHaveBeenCalledOnce();
    expect(provider).toHaveBeenCalledOnce();
    expect(rows).toEqual([{ plant: "A", shift: "day", value: 2 }, { plant: "B", shift: "night", value: -1 }]);
    expect(result.plan.pages.map(page => page.components.map(component => component.grid))).toEqual(expected.pages.map(page => page.components.map(component => component.grid)));
  });

  it("keeps raw observation identity/order and releases the private workspace on success and failure", async () => {
    const template = matrixTemplate(), datasets = { rows: [{ plant: "A", shift: "day", value: 2 }] }, observations: string[] = [];
    let owned: typeof datasets | undefined;
    const options = inspectOwnedSource({ onDatasets: (_id: string, raw: DatasetRows) => { expect(raw).toBe(datasets); observations.push("raw"); } }, (_id, data) => { owned = data as typeof datasets; observations.push("owned"); });
    await createReportSource({ report: { template, datasets } }, options)({ reportIds: ["report"], params: {} });
    expect(observations).toEqual(["raw", "owned"]); expect(owned).not.toBe(datasets);
    const list = template.pages[0]!.components[0]!;
    if (list.kind !== "list") throw new Error("list");
    const run = vi.spyOn(computed, "computeDataset");
    estimateListLayoutCells(list, owned!);
    expect(run).toHaveBeenCalledOnce();
    const failed = inspectOwnedSource({}, (_id, data) => { owned = data as typeof datasets; throw new Error("inspection failed"); });
    await expect(createReportSource({ report: { template, datasets } }, failed)({ reportIds: ["report"], params: {} })).rejects.toThrow("inspection failed");
    run.mockClear(); estimateListLayoutCells(list, owned!); expect(run).toHaveBeenCalledOnce();
  });

  it("rejects raw row budgets before snapshot and recomputes changed Provider data on the next query", async () => {
    const clone = vi.spyOn(preparation, "prepareOwnedLists"), template = matrixTemplate();
    const datasets = { rows: [{ plant: "A", shift: "day", value: 2 }, { plant: "B", shift: "day", value: 3 }] };
    await expect(createReportRuntime({ reports: { report: { template, datasets } }, budget: { maxRows: 1 } }).prepare({ reportIds: ["report"] })).rejects.toMatchObject({ code: "budget", path: "$.budget.maxRows" });
    expect(clone).not.toHaveBeenCalled();
    const runtime = createReportRuntime({ reports: { report: { template, datasets } } });
    const first = await runtime.prepare({ reportIds: ["report"] });
    datasets.rows[0]!.value = 20;
    const second = await runtime.prepare({ reportIds: ["report"] });
    expect(second.plan).not.toEqual(first.plan);
    expect(clone).toHaveBeenCalledTimes(2);
    await expect(createReportRuntime({ reports: { report: { template, datasets } }, budget: { maxCells: 1 } }).prepare({ reportIds: ["report"] })).rejects.toMatchObject({ code: "budget", path: "$.budget.maxCells" });
  });

  it("captures declarative validation metadata before host events can change the contract", async () => {
    const contract: DatasetContract = { fields: [{ field: "id", type: "number" }] };
    const rows = Array.from({ length: 9000 }, (_, id) => ({ id }));
    const template: ReportTemplate = { pages: [{ widthMm: 100, heightMm: 80, components: [] }] };
    const source = createReportSource({ report: { template, datasets: { rows }, dataSchema: { rows: contract } } }, { onDatasets: () => setTimeout(() => { (contract.fields[0] as { type: string }).type = "text"; }, 0) });
    const plan = await source({ reportIds: ["report"], params: {} });
    expect(plan.pages).toHaveLength(1);
    expect(contract.fields[0]!.type).toBe("text");
  });

  it("releases pure preparation on timer cancellation before any plan is published", async () => {
    const template = matrixTemplate(), rows = Array.from({ length: 10000 }, (_, value) => ({ plant: "A", shift: "day", value }));
    const controller = new AbortController(), original = preparation.registerListPreparation;
    let releaseCount = 0;
    vi.spyOn(preparation, "registerListPreparation").mockImplementation(data => {
      const release = original(data);
      setTimeout(() => controller.abort("superseded preparation"), 0);
      return () => { releaseCount++; release(); };
    });
    const inspection = vi.fn();
    const options = inspectOwnedSource({}, inspection);
    await expect(createReportSource({ report: { template, datasets: { rows } } }, options)({ reportIds: ["report"], params: {}, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError", cause: "superseded preparation" });
    expect(releaseCount).toBe(1); expect(inspection).not.toHaveBeenCalled();
  });
  it("keeps exotic fallback contract validation and rendering in one synchronous boundary", async () => {
    const rows = [{ id: 1, unused: () => "readonly" }], warn = vi.fn();
    const source = createReportSource({ report: { template: plainTemplate, datasets: { rows }, dataSchema: { rows: { fields: [{ field: "id", type: "number", max: 1 }] } } } }, {
      onWarning: warn,
      onDatasets: () => queueMicrotask(() => { rows[0]!.id = 999; })
    });
    const plan = await source({ reportIds: ["report"], params: {} });
    const body = plan.pages[0]!.components.find(component => component.table?.role === "body");
    expect(body!.grid!.cells[0]![0]!.value).toBe(1);
    expect(rows[0]!.id).toBe(999); expect(warn).toHaveBeenCalledOnce();
  });
});
