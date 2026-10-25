import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, shallowRef } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { useReportPrefill, type ReportPrefillState } from "../composables/useReportPrefill";
import { useEditHistory } from "../composables/useEditHistory";
import type { ReportEditingOptions } from "../editing";
import type { ReportPrefillReviewOptions } from "../data-review";
import type { RenderPlan } from "../../schema/render-plan";
function plan(): RenderPlan { return { schemaVersion: "test", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [{ kind: "rect", leftMm: 0, topMm: 0, widthMm: 50, heightMm: 10, grid: { colWidthsMm: [50], cells: [[{ value: null, valueType: "number", text: "", source: { datasetId: "detail", rowKey: "a", field: "qty" } }]] } }] }] }; }
const wrappers: VueWrapper[] = [];
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function harness(apply?: () => Promise<boolean>, editing?: ReportEditingOptions) {
  const current = shallowRef<RenderPlan | null>(plan()), options = shallowRef<ReportPrefillReviewOptions | false>({ datasetId: "detail", fields: [{ field: "qty" }], load: () => [{ rowKey: "a", values: { qty: 2 } }] });
  const onError = vi.fn(); let state!: ReportPrefillState, history!: ReturnType<typeof useEditHistory>;
  const wrapper = mount(defineComponent({ setup() {
    history = useEditHistory({ plan: current, options: shallowRef(editing ?? true), blocked: () => false, onChange() {}, onError });
    state = useReportPrefill({ plan: current, options, blocked: () => false, apply: apply ?? history.apply, onError });
    return () => h("div");
  } })); wrappers.push(wrapper);
  return { state, current, options, history, onError, wrapper };
}
describe("prefill apply UI ownership", () => {
  it("returns successful local publication even though the plan watcher clears the old review", async () => {
    const f = harness(); await f.state.run();
    expect(await f.state.apply()).toBe(true);
    expect(f.current.value!.pages[0]!.components[0]!.grid!.cells[0]![0]!.value).toBe(2);
    expect(f.state.applying.value).toBe(false); expect(f.state.result.value).toBeNull(); expect(f.state.error.value).toBeNull();
  });
  it("resets applying synchronously on reload and ignores a late rejection without clearing a new review", async () => {
    const old = deferred<boolean>(), f = harness(() => old.promise);
    await f.state.run(); const task = f.state.apply(); expect(f.state.applying.value).toBe(true);
    f.current.value = plan(); expect(f.state.applying.value).toBe(false);
    await f.state.run(); const fresh = f.state.result.value;
    old.reject(new Error("old save failed")); expect(await task).toBe(false);
    expect(f.state.result.value).toBe(fresh); expect(f.state.error.value).toBeNull(); expect(f.onError).not.toHaveBeenCalled();
  });
  it("keeps a newer pending application busy when the previous operation finally returns", async () => {
    const first = deferred<boolean>(), second = deferred<boolean>(); const apply = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const f = harness(apply); await f.state.run(); const oldTask = f.state.apply();
    f.state.cancel(); expect(f.state.applying.value).toBe(false);
    await f.state.run(); const newTask = f.state.apply(); expect(f.state.applying.value).toBe(true);
    first.resolve(false); expect(await oldTask).toBe(false); expect(f.state.applying.value).toBe(true); expect(f.state.error.value).toBeNull();
    second.resolve(true); expect(await newTask).toBe(true); expect(f.state.applying.value).toBe(false);
  });
  it("resets after options replacement, clear and disposal without late callback errors", async () => {
    for (const action of ["options", "clear", "unmount"] as const) {
      const pending = deferred<boolean>(), f = harness(() => pending.promise);
      await f.state.run(); const task = f.state.apply();
      if (action === "options") f.options.value = false;
      else if (action === "clear") f.state.clear();
      else f.wrapper.unmount();
      expect(f.state.applying.value).toBe(false);
      pending.reject(new Error("old error")); expect(await task).toBe(false);
      expect(f.state.error.value).toBeNull(); expect(f.onError).not.toHaveBeenCalled();
    }
  });
  it("preserves the original history cancellation fence against a late server success", async () => {
    const save = deferred<void>(), f = harness(undefined, { saveBatch: () => save.promise });
    await f.state.run(); const task = f.state.apply(); expect(f.state.applying.value).toBe(true);
    f.history.reset(); f.current.value = plan(); const fresh = f.current.value;
    expect(f.state.applying.value).toBe(false);
    save.resolve(); expect(await task).toBe(false);
    expect(f.current.value).toBe(fresh); expect(f.current.value!.pages[0]!.components[0]!.grid!.cells[0]![0]!.value).toBeNull();
    expect(f.state.error.value).toBeNull();
  });
});
