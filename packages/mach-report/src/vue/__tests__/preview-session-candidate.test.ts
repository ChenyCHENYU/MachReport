// @vitest-environment node
import { effectScope, ref, shallowRef } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderPlan, ReportFetchInput, ReportQueryResult } from "../../index";
import type { PlanFetcher } from "../adapters";
import type { MachReportStateError } from "../controller";
import type { ReportRefreshOptions } from "../tools";
import { usePreviewSession, type PreviewNotice } from "../composables/usePreviewSession";
import { usePreviewDiagnostics } from "../composables/usePreviewDiagnostics";
import { usePreviewTask } from "../composables/usePreviewTask";

const imports = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../preview-plan", async original => ({ ...await original<typeof import("../preview-plan")>(), importPreviewPlan: imports.run }));

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (cause: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const plan = (name: string): RenderPlan => ({ schemaVersion: name, pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [] }] });
const cleanup: Array<() => void> = [];
beforeEach(() => { imports.run.mockReset(); });
afterEach(() => { cleanup.splice(0).forEach(close => close()); });
function harness(initial: PlanFetcher, ids = ["daily"]) {
  const scope = effectScope(), fetcher = shallowRef<PlanFetcher | null>(initial);
  const params = ref({ plant: "A", report_date: "2026-11-07" }), reportIds = ref(ids);
  const refresh = ref<ReportRefreshOptions>({ retainPrevious: true, key: "layout-1" });
  const feedback = {
    errorMessage: ref(""), lastError: shallowRef<Readonly<MachReportStateError> | null>(null), notice: shallowRef<PreviewNotice | null>(null), reportError: vi.fn(),
  };
  const events = { warning: vi.fn(), logWarning: vi.fn(), loaded: vi.fn(), imported: vi.fn() };
  const view = { invalidate: vi.fn(), beforeImport: vi.fn(), accepted: vi.fn() };
  const readParams = vi.fn(() => ({ params: { ...params.value }, quiet: false }));
  const guard = vi.fn((): boolean | Promise<boolean> => true);
  const task = usePreviewTask(vi.fn()), notify = vi.fn();
  const diagnostics = scope.run(() => usePreviewDiagnostics(notify))!;
  const session = scope.run(() => usePreviewSession({
    source: { ids: () => reportIds.value, fetcher: () => fetcher.value, readParams, invalidParams: vi.fn() },
    policy: { guard, assets: () => undefined, importOptions: () => true, importingMessage: () => "导入中", refresh: () => refresh.value },
    feedback, view, events, task, diagnostics,
  }))!;
  cleanup.push(() => scope.stop());
  return { scope, fetcher, params, reportIds, refresh, feedback, events, view, readParams, guard, task, diagnostics, notify, session };
}
function queryResult(input: ReportFetchInput, revision: string, index = 0) {
  input.onQueryResult?.(input.reportIds[index]!, { datasets: {}, revision, sourceToken: `token-${revision}`, diagnostics: [{ code: "source", severity: "info", message: `revision ${revision}` }] }, index);
}

describe("accepted query context and explicit latest candidates", () => {
  it("freezes ordered occurrence identity, source revisions and tokens independently from the form", async () => {
    const fetch = vi.fn<PlanFetcher>(async input => {
      queryResult(input, "second", 1); queryResult(input, "first", 0);
      input.onQueryResult?.("daily", { datasets: {}, revision: "ambiguous" });
      return plan("original");
    });
    const app = harness(fetch, ["daily", "daily"]); await app.session.reload();
    const context = app.session.loadedContext.value!;
    expect(context).toMatchObject({ reportIds: ["daily", "daily"], params: { plant: "A" }, sources: [
      { reportId: "daily", reportIndex: 0, reportScope: '[0,"daily"]', revision: "first", sourceToken: "token-first" },
      { reportId: "daily", reportIndex: 1, reportScope: '[1,"daily"]', revision: "second", sourceToken: "token-second" },
    ] });
    expect(context.queryId).toBe(fetch.mock.calls[0]![0].taskId);
    for (const value of [context, context.reportIds, context.params, context.sources, ...context.sources]) expect(Object.isFrozen(value)).toBe(true);
    app.params.value.plant = "PENDING"; app.reportIds.value = ["another-report"];
    expect(context.params.plant).toBe("A"); expect(context.reportIds).toEqual(["daily", "daily"]); expect(context.sources[0]!.revision).toBe("first");
  });

  it("queries the last successful parameters and leaves plan, diagnostics and errors intact until acceptance", async () => {
    let revision = 0;
    const fetch = vi.fn<PlanFetcher>(async input => { queryResult(input, String(++revision)); return plan(`query-${revision}`); });
    const app = harness(fetch); await app.session.reload();
    const originalPlan = app.session.plan.value, originalContext = app.session.loadedContext.value;
    const originalDiagnostics = app.diagnostics.entries.value;
    app.feedback.errorMessage.value = "旧提示"; app.feedback.notice.value = { kind: "warning", message: "旧输出提示" };
    app.params.value.plant = "UNSUBMITTED";
    const candidate = await app.session.prepareLatest(new AbortController().signal);
    expect(fetch.mock.calls[1]![0].params.plant).toBe("A"); expect(app.readParams).toHaveBeenCalledOnce();
    expect(app.session.plan.value).toBe(originalPlan); expect(app.session.loadedContext.value).toBe(originalContext);
    expect(app.diagnostics.entries.value).toBe(originalDiagnostics); expect(app.feedback.errorMessage.value).toBe("旧提示");
    expect(app.events.loaded).toHaveBeenCalledOnce();
    expect(candidate.context.sources[0]).toMatchObject({ revision: "2", sourceToken: "token-2" });
    expect(candidate.context.queryId).toContain(`${originalContext!.queryId}:conflict:`);
    let pendingRestored = false;
    app.events.loaded.mockImplementation(() => {
      expect(pendingRestored).toBe(true); expect(app.session.plan.value).toBe(candidate.plan);
      expect(app.session.loadedContext.value).toBe(candidate.context); expect(app.diagnostics.entries.value.some(entry => entry.message === "revision 2")).toBe(true);
    });
    const before = vi.fn(() => { expect(app.session.plan.value).toBe(candidate.plan); pendingRestored = true; });
    expect(candidate.accept(before)).toBe(true); expect(candidate.accept(before)).toBe(false);
    expect(before).toHaveBeenCalledOnce(); expect(app.events.loaded).toHaveBeenCalledTimes(2);
    expect(app.feedback.errorMessage.value).toBe(""); expect(app.feedback.notice.value).toBeNull();
    expect(app.params.value.plant).toBe("UNSUBMITTED"); expect(app.view.accepted).toHaveBeenLastCalledWith("query", true);
  });

  it("keeps an unadopted candidate and its diagnostics out of the successful session", async () => {
    let count = 0;
    const app = harness(async input => { queryResult(input, String(++count)); return plan(String(count)); });
    await app.session.reload(); const original = app.session.plan.value;
    await app.session.prepareLatest(new AbortController().signal);
    expect(app.session.plan.value).toBe(original); expect(app.events.loaded).toHaveBeenCalledOnce();
    expect(app.diagnostics.entries.value.map(entry => entry.message)).toContain("revision 1");
    expect(app.diagnostics.entries.value.map(entry => entry.message)).not.toContain("revision 2");
  });

  it("preserves the displayed session on a candidate query error or malformed source metadata", async () => {
    const fetch = vi.fn<PlanFetcher>().mockResolvedValueOnce(plan("original")).mockRejectedValueOnce(new Error("provider unavailable"))
      .mockImplementationOnce(async input => { input.onQueryResult?.("daily", { datasets: {}, revision: 1 } as unknown as ReportQueryResult, 0); return plan("invalid"); });
    const app = harness(fetch); await app.session.reload(); const original = app.session.plan.value;
    await expect(app.session.prepareLatest(new AbortController().signal)).rejects.toThrow("provider unavailable");
    await expect(app.session.prepareLatest(new AbortController().signal)).rejects.toMatchObject({ code: "validate" });
    expect(app.session.plan.value).toBe(original); expect(app.events.loaded).toHaveBeenCalledOnce(); expect(app.feedback.reportError).not.toHaveBeenCalled();
  });

  it("stops waiting for an adapter that ignores abort and rejects its late diagnostics and plan", async () => {
    const pending = deferred<RenderPlan>();
    const fetch = vi.fn<PlanFetcher>().mockResolvedValueOnce(plan("original")).mockImplementationOnce(input => pending.promise.then(value => { queryResult(input, "late"); return value; }));
    const app = harness(fetch); await app.session.reload(); const original = app.session.plan.value;
    const controller = new AbortController(), query = app.session.prepareLatest(controller.signal);
    const rejected = expect(query).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); await rejected;
    expect(fetch.mock.calls[1]![0].signal?.aborted).toBe(true);
    pending.resolve(plan("late")); await Promise.resolve(); await Promise.resolve();
    expect(app.session.plan.value).toBe(original); expect(app.events.loaded).toHaveBeenCalledOnce(); expect(app.diagnostics.entries.value.some(entry => entry.message.includes("late"))).toBe(false);
  });

  it("makes only the latest concurrent preparation adoptable", async () => {
    const pending = deferred<RenderPlan>();
    const fetch = vi.fn<PlanFetcher>().mockResolvedValueOnce(plan("original")).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(plan("latest"));
    const app = harness(fetch); await app.session.reload();
    const first = app.session.prepareLatest(new AbortController().signal), rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
    const candidate = await app.session.prepareLatest(new AbortController().signal); await rejected;
    expect(fetch.mock.calls[1]![0].signal?.aborted).toBe(true); expect(candidate.accept()).toBe(true);
    pending.resolve(plan("older")); await Promise.resolve(); await Promise.resolve();
    expect(app.session.plan.value?.schemaVersion).toBe("latest"); expect(app.events.loaded).toHaveBeenCalledTimes(2);
  });

  it.each(["reload", "retainPrevious", "clear"] as const)("fences a prepared candidate when %s changes its owning generation", async action => {
    const fetch = vi.fn<PlanFetcher>().mockResolvedValueOnce(plan("original")).mockResolvedValueOnce(plan("candidate")).mockResolvedValueOnce(plan("normal-refresh"));
    const app = harness(fetch); await app.session.reload(); const candidate = await app.session.prepareLatest(new AbortController().signal);
    if (action === "reload") { app.params.value.plant = "B"; await app.session.reload(); }
    else app.session[action]();
    expect(candidate.accept()).toBe(false);
    expect(app.session.plan.value?.schemaVersion).toBe(action === "reload" ? "normal-refresh" : action === "clear" ? undefined : "original");
  });

  it("rejects old candidates after an Excel import establishes a local source", async () => {
    const fetch = vi.fn<PlanFetcher>().mockResolvedValueOnce(plan("original")).mockResolvedValueOnce(plan("candidate"));
    const app = harness(fetch); await app.session.reload(); const candidate = await app.session.prepareLatest(new AbortController().signal);
    const imported = plan("imported");
    imports.run.mockResolvedValue({ plan: imported, result: { template: { pages: [{ widthMm: 100, heightMm: 100, components: [] }] }, warnings: [], sheets: [] } });
    await app.session.importExcel(new Uint8Array([1]));
    expect(candidate.accept()).toBe(false); expect(app.session.plan.value).toBe(imported); expect(app.session.loadedContext.value).toBeNull();
    await expect(app.session.prepareLatest(new AbortController().signal)).rejects.toMatchObject({ code: "edit" });
  });

  it("fences fetched and prepared candidates when the source fetcher is replaced", async () => {
    const pending = deferred<RenderPlan>();
    const fetch = vi.fn<PlanFetcher>().mockResolvedValueOnce(plan("original")).mockResolvedValueOnce(plan("prepared")).mockReturnValueOnce(pending.promise);
    const app = harness(fetch); await app.session.reload(); const prepared = await app.session.prepareLatest(new AbortController().signal);
    app.fetcher.value = async () => plan("other-source"); expect(prepared.accept()).toBe(false);
    app.fetcher.value = fetch;
    const query = app.session.prepareLatest(new AbortController().signal), rejected = expect(query).rejects.toMatchObject({ name: "AbortError" });
    app.fetcher.value = async () => plan("other-source"); pending.resolve(plan("late")); await rejected;
    expect(app.session.plan.value?.schemaVersion).toBe("original"); expect(app.events.loaded).toHaveBeenCalledOnce();
  });
  it("refuses to start preparation with a fetcher that no longer owns the displayed source", async () => {
    const fetch = vi.fn<PlanFetcher>().mockResolvedValue(plan("original")), replacement = vi.fn<PlanFetcher>().mockResolvedValue(plan("replacement"));
    const app = harness(fetch); await app.session.reload(); app.fetcher.value = replacement;
    await expect(app.session.prepareLatest(new AbortController().signal)).rejects.toBeInstanceOf(Error);
    expect(fetch).toHaveBeenCalledOnce(); expect(replacement).not.toHaveBeenCalled(); expect(app.session.plan.value?.schemaVersion).toBe("original");
  });
  it.each(["reload", "import", "dispose"] as const)("cancels an in-flight preparation before %s can own another result", async action => {
    const pending = deferred<RenderPlan>();
    const fetch = vi.fn<PlanFetcher>().mockResolvedValueOnce(plan("original")).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(plan("normal"));
    const app = harness(fetch); await app.session.reload();
    const query = app.session.prepareLatest(new AbortController().signal), rejected = expect(query).rejects.toMatchObject({ name: "AbortError" });
    if (action === "reload") await app.session.reload();
    if (action === "import") {
      imports.run.mockResolvedValue({ plan: plan("imported"), result: { template: { pages: [{ widthMm: 100, heightMm: 100, components: [] }] }, warnings: [], sheets: [] } });
      await app.session.importExcel(new Uint8Array([1]));
    }
    if (action === "dispose") app.scope.stop();
    await rejected; expect(fetch.mock.calls[1]![0].signal?.aborted).toBe(true);
    pending.resolve(plan("late")); await Promise.resolve(); await Promise.resolve();
    expect(app.session.plan.value?.schemaVersion).toBe(action === "reload" ? "normal" : action === "import" ? "imported" : "original");
  });

  it("cancels preparation on scope disposal even if its adapter never cooperates", async () => {
    const pending = deferred<RenderPlan>();
    const fetch = vi.fn<PlanFetcher>().mockResolvedValueOnce(plan("original")).mockReturnValueOnce(pending.promise);
    const app = harness(fetch); await app.session.reload();
    const query = app.session.prepareLatest(new AbortController().signal), rejected = expect(query).rejects.toMatchObject({ name: "AbortError" });
    app.scope.stop(); await rejected; pending.resolve(plan("late")); await Promise.resolve();
    expect(fetch.mock.calls[1]![0].signal?.aborted).toBe(true); expect(app.events.loaded).toHaveBeenCalledOnce();
  });

  it("does not emit loaded after a beforeEvents callback invalidates the candidate session", async () => {
    const fetch = vi.fn<PlanFetcher>().mockResolvedValueOnce(plan("original")).mockResolvedValueOnce(plan("candidate"));
    const app = harness(fetch); await app.session.reload(); const candidate = await app.session.prepareLatest(new AbortController().signal);
    expect(candidate.accept(() => app.session.clear())).toBe(false); expect(app.session.plan.value).toBeNull(); expect(app.events.loaded).toHaveBeenCalledOnce();
  });
  it.each(["dispose", "retainPrevious"] as const)("does not publish loaded after beforeEvents triggers %s without changing plan identity", async action => {
    const fetch = vi.fn<PlanFetcher>().mockResolvedValueOnce(plan("original")).mockResolvedValueOnce(plan("candidate"));
    const app = harness(fetch); await app.session.reload(); const candidate = await app.session.prepareLatest(new AbortController().signal);
    expect(candidate.accept(() => { if (action === "dispose") app.scope.stop(); else app.session.retainPrevious(); })).toBe(false);
    expect(app.events.loaded).toHaveBeenCalledOnce(); expect(app.view.accepted).toHaveBeenCalledOnce();
  });
  it("rechecks ownership after view invalidation before replacing the old successful plan", async () => {
    const fetch = vi.fn<PlanFetcher>().mockResolvedValueOnce(plan("original")).mockResolvedValueOnce(plan("candidate"));
    const app = harness(fetch); await app.session.reload();
    const original = app.session.plan.value, context = app.session.loadedContext.value;
    const candidate = await app.session.prepareLatest(new AbortController().signal), beforeEvents = vi.fn();
    app.view.invalidate.mockImplementation(() => app.session.retainPrevious());
    expect(candidate.accept(beforeEvents)).toBe(false);
    expect(beforeEvents).not.toHaveBeenCalled(); expect(app.session.plan.value).toBe(original); expect(app.session.loadedContext.value).toBe(context);
    expect(app.events.loaded).toHaveBeenCalledOnce();
  });
  it("rolls back the session and diagnostic snapshot if restoring pending edits throws", async () => {
    let count = 0;
    const app = harness(async input => { queryResult(input, String(++count)); return plan(String(count)); });
    await app.session.reload();
    const original = app.session.plan.value, context = app.session.loadedContext.value, diagnostics = app.diagnostics.entries.value;
    const candidate = await app.session.prepareLatest(new AbortController().signal);
    const failure = new Error("pending edits could not be restored");
    expect(() => candidate.accept(() => { app.diagnostics.reset(); throw failure; })).toThrow(failure);
    expect(app.session.plan.value).toBe(original); expect(app.session.loadedContext.value).toBe(context);
    expect(app.diagnostics.entries.value).toEqual(diagnostics); expect(app.events.loaded).toHaveBeenCalledOnce();
    expect(app.view.accepted).toHaveBeenCalledOnce();
  });

  it("does not call the provider when preparation is already cancelled", async () => {
    const fetch = vi.fn<PlanFetcher>().mockResolvedValue(plan("original"));
    const app = harness(fetch); await app.session.reload();
    const controller = new AbortController(); controller.abort();
    await expect(app.session.prepareLatest(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
