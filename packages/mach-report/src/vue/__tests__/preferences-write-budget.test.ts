// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { computed, effectScope, nextTick, shallowRef, type EffectScope } from "vue";
import { usePreviewTools } from "../composables/usePreviewTools";
import { REPORT_PREVIEW_TOOLS, type ReportPreferencesOptions, type ReportStoredPreferences } from "../tools";
const scopes: EffectScope[] = [];
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); vi.restoreAllMocks(); });
function deferred() { let resolve!: () => void, reject!: (error: unknown) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function settle() { for (let index = 0; index < 20; index++) await Promise.resolve(); }
function setup(option: ReportPreferencesOptions, onError = vi.fn()) {
  const scope = effectScope(); scopes.push(scope);
  const persistence = shallowRef<ReportPreferencesOptions | undefined>(option);
  const tools = scope.run(() => usePreviewTools(computed(() => Object.fromEntries(REPORT_PREVIEW_TOOLS.map(key => [key, true])) as Record<typeof REPORT_PREVIEW_TOOLS[number], boolean>), computed(() => ({})), computed(() => persistence.value), onError))!;
  return { scope, tools, persistence, onError };
}

describe("coalesced preference writes", () => {
  it("keeps one in flight and the final snapshot for 200 zoom changes, including disposal", async () => {
    const pending = deferred(), snapshots: ReportStoredPreferences[] = [];
    const save = vi.fn((_key: string, value: Readonly<ReportStoredPreferences>) => { snapshots.push({ ...value }); return snapshots.length === 1 ? pending.promise : undefined; });
    const { tools, scope } = setup({ key: "A", adapter: { load: () => null, save } });
    await nextTick();
    for (let zoom = 100; zoom < 300; zoom++) tools.setZoomMode(false, zoom);
    await settle(); expect(save).toHaveBeenCalledTimes(1);
    scope.stop(); pending.resolve(); await settle();
    expect(save).toHaveBeenCalledTimes(2); expect(snapshots.at(-1)).toEqual({ zoomMode: 299 });
  });

  it("preserves A/B/A ordering and isolates old-scope failures without dropping the latest values", async () => {
    const pending = deferred(), error = vi.fn(), writes: Array<[string, ReportStoredPreferences]> = [];
    const adapter = { load: () => null, save: vi.fn((key: string, value: Readonly<ReportStoredPreferences>) => { writes.push([key, { ...value }]); return writes.length === 1 ? pending.promise : undefined; }) };
    const { tools, persistence } = setup({ key: "A", adapter }, error);
    await nextTick(); tools.setZoomMode(false, 100); tools.setZoomMode(false, 110); await settle();
    persistence.value = { key: "B", adapter }; await nextTick(); tools.setZoomMode(false, 200);
    persistence.value = { key: "A", adapter }; await nextTick(); tools.setZoomMode(false, 150);
    pending.reject(new Error("obsolete A failure")); await settle();
    expect(writes).toEqual([["A", { zoomMode: 100 }], ["B", { zoomMode: 200 }], ["A", { zoomMode: 150 }]]);
    expect(error).not.toHaveBeenCalled(); expect(tools.getZoomMode(false)).toBe(150);
  });

  it("does not poison later writes when the error observer throws", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const onError = vi.fn(() => { throw new Error("observer error"); });
    const { tools } = setup({ key: "A", adapter: { load: () => null, save } }, onError);
    await nextTick(); tools.setZoomMode(false, 100); await settle(); tools.setZoomMode(false, 150); await settle();
    expect(onError).toHaveBeenCalledOnce(); expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith("A", { zoomMode: 150 });
  });

  it("bounds pending scopes, flushes their final snapshots and detaches late errors on dispose", async () => {
    const pending = deferred(), writes: string[] = [], onError = vi.fn();
    const adapter = { load: () => null, save: vi.fn((key: string) => { writes.push(key); return writes.length === 1 ? pending.promise : undefined; }) };
    const { tools, persistence, scope } = setup({ key: "initial", adapter }, onError);
    tools.setZoomMode(false, 100);
    for (let index = 0; index < 100; index++) {
      persistence.value = { key: `scope-${index}`, adapter };
      tools.setZoomMode(false, 100 + index);
    }
    expect(writes).toEqual(["initial"]); scope.stop(); pending.reject(new Error("after disposal"));
    for (let index = 0; index < 100; index++) await Promise.resolve();
    expect(writes).toEqual(["initial", ...Array.from({ length: 32 }, (_, index) => `scope-${index + 68}`)]);
    expect(onError).not.toHaveBeenCalled();
    tools.setZoomMode(false, 299); await settle(); expect(writes).toHaveLength(33);
  });

  it("keeps adapters isolated for the same key and reports current load/write errors safely", async () => {
    const pending = deferred(), first = vi.fn(() => pending.promise), second = vi.fn();
    const onError = vi.fn(() => { throw new Error("observer failure"); });
    const { tools, persistence } = setup({ key: "same", adapter: { load: () => null, save: first } }, onError);
    tools.setZoomMode(false, 100); tools.setZoomMode(false, 110);
    persistence.value = { key: "same", adapter: { load: () => { throw new Error("current load failed"); }, save: second } };
    tools.setZoomMode(false, 150); pending.resolve(); await settle();
    expect(first).toHaveBeenCalledTimes(2); expect(second).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledWith("same", { zoomMode: 150 }); expect(onError).toHaveBeenCalledOnce();
  });
});
