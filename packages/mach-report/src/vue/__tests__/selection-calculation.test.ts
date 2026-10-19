// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ReportCalculationPanel from "../ReportCalculationPanel.vue";
import { effectScope, ref, shallowRef } from "vue";
import { useSelectionCalculation, type ReportCalculationMessages } from "../composables/useSelectionCalculation";
import type { RenderPlan } from "../../schema/render-plan";
import type { ReportCalculationSelection } from "../../selection-calculations";

function fixture(rows = 1) {
  const plan = shallowRef<RenderPlan | null>({ schemaVersion: "test", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [{ kind: "rect", leftMm: 0, topMm: 0, widthMm: 20, heightMm: 20, grid: { cells: Array.from({ length: rows }, () => [{ value: 2, editable: false }]) } }] }] });
  const selection = shallowRef<ReportCalculationSelection | null>(null), enabled = ref(false);
  const scope = effectScope();
  const state = scope.run(() => useSelectionCalculation({ plan, selection, enabled: () => enabled.value }))!;
  const select = () => { selection.value = { anchor: { pageIndex: 0, componentIndex: 0, rowIndex: 0, columnIndex: 0 }, focus: { pageIndex: 0, componentIndex: 0, rowIndex: rows - 1, columnIndex: 0 } }; };
  return { plan, selection, enabled, scope, state, select };
}

describe("explicit, cancellable selection analysis", () => {
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
