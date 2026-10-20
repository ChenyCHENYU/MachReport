// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { runReportBatch, snapshotReportBatchCases, type ReportBatchCase } from "../server/batch";
import { createReportRuntime } from "../server/runtime";
import { createReportGenerationService } from "../server/generation";
import { createMemoryReportInstanceStore, createReportInstanceManager, checkInstanceIdentity, reportInstanceSummary, snapshotReportInstance } from "../server/instance-store";
import { createTemplate } from "../builder/template-builder";

const template = createTemplate().page(100, 80).list("rows", { leftMm: 5, topMm: 5, widthMm: 70 }, [{ field: "amount", header: "Amount", widthMm: 70 }]).build();
function fixture() {
  const query = vi.fn(async () => ({ datasets: { rows: [{ amount: 0 }, { amount: null }, { amount: "123456789012345678.123" }] }, revision: "source-2", sourceToken: "opaque-not-archived" }));
  const runtime = createReportRuntime({ reports: { daily: { template: { ...template, params: [{ field: "month", type: "month", defaultValue: "2026-10" }] }, provider: { query } } } });
  const store = createMemoryReportInstanceStore();
  const service = createReportGenerationService({ runtime, instances: store, templateRevisions: { daily: "template-3" }, now: () => new Date("2026-10-20T00:00:00Z") });
  return { query, runtime, store, service };
}
describe("batch execution and immutable report instances", () => {
  it("rejects unsafe IDs and accessor-bearing cases before any execution or initial snapshot allocation", async () => {
    const execute = vi.fn(async () => 0), getter = vi.fn(() => ({ month: "2026-10" }));
    expect(() => checkInstanceIdentity("plant", "unsafe\n")).toThrow(expect.objectContaining({ code: "input" }));
    await expect(runReportBatch([{ id: "unsafe\n", params: {} }], execute)).rejects.toThrow("安全标识");
    const item = { id: "safe" } as ReportBatchCase; Object.defineProperty(item, "params", { get: getter, enumerable: true });
    expect(() => snapshotReportBatchCases([item])).toThrow("访问器");
    const oversized: ReportBatchCase[] = new Array(101); Object.defineProperty(oversized, "0", { get: getter, enumerable: true });
    expect(() => snapshotReportBatchCases(oversized)).toThrow("maxCases");
    expect(snapshotReportBatchCases([])).toEqual([]); await expect(runReportBatch([], execute)).rejects.toThrow("至少");
    expect(getter).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });
  it("rejects sparse or disguised array keys and private top-level fields without leaking them in summaries", async () => {
    const { service } = fixture();
    const first = await service.generate({ scope: "plant", id: "safe", title: "Safe", reportIds: ["daily"], expectedRevision: null });
    for (const key of ["extra", "0\n", "00"]) {
      const sparse: unknown[] = new Array(1); Object.defineProperty(sparse, key, { value: "secret", enumerable: true });
      const candidate = structuredClone(first); candidate.plan.pages[0]!.components[0]!.meta = { disguised: sparse };
      expect(() => snapshotReportInstance(candidate)).toThrow(expect.objectContaining({ code: "input" }));
    }
    const secret = { ...first, extraPrivateToken: "must-not-leak" };
    expect(() => snapshotReportInstance(secret)).toThrow("未知字段");
    expect(reportInstanceSummary(secret)).not.toHaveProperty("extraPrivateToken");
    expect(reportInstanceSummary(first)).not.toHaveProperty("plan");
    expect(() => snapshotReportInstance({ ...first, artifacts: [{ key: "private/report.pdf", format: "pdf", bytes: 1, sha256: `${"a".repeat(64)}\n` }] })).toThrow(expect.objectContaining({ code: "input" }));
    for (const budget of [NaN, Infinity, 0, -1, 0.5]) expect(() => snapshotReportInstance(first, budget)).toThrow();
  });
  it("rejects public save and generate getters before invoking them or dispatching any extra business query", async () => {
    const { service, query } = fixture();
    const generated = await service.generate({ scope: "plant", id: "first", title: "First", reportIds: ["daily"], expectedRevision: null });
    const { revision: _revision, ...input } = generated;
    const getter = vi.fn(() => "getter title");
    const malicious = { ...input, id: "getter" }; Object.defineProperty(malicious, "title", { get: getter, enumerable: true });
    const store = createMemoryReportInstanceStore(), manager = createReportInstanceManager(store);
    await expect(manager.save(malicious, { expectedRevision: null })).rejects.toMatchObject({ code: "input" });
    const request = { scope: "plant", id: "getter", title: "Safe", reportIds: ["daily"], expectedRevision: null };
    Object.defineProperty(request, "title", { get: getter, enumerable: true });
    await expect(service.generate(request)).rejects.toMatchObject({ code: "input" });
    expect(getter).not.toHaveBeenCalled(); expect(query).toHaveBeenCalledTimes(1); expect((await store.list("plant")).items).toEqual([]);
  });
  it("honors pre-abort without saving a revision or launching business generation", async () => {
    const { service, query } = fixture(); const controller = new AbortController(); controller.abort();
    await expect(service.generate({ scope: "plant", id: "cancelled", title: "Cancelled", reportIds: ["daily"], expectedRevision: null, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(query).not.toHaveBeenCalled(); expect((await service.list("plant")).items).toEqual([]);
    const execute = vi.fn(async () => "saved");
    const outcomes = await runReportBatch([{ id: "a", params: {} }], execute, { signal: controller.signal });
    expect(outcomes).toEqual([{ id: "a", index: 0, status: "cancelled" }]); expect(execute).not.toHaveBeenCalled();
  });
  it("uses the explicitly raised manager and generation snapshot budget above the default eight MB", async () => {
    const { runtime } = fixture(); const prepared = await runtime.prepare({ reportIds: ["daily"] });
    prepared.plan.pages[0]!.components[0]!.text = "x".repeat(8_000_010);
    const largeRuntime = { ...runtime, prepare: vi.fn(async () => prepared) };
    const store = createMemoryReportInstanceStore({ maxSnapshotBytes: 8_100_000, maxBytes: 16_300_000 });
    const defaults = createReportGenerationService({ runtime: largeRuntime, instances: store, templateRevisions: { daily: "r1" } });
    const input = { scope: "plant", id: "large", title: "Large", reportIds: ["daily"], expectedRevision: null };
    await expect(defaults.generate(input)).rejects.toMatchObject({ code: "capacity" }); expect((await store.list("plant")).items).toHaveLength(0);
    const explicit = createReportGenerationService({ runtime: largeRuntime, instances: store, templateRevisions: { daily: "r1" }, maxSnapshotBytes: 8_100_000 });
    const generated = await explicit.generate(input);
    expect(generated.plan.pages[0]!.components[0]!.text?.length).toBe(8_000_010);
    expect((await explicit.read("plant", "large"))?.revision).toBe(1);
    expect(() => createReportInstanceManager(store, { maxSnapshotBytes: Infinity })).toThrow(expect.objectContaining({ code: "input" }));
  });
  it("bounds concurrency, snapshots inputs, isolates failures and retains input order", async () => {
    let active = 0, maximum = 0;
    const input = [1, 2, 3, 4].map(id => ({ id: String(id), params: { value: String(id) } }));
    const progress = vi.fn();
    const task = runReportBatch(input, async item => {
      maximum = Math.max(maximum, ++active);
      await new Promise(resolve => setTimeout(resolve, item.id === "1" ? 5 : 0));
      active--;
      if (item.id === "2") throw new Error("invalid business row");
      return item.params.value;
    }, { concurrency: 2, onProgress: progress });
    input[0]!.params.value = "changed";
    const results = await task;
    expect(maximum).toBe(2);
    expect(results.map(item => item.id)).toEqual(["1", "2", "3", "4"]);
    expect(results[0]).toMatchObject({ status: "completed", value: "1" });
    expect(results[1]).toMatchObject({ status: "failed", error: { message: "invalid business row" } });
    expect(progress).toHaveBeenLastCalledWith({ completed: 4, total: 4, failed: 1, cancelled: 0 });
  });
  it("cancels pending rows, does not misreport an already committed item, and supports failure stop", async () => {
    const cases = ["a", "b", "c"].map(id => ({ id, params: {} })), controller = new AbortController();
    const results = await runReportBatch(cases, async () => { controller.abort(); return "saved"; }, { concurrency: 1, signal: controller.signal, onProgress: () => { throw new Error("observer"); } });
    expect(results.map(item => item.status)).toEqual(["completed", "cancelled", "cancelled"]);
    const stopped = await runReportBatch(cases, async () => { throw new Error("bad"); }, { concurrency: 1, failure: "stop" });
    expect(stopped.map(item => item.status)).toEqual(["failed", "cancelled", "cancelled"]);
    await expect(runReportBatch([{ id: "a", params: {} }, { id: "a", params: {} }], async () => 0)).rejects.toThrow("唯一");
    await expect(runReportBatch(cases, async () => 0, { concurrency: 17 })).rejects.toThrow("1–16");
  });
  it("preview is read-only; generation stores exact params, source/template revisions and zero/null/precision", async () => {
    const { service, runtime, store, query } = fixture();
    await runtime.prepare({ reportIds: ["daily"] });
    expect((await store.list("plant")).items).toEqual([]);
    const generated = await service.generate({ scope: "plant", id: "daily-20", title: "Daily", reportIds: ["daily"], expectedRevision: null });
    expect(generated).toMatchObject({ revision: 1, params: { month: "2026-10" }, templateRevisions: { daily: "template-3" }, sourceRevisions: { daily: "source-2" } });
    const values = generated.plan.pages.flatMap(page => page.components.flatMap(component => component.grid?.cells.flatMap(row => row.map(cell => cell?.value)) ?? []));
    expect(values).toContain(0); expect(values).toContain(null); expect(values).toContain("123456789012345678.123");
    expect(JSON.stringify(generated)).not.toContain("opaque-not-archived");
    generated.title = "tampered";
    expect((await service.read("plant", "daily-20"))?.title).toBe("Daily");
    const calls = query.mock.calls.length;
    await expect(service.generate({ scope: "plant", id: "daily-20", title: "Overwrite", reportIds: ["daily"], expectedRevision: null })).rejects.toMatchObject({ code: "conflict" });
    expect(query).toHaveBeenCalledTimes(calls);
    const updated = await service.generate({ scope: "plant", id: "daily-20", title: "Revision 2", reportIds: ["daily"], expectedRevision: 1 });
    expect(updated.revision).toBe(2);
    expect((await service.read("plant", "daily-20", 1))?.title).toBe("Daily");
    expect((await service.list("other")).items).toHaveLength(0);
  });
  it("CAS prevents lost updates; budgets reject before mutation; archive snapshots are isolated", async () => {
    const { service } = fixture();
    const first = await service.generate({ scope: "plant", id: "a", title: "A", reportIds: ["daily"], expectedRevision: null });
    const store = createMemoryReportInstanceStore({ maxRevisions: 2 }), manager = createReportInstanceManager(store);
    const { revision: _revision, ...input } = first;
    await manager.save(input, { expectedRevision: null });
    const results = await Promise.allSettled([manager.save({ ...input, title: "B" }, { expectedRevision: 1 }), manager.save({ ...input, title: "C" }, { expectedRevision: 1 })]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    await expect(manager.save(input, { expectedRevision: 2 })).rejects.toMatchObject({ code: "capacity" });
    expect((await manager.read("plant", "a"))?.revision).toBe(2);
    const small = createReportInstanceManager(createMemoryReportInstanceStore({ maxSnapshotBytes: 10 }));
    await expect(small.save(input, { expectedRevision: null })).rejects.toMatchObject({ code: "capacity" });
    expect((await small.list("plant")).items).toHaveLength(0);
  });
  it("batch generation uses one isolated instance per parameter case and never auto-overwrites", async () => {
    const { service } = fixture();
    const cases = ["2026-09", "2026-10"].map((month, index) => ({ id: `run-${index}`, params: { month } }));
    const generate = async (item: ReportBatchCase, { signal }: { signal: AbortSignal }) => {
      const instance = await service.generate({ scope: "plant", id: item.id, title: item.params.month!, reportIds: ["daily"], params: item.params, expectedRevision: null, signal });
      return { instanceId: instance.id, revision: instance.revision };
    };
    expect((await runReportBatch(cases, generate)).every(item => item.status === "completed")).toBe(true);
    expect((await runReportBatch(cases, generate)).every(item => item.status === "failed")).toBe(true);
    const page = await service.list("plant", { limit: 1 });
    expect(page.items).toHaveLength(1); expect(page.next).toBe("run-0");
    expect((await service.list("plant", { after: page.next, limit: 1 })).items[0]?.params.month).toBe("2026-10");
  });
});
