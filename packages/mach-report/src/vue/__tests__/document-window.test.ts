import { describe, expect, it, vi } from "vitest";
import { createDocumentWindowReader } from "../document-window";
import { snapshotDocumentWindow } from "../document-window-validation";
import { createMemoryReportDocumentStore, createReportDocumentSource, writeReportDocument, type ReportDocumentSource, type ReportDocumentWindow } from "../../server";
import { RENDER_PLAN_SCHEMA_VERSION } from "../../schema/render-plan";

import { page, windowAt } from "./document-fixture";
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; }
describe("owned document page windows", () => {
  it("reads a 10,000-page document lazily and bounds LRU ownership", async () => {
    const load = vi.fn(async ({ fromPage }: { fromPage: number }) => windowAt(fromPage));
    const reader = createDocumentWindowReader({ load });
    const first = await reader.load(0); first.page!.components[0]!.text = "mutated";
    expect((await reader.load(0)).page!.components[0]!.text).toBe("Page 1");
    await reader.load(2); expect(load).toHaveBeenCalledTimes(1);
    for (const index of [100, 200, 300, 9999]) await reader.load(index);
    expect(reader.cachedPages).toBeLessThanOrEqual(7); expect(reader.cachedBytes).toBeLessThan(16_000_000);
    expect(load).toHaveBeenCalledTimes(5); expect(load.mock.calls.every(([request]) => !("pages" in request))).toBe(true);
    await reader.load(0); expect(load).toHaveBeenCalledTimes(6); reader.dispose();
    await expect(reader.load(0)).rejects.toMatchObject({ code: "validate" });
  });
  it("deduplicates concurrent reads without one subscriber cancelling another", async () => {
    const wait = deferred<ReportDocumentWindow>(); let signal!: AbortSignal;
    const load = vi.fn((input: { signal?: AbortSignal }) => { signal = input.signal!; return wait.promise; });
    const reader = createDocumentWindowReader({ load }), one = new AbortController();
    const first = reader.load(0, one.signal), second = reader.load(0); await Promise.resolve(); one.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" }); expect(signal.aborted).toBe(false);
    wait.resolve(windowAt(0)); expect((await second).manifest.pageCount).toBe(10_000); expect(load).toHaveBeenCalledOnce();
  });
  it("aborts the adapter after its last subscriber leaves and rejects late data", async () => {
    const wait = deferred<ReportDocumentWindow>(); let signal!: AbortSignal;
    const reader = createDocumentWindowReader({ load: input => { signal = input.signal!; return wait.promise; } });
    const controller = new AbortController(), pending = reader.load(0, controller.signal); await Promise.resolve(); controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" }); expect(signal.aborted).toBe(true);
    wait.resolve(windowAt(0)); await Promise.resolve(); await Promise.resolve(); expect(reader.cachedPages).toBe(0);
  });
  it("pins document identity until explicit refresh and rejects terminal mutation", async () => {
    let version = "v1", count = 10_000;
    const reader = createDocumentWindowReader({ load: async input => windowAt(input.fromPage, count, version) });
    await reader.load(0); version = "v2";
    await expect(reader.load(100)).rejects.toThrow(/版本/); reader.reset(); await reader.load(100);
    count = 9999; await expect(reader.load(200)).rejects.toThrow(/修订/);
  });
  it("validates boundaries, state, page schema and bounded JSON before ownership", () => {
    const mutate = [(v: ReportDocumentWindow) => { v.nextPage++; }, (v: ReportDocumentWindow) => { v.pages = []; }, (v: ReportDocumentWindow) => { v.manifest.revision = -1; }, (v: ReportDocumentWindow) => { v.manifest.scope = ""; }, (v: ReportDocumentWindow) => { v.pages[0]!.pageWidthMm = -1; }, (v: ReportDocumentWindow) => { v.manifest.state = "failed"; }];
    for (const change of mutate) { const value = windowAt(0); change(value); expect(() => snapshotDocumentWindow(value, { fromPage: 0, limit: 3 })).toThrow(); }
    expect(() => snapshotDocumentWindow(windowAt(0), { fromPage: 0, limit: 3, version: "old" })).toThrow(/版本/);
    const enormous = windowAt(0); enormous.pages[0]!.components[0]!.text = "x".repeat(8_000_001);
    expect(() => snapshotDocumentWindow(enormous, { fromPage: 0, limit: 3 })).toThrow(/预算/);
  });
  it("supports zero committed pages and a short final window", async () => {
    const reader = createDocumentWindowReader({ load: async input => windowAt(input.fromPage, 0) });
    expect((await reader.load(0)).page).toBeUndefined(); await expect(reader.load(-1)).rejects.toThrow();
    const tail = createDocumentWindowReader({ load: async input => windowAt(input.fromPage, 10) });
    expect((await tail.load(9)).page!.components[0]!.text).toBe("Page 10"); await expect(tail.load(10)).rejects.toThrow(/范围/);
  });
  it("binds existing backend stores without duplicating document state", async () => {
    const store = createMemoryReportDocumentStore(), identity = { scope: "tenant", id: "document" };
    await writeReportDocument(store, { ...identity, version: "v1", plan: { schemaVersion: RENDER_PLAN_SCHEMA_VERSION }, pages: [page(0), page(1)] });
    const source = createReportDocumentSource(store, identity);
    expect((await source.load({ fromPage: 1, limit: 1 })).pages[0]!.components[0]!.text).toBe("Page 2");
    await expect(source.load({ version: "old", fromPage: 0, limit: 1 })).rejects.toMatchObject({ code: "conflict" });
    const missing = createReportDocumentSource(store, { ...identity, id: "missing" }); await expect(missing.load({ fromPage: 0, limit: 1 })).rejects.toThrow(/不存在/);
    const exportResult = vi.fn(); const complete: ReportDocumentSource = createReportDocumentSource(store, identity, { export: exportResult }); expect(complete.export).toBe(exportResult);
  });
  it.each(["reset", "dispose"] as const)("%s stops subscribers even when the adapter ignores cancellation", async action => {
    const wait = deferred<ReportDocumentWindow>();
    const reader = createDocumentWindowReader({ load: () => wait.promise });
    const result = reader.load(0).then(() => "resolved", error => error.name);
    await Promise.resolve(); reader[action]();
    expect(await Promise.race([result, new Promise(resolve => setTimeout(() => resolve("still waiting"), 10))])).toBe("AbortError");
    wait.resolve(windowAt(0)); await Promise.resolve(); await Promise.resolve(); expect(reader.cachedPages).toBe(0);
  });
  it("rejects shrinking committed boundaries and changed headers or terminal metadata", () => {
    const previous = windowAt(0, 2).manifest; previous.state = "building"; previous.revision = 2;
    expect(() => snapshotDocumentWindow(windowAt(0, 1), { fromPage: 0, limit: 3 }, previous)).toThrow();
    const changed = windowAt(0, 3); changed.manifest.plan.requiresRecalculation = true;
    expect(() => snapshotDocumentWindow(changed, { fromPage: 0, limit: 3 }, previous)).toThrow();
    const terminal = windowAt(0, 3), mutated = windowAt(0, 3); mutated.manifest.bytes++;
    expect(() => snapshotDocumentWindow(mutated, { fromPage: 0, limit: 3 }, terminal.manifest)).toThrow();
  });
  it("does not accept arbitrary indices into a document with no committed pages", async () => {
    const reader = createDocumentWindowReader({ load: async input => windowAt(input.fromPage, 0) });
    await expect(reader.load(1)).rejects.toThrow(/范围/);
  });
  it("captures backend window parameters before resolving the current version", async () => {
    const store = createMemoryReportDocumentStore(), identity = { scope: "tenant", id: "captured" };
    await writeReportDocument(store, { ...identity, version: "v1", plan: { schemaVersion: RENDER_PLAN_SCHEMA_VERSION }, pages: [page(0), page(1)] });
    const request = { fromPage: 0, limit: 1 };
    const pending = createReportDocumentSource(store, identity).load(request); request.fromPage = 1;
    expect((await pending).pages[0]!.components[0]!.text).toBe("Page 1");
  });
  it("pins the first completed version across concurrent initial windows", async () => {
    const first = deferred<ReportDocumentWindow>(), second = deferred<ReportDocumentWindow>();
    const reader = createDocumentWindowReader({ load: input => input.fromPage === 0 ? first.promise : second.promise });
    const a = reader.load(0).catch(error => error), b = reader.load(20);
    second.resolve(windowAt(20, 30, "v2")); expect((await b).manifest.version).toBe("v2");
    first.resolve(windowAt(0, 30, "v1")); expect(await a).toMatchObject({ code: "validate" });
    expect((await reader.load(20)).manifest.version).toBe("v2");
  });
  it("does not let an adapter rewrite the private expected window boundaries", async () => {
    const reader = createDocumentWindowReader({ load: async input => { input.fromPage = 100; input.limit = 100; return windowAt(100); } });
    await expect(reader.load(0)).rejects.toThrow(/边界/);
    expect(reader.cachedPages).toBe(0);
  });
});
