import { effectScope, ref, shallowRef } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { RenderPlan } from "../../index";
import type { PlanFetcher } from "../adapters";
import { MachReportError } from "../errors";
import type { MachReportStateError } from "../controller";
import { usePreviewSession, type PreviewNotice } from "../composables/usePreviewSession";
import { usePreviewDiagnostics } from "../composables/usePreviewDiagnostics";
import { usePreviewTask } from "../composables/usePreviewTask";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const result = (id: string): RenderPlan => ({ schemaVersion: id, pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [] }] });
function harness(fetcher: PlanFetcher) {
  const scope = effectScope(), params = ref({ plant: "A" });
  const feedback = { errorMessage: ref(""), lastError: shallowRef<Readonly<MachReportStateError> | null>(null), notice: shallowRef<PreviewNotice | null>(null), reportError: vi.fn() };
  const loaded = vi.fn(), invalidParams = vi.fn(), task = usePreviewTask(vi.fn());
  const readParams = vi.fn((): { params?: Record<string, string>; error?: MachReportError; quiet: boolean } => ({ params: { ...params.value }, quiet: false }));
  const session = scope.run(() => usePreviewSession({
    source: { ids: () => ["daily"], fetcher: () => fetcher, readParams, invalidParams },
    policy: { guard: () => true, assets: () => undefined, importOptions: () => false, importingMessage: () => "importing" },
    feedback, task, diagnostics: usePreviewDiagnostics(vi.fn()),
    view: { invalidate: vi.fn(), beforeImport: vi.fn(), accepted: vi.fn() },
    events: { warning: vi.fn(), logWarning: vi.fn(), loaded, imported: vi.fn() }
  }))!;
  return { scope, session, params, feedback, loaded, invalidParams, readParams, task };
}
describe("preview source session boundary", () => {
  it("captures query parameters and only commits the newest request", async () => {
    const first = deferred<RenderPlan>(), second = deferred<RenderPlan>();
    const fetcher = vi.fn<PlanFetcher>().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const h = harness(fetcher);
    const earlier = h.session.reload(); h.params.value.plant = "B"; const latest = h.session.reload();
    expect(fetcher.mock.calls[0]![0].signal?.aborted).toBe(true);
    second.resolve(result("B")); await latest;
    first.resolve(result("A")); await earlier;
    expect(h.session.plan.value?.schemaVersion).toBe("B");
    expect(h.session.loadedContext.value?.params).toEqual({ plant: "B" });
    h.params.value.plant = "C"; expect(h.session.loadedContext.value?.params.plant).toBe("B");
    expect(h.loaded).toHaveBeenCalledTimes(1); h.scope.stop();
  });
  it("invalid parameters finish the previous loading generation without admitting its late result", async () => {
    const pending = deferred<RenderPlan>(); const h = harness(() => pending.promise);
    const loading = h.session.reload();
    h.readParams.mockReturnValue({ error: new MachReportError("param", "required"), quiet: false });
    await h.session.reload(); pending.resolve(result("stale")); await loading;
    expect(h.session.loading.value).toBe(false); expect(h.session.plan.value).toBeNull();
    expect(h.feedback.errorMessage.value).toBe("required"); expect(h.invalidParams).toHaveBeenCalledOnce();
    h.scope.stop();
  });
  it("cancel and scope disposal fence adapters that ignore AbortSignal", async () => {
    const pending = deferred<RenderPlan>(); const h = harness(() => pending.promise);
    const loading = h.session.reload(); h.task.cancel();
    expect(h.session.loading.value).toBe(false); h.scope.stop(); pending.resolve(result("late")); await loading;
    expect(h.session.plan.value).toBeNull(); expect(h.loaded).not.toHaveBeenCalled();
    await expect(h.session.importExcel(new Uint8Array())).rejects.toMatchObject({ code: "config" });
  });
});
