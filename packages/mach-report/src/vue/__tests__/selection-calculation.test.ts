// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ReportCalculationPanel from "../ReportCalculationPanel.vue";
import { effectScope, ref, shallowRef } from "vue";
import { useSelectionCalculation, type ReportCalculationMessages } from "../composables/useSelectionCalculation";
import type { RenderPlan } from "../../schema/render-plan";
import type { ReportCalculationSelection } from "../../selection-calculations";
import * as core from "@agile-team/mach-report";

function fixture(rows = 1) {
  const plan = shallowRef<RenderPlan | null>({ schemaVersion: "test", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [{ kind: "rect", leftMm: 0, topMm: 0, widthMm: 20, heightMm: 20, grid: { cells: Array.from({ length: rows }, () => [{ value: 2, editable: false }]) } }] }] });
  const selection = shallowRef<ReportCalculationSelection | null>(null), enabled = ref(false);
  const scope = effectScope();
  const state = scope.run(() => useSelectionCalculation({ plan, selection, enabled: () => enabled.value }))!;
  const select = () => { selection.value = { anchor: { pageIndex: 0, componentIndex: 0, rowIndex: 0, columnIndex: 0 }, focus: { pageIndex: 0, componentIndex: 0, rowIndex: rows - 1, columnIndex: 0 } }; };
  return { plan, selection, enabled, scope, state, select };
}

describe("explicit, cancellable selection analysis", () => {
  it("requires explicit unit confirmation for cross-column selection without scanning its cells", async () => {
    vi.useFakeTimers();
    const { plan, selection, state, enabled, scope } = fixture();
    const grid = plan.value!.pages[0]!.components[0]!.grid!, cells = grid.cells;
    let reads = 0;
    Object.defineProperty(grid, "cells", { configurable: true, get: () => { reads++; return cells; } });
    try {
      enabled.value = true;
      selection.value = { anchor: { pageIndex: 0, componentIndex: 0, rowIndex: 0, columnIndex: 0 }, focus: { pageIndex: 0, componentIndex: 0, rowIndex: 0, columnIndex: 1 } };
      await vi.advanceTimersByTimeAsync(200);
      expect(reads).toBe(0); expect(state.summary.result.value).toBeNull(); expect(state.summary.requiresConfirmation.value).toBe(true);
    } finally { scope.stop(); vi.useRealTimers(); }
  });
  it("aborts an obsolete automatic summary and rejects its late result", async () => {
    vi.useFakeTimers();
    let finish: (value: core.ReportSelectionCalculationResult) => void = () => {};
    const compute = vi.spyOn(core, "calculateReportSelection").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { state, enabled, select, scope } = fixture();
    try {
      enabled.value = true; select(); await vi.advanceTimersByTimeAsync(150);
      expect(compute).toHaveBeenCalledOnce();
      const signal = compute.mock.calls[0]![2]!.signal!;
      select(); expect(signal.aborted).toBe(true);
      finish({ value: 99, formatted: "99.00", numericCells: 1, selectedCells: 1, excludedCells: 0, precision: 2 });
      await flushPromises(); expect(state.summary.result.value).toBeNull();
    } finally { scope.stop(); compute.mockRestore(); vi.useRealTimers(); }
  });
  it("waits for a settled selection before a single bounded summary pass and cancels an obsolete scheduled pass", async () => {
    vi.useFakeTimers();
    const { plan, state, enabled, select, scope } = fixture();
    const grid = plan.value!.pages[0]!.components[0]!.grid!, cells = grid.cells;
    let reads = 0;
    Object.defineProperty(grid, "cells", { configurable: true, get: () => { reads++; return cells; } });
    try {
      enabled.value = true; select(); await vi.advanceTimersByTimeAsync(149);
      expect(reads).toBe(0); select(); await vi.advanceTimersByTimeAsync(149); expect(reads).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(reads).toBeGreaterThan(0); expect(state.summary.result.value).toMatchObject({ value: 2, numericCells: 1 });
      select(); expect(state.summary.result.value).toBeNull(); scope.stop();
      const previous = reads; await vi.advanceTimersByTimeAsync(200); expect(reads).toBe(previous);
    } finally { scope.stop(); vi.useRealTimers(); }
  });
  it("defaults disabled, supports readonly cells and never computes while selection is moving", async () => {
    const fixtureA = fixture(); const { state, select, enabled, scope } = fixtureA;
    select(); await state.run(); expect(state.result.value).toBeNull();
    enabled.value = true; select(); expect(state.result.value).toBeNull();
    await state.run(); expect(state.result.value?.value).toBe(2);
    select(); expect(state.result.value).toBeNull(); expect(state.busy.value).toBe(false);
    scope.stop();
  });
  it("reports empty selection and clears obsolete diagnostics when configuration changes", async () => {
    const { state, enabled, scope } = fixture(); enabled.value = true;
    await state.run(); expect(state.error.value).toBe("selection");
    state.operation.value = "median"; expect(state.error.value).toBeNull();
    scope.stop();
  });
  it("reports automatic summary failures and clears them when the selection is replaced", async () => {
    vi.useFakeTimers();
    const { state, enabled, selection, select, scope } = fixture();
    try {
      enabled.value = true;
      selection.value = { anchor: { pageIndex: 0, componentIndex: 0, rowIndex: 999, columnIndex: 0 }, focus: { pageIndex: 0, componentIndex: 0, rowIndex: 999, columnIndex: 0 } };
      await vi.advanceTimersByTimeAsync(150);
      expect(state.summary.error.value).toBe("selection"); expect(state.summary.busy.value).toBe(false);
      select(); expect(state.summary.error.value).toBeNull(); await vi.advanceTimersByTimeAsync(150);
      expect(state.summary.result.value?.value).toBe(2);
    } finally { scope.stop(); vi.useRealTimers(); }
  });
  it.each(["selection", "plan", "disable", "cancel", "dispose"])("isolates a late result after %s", async (change) => {
    const { state, enabled, select, plan, scope } = fixture(5000); enabled.value = true; select();
    const pending = state.run(); expect(state.busy.value).toBe(true);
    if (change === "selection") select();
    if (change === "plan") plan.value = structuredClone(plan.value);
    if (change === "disable") enabled.value = false;
    if (change === "cancel") state.cancel();
    if (change === "dispose") scope.stop();
    await pending;
    expect(state.result.value).toBeNull(); expect(state.error.value).toBeNull(); expect(state.busy.value).toBe(false);
    scope.stop();
  });
});


describe("accessible calculation controls", () => {
  it("selects whitelisted operations, labels inputs and presents controlled-expression errors without modifying readonly data", async () => {
    const { plan, state, enabled, select, scope } = fixture(); enabled.value = true; select();
    const original = structuredClone(plan.value);
    const messages = new Proxy({ calculationTitle: "Selection analysis", calculationFormula: "Formula", calculationRun: "Calculate", calculationPrecision: "Decimal places", calculationErrorDivision: "Cannot divide by zero" }, { get: (target, key) => key in target ? target[key as keyof typeof target] : String(key) }) as ReportCalculationMessages;
    const wrapper = mount(ReportCalculationPanel, { props: { state, messages } });
    expect(wrapper.attributes("aria-label")).toBe("Selection analysis");
    expect(wrapper.findAll("select option")).toHaveLength(7);
    await wrapper.find("select").setValue("expression");
    await wrapper.find('input[type="text"]').setValue("SUM / 0");
    await wrapper.find("button").trigger("click"); await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toBe("Cannot divide by zero");
    await wrapper.find("select").setValue("average");
    await wrapper.find('input[type="number"]').setValue("3");
    await wrapper.find("button").trigger("click"); await flushPromises();
    expect(wrapper.find("output").text()).toBe("2.000");
    expect(wrapper.find('[role="status"]').attributes("aria-live")).toBe("polite");
    expect(plan.value).toEqual(original);
    wrapper.unmount(); scope.stop();
  });
});
