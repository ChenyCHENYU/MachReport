// @vitest-environment happy-dom
/* eslint-disable vue/one-component-per-file -- Test-only inline component harnesses */
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, shallowRef, type Ref } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import type { RenderPlan } from "../../schema/render-plan";
import type { ReportCellValue } from "../../editing/context";
import ReportPrefillPanel from "../ReportPrefillPanel.vue";
import ReportDataComparison from "../ReportDataComparison.vue";
import { useReportPrefill, type ReportPrefillState } from "../composables/useReportPrefill";
import { useReportDataComparison, type ReportDataComparisonState } from "../composables/useReportDataComparison";
import { useEditHistory } from "../composables/useEditHistory";
import type { ReportEditingOptions } from "../editing";
import type { ReportDataComparisonReviewOptions, ReportDataReviewMessages, ReportPrefillReviewOptions } from "../data-review";
const messages: ReportDataReviewMessages = { prefillTitle: "Prefill", prefillHint: "Review then apply", prefillCurrent: "Current value", prefillReference: "Reference / proposed", prefillLoad: "Read", prefillApply: "Apply", prefillMatched: "Same", prefillChanged: "Changes", prefillSkipped: "Skipped", prefillConflict: "Conflict", prefillUnchanged: "Unchanged", prefillReadonly: "Read only", prefillOccupied: "Occupied", prefillMissingSource: "No source", prefillMissingTarget: "No target", prefillAmbiguous: "Ambiguous", prefillInvalid: "Invalid", comparisonTitle: "Compare", comparisonHint: "Stable business keys", comparisonLoad: "Compare data", comparisonAdded: "Added", comparisonRemoved: "Removed", comparisonChanged: "Changed", comparisonUnchanged: "Unchanged", reviewCancel: "Cancel", reviewClose: "Close", reviewBefore: "Before", reviewAfter: "After", reviewField: "Field", reviewKey: "Key", reviewDelta: "Difference", reviewRatio: "Change ratio", reviewLocate: "Locate", reviewEmpty: "No results", reviewPrevious: "Previous", reviewNext: "Next", reviewPage: "Pages" };
const wrappers = new Set<VueWrapper>();
afterEach(() => { for (const wrapper of wrappers) wrapper.unmount(); wrappers.clear(); vi.useRealTimers(); });
function plan(value: ReportCellValue = null): RenderPlan { return { schemaVersion: "test", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [{ kind: "rect", leftMm: 0, topMm: 0, widthMm: 60, heightMm: 10, grid: { colWidthsMm: [30, 30], cells: [[{ value, valueType: "number", text: value === null ? "" : String(value), source: { datasetId: "production", rowKey: "A", field: "qty" } }, { value: "", text: "", source: { datasetId: "production", rowKey: "A", field: "note" } }]] } }] }] }; }
function createPrefill(options: ReportPrefillReviewOptions, editing: boolean | ReportEditingOptions = true) {
  const current: Ref<RenderPlan | null> = shallowRef(plan()), option = shallowRef<ReportPrefillReviewOptions | false>(options), onError = vi.fn();
  let state!: ReportPrefillState;
  const wrapper = mount(defineComponent({ setup() { const history = useEditHistory({ plan: current, options: shallowRef(editing), blocked: () => false, onChange() {}, onError }); state = useReportPrefill({ plan: current, options: option, blocked: () => false, apply: history.apply, onError }); return () => h(ReportPrefillPanel, { state, messages }); } })); wrappers.add(wrapper);
  return { wrapper, state, current, option, onError };
}
function prefillOptions(): ReportPrefillReviewOptions { return { datasetId: "production", fields: [{ field: "qty" }, { field: "note" }], load: () => [{ rowKey: "A", values: { qty: 0, note: "from history" } }] }; }

describe("optional prefill review", () => {
  it("requires explicit loading and review, then reuses atomic editing and local drafts", async () => {
    const load = vi.fn(prefillOptions().load), { wrapper, state, current } = createPrefill({ ...prefillOptions(), load });
    expect(load).not.toHaveBeenCalled();
    await wrapper.get(".mrp-review-heading button").trigger("click"); await flushPromises();
    expect(state.result.value?.counts.changed).toBe(2);
    expect(wrapper.findAll("tbody tr")).toHaveLength(2);
    expect(wrapper.findAll("thead th").map(header => header.text())).toContain("Current value");
    expect(wrapper.findAll("thead th").map(header => header.text())).toContain("Reference / proposed");
    expect(wrapper.text()).toContain("0");
    expect(await state.apply()).toBe(true);
    expect(current.value!.pages[0]!.components[0]!.grid!.cells[0]![0]!.value).toBe(0);
    expect(state.result.value).toBeNull();
  });
  it("refuses a persisted multi-cell operation without saveBatch and applies nothing", async () => {
    const save = vi.fn(), { state, current } = createPrefill(prefillOptions(), { save });
    await state.run();
    expect(await state.apply()).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(current.value!.pages[0]!.components[0]!.grid!.cells[0]![0]!.value).toBeNull();
  });
  it("applies one saveBatch, and a server conflict leaves the entire report unchanged", async () => {
    const saveBatch = vi.fn().mockResolvedValue({ conflicts: [{ message: "revision changed" }] }), { state, current, onError } = createPrefill(prefillOptions(), { saveBatch });
    await state.run(); expect(await state.apply()).toBe(false);
    expect(saveBatch).toHaveBeenCalledOnce(); expect(onError).toHaveBeenCalled();
    expect(current.value!.pages[0]!.components[0]!.grid!.cells[0]![1]!.value).toBe("");
  });
  it("isolates late loaders after cancellation, reload and disable", async () => {
    let resolve!: (rows: Awaited<ReturnType<ReportPrefillReviewOptions["load"]>>) => void;
    let signal!: AbortSignal;
    const { state, current, option } = createPrefill({ ...prefillOptions(), load: operation => { signal = operation.signal; return new Promise(done => { resolve = done; }); } });
    const old = state.run(); state.cancel(); expect(signal.aborted).toBe(true); await old;
    resolve([{ rowKey: "A", values: { qty: 9 } }]); await flushPromises(); expect(state.result.value).toBeNull();
    const reloaded = state.run(); current.value = plan(4); await reloaded; expect(signal.aborted).toBe(true);
    const disabled = state.run(); option.value = false; await disabled; expect(state.result.value).toBeNull();
  });
  it("bounds uncooperative loaders and displays timeout/failure without stale results", async () => {
    vi.useFakeTimers();
    const { state, wrapper } = createPrefill({ ...prefillOptions(), timeoutMs: 5, load: () => new Promise(() => {}) });
    const task = state.run(); await vi.advanceTimersByTimeAsync(6); await task;
    expect(state.busy.value).toBe(false); expect(wrapper.text()).toContain("timed out");
    const invalid = createPrefill({ ...prefillOptions(), timeoutMs: 0 }); await invalid.state.run(); expect(invalid.state.error.value).toContain("timeout");
  });
  it("paginates review rows at 50 and keeps navigation at the bottom", async () => {
    const { state, wrapper } = createPrefill({ ...prefillOptions(), fields: [{ field: "qty" }], load: () => Array.from({ length: 52 }, (_, index) => ({ rowKey: `R${index}`, values: { qty: 1 } })) });
    await state.run(); await flushPromises(); expect(wrapper.findAll("tbody tr")).toHaveLength(50);
    expect(wrapper.get("nav").text()).toContain("1 / 2"); await wrapper.get('button[aria-label="Next"]').trigger("click"); expect(wrapper.findAll("tbody tr")).toHaveLength(2);
  });
});
describe("optional data comparison", () => {
  it("extracts current query data, compares exactly and locates the existing report", async () => {
    const current = shallowRef<RenderPlan | null>(plan(2)), locate = vi.fn(); let state!: ReportDataComparisonState;
    const options = shallowRef<ReportDataComparisonReviewOptions>({ datasetId: "production", fields: [{ field: "qty", type: "decimal" }], load: () => [{ rowKey: "A", values: { qty: "1.1" } }, { rowKey: "removed", values: { qty: "1" } }] });
    const wrapper = mount(defineComponent({ setup() { state = useReportDataComparison({ plan: current, options, blocked: () => false, locate }); return () => h(ReportDataComparison, { state, messages }); } })); wrappers.add(wrapper);
    await state.run(); await flushPromises();
    expect(wrapper.text()).toContain("0.9"); expect(state.result.value?.counts).toMatchObject({ changed: 1, removed: 1 });
    await wrapper.get('tbody button').trigger("click"); expect(locate).toHaveBeenCalledWith({ pageIndex: 0, componentIndex: 0, rowIndex: 0, columnIndex: 0 });
    expect(state.locate(state.result.value!.differences[1]!)).toBe(false);
    current.value = plan(3); expect(state.result.value).toBeNull();
  });
  it("keeps unchanged empty review clear and reports loader failures", async () => {
    const current = shallowRef<RenderPlan | null>(plan(1)); let state!: ReportDataComparisonState;
    const options = shallowRef<ReportDataComparisonReviewOptions>({ datasetId: "production", fields: [{ field: "qty", type: "decimal" }], load: () => [{ rowKey: "A", values: { qty: 1 } }] });
    const wrapper = mount(defineComponent({ setup() { state = useReportDataComparison({ plan: current, options, blocked: () => false }); return () => h(ReportDataComparison, { state, messages }); } })); wrappers.add(wrapper);
    await state.run(); await flushPromises(); expect(wrapper.text()).toContain("No results");
    options.value = { ...options.value, load: () => { throw new Error("provider failed"); } }; await state.run(); await flushPromises(); expect(wrapper.get('[role="alert"]').text()).toBe("provider failed");
  });
});
