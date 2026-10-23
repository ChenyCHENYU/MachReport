import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, reactive, ref, type PropType, type VNode } from "vue";
import { reportParamsJsonSchema, validateReportParamDefinitions, validateReportParams, type ReportParamDef } from "../../index";
import { DEFAULT_MESSAGES } from "../config";
import ReportParamPanel from "../ReportParamPanel.vue";
import type { ReportParamOption, ReportParamOptionsInput, ReportParamOptionsLoader } from "../param-options";
import { useParamOptions } from "../composables/useParamOptions";

afterEach(() => vi.useRealTimers());
const definitions: ReportParamDef[] = [
  { field: "plant", label: "厂别", type: "select", options: [{ value: "A", label: "A厂" }, { value: "B", label: "B厂" }] },
  { field: "area", label: "区域", type: "select", optionsSource: "areas", dependsOn: ["plant"] },
  { field: "station", label: "工位", type: "select", optionsSource: "stations", dependsOn: ["area"] },
];
const TestHost = defineComponent({ props: { setupHost: { type: Function as PropType<() => () => VNode>, required: true } }, setup: props => props.setupHost() });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function harness(loader: ReportParamOptionsLoader) {
  const host = reactive({ def: definitions[1]!, values: { plant: "A" }, opened: false, disabled: false });
  let state!: ReturnType<typeof useParamOptions>;
  const wrapper = mount(TestHost, { props: { setupHost() { state = useParamOptions({ def: () => host.def, values: () => host.values, loader: () => loader, opened: () => host.opened, disabled: () => host.disabled }); return () => h("div"); } } });
  return { wrapper, host, get state() { return state; } };
}
describe("declared remote parameter sources", () => {
  it("validates source keys, dependency references/cycles and exports serializable metadata", () => {
    expect(validateReportParamDefinitions(definitions)).toEqual([]);
    for (const defs of [
      [{ field: "x", type: "select", optionsSource: "https://secret" }],
      [{ field: "x", type: "select", optionsSource: "remote", dependsOn: ["missing"] }],
      [{ field: "x", type: "select", optionsSource: "remote", dependsOn: ["x"] }],
      [{ field: "x", type: "select", optionsSource: "remote", options: [] }],
    ] as ReportParamDef[][]) expect(validateReportParamDefinitions(defs).length).toBeGreaterThan(0);
    const cyclic = [{ field: "a", type: "select", optionsSource: "a", dependsOn: ["b"] }, { field: "b", type: "select", optionsSource: "b", dependsOn: ["a"] }] as ReportParamDef[];
    expect(validateReportParamDefinitions(cyclic)).toHaveLength(2);
    expect(reportParamsJsonSchema(definitions)).toHaveProperty("properties.area.x-report-options-source", "areas");
    expect(validateReportParams(definitions, { plant: "", area: "stale" }).issues).toContainEqual(expect.objectContaining({ code: "dependency", field: "area" }));
  });
  it("captures only declared dependencies, cancels stale work and copies immutable response options", async () => {
    const first = deferred<readonly ReportParamOption[]>(), second = deferred<readonly ReportParamOption[]>();
    const calls: ReportParamOptionsInput[] = [];
    const loader: ReportParamOptionsLoader = input => { calls.push(input); return calls.length === 1 ? first.promise : second.promise; };
    const { wrapper, host, state } = harness(loader);
    host.opened = true; await flushPromises();
    host.values.plant = "B"; await flushPromises();
    expect(calls[0]!.signal.aborted).toBe(true); expect(calls[0]!.params).toEqual({ plant: "A" });
    expect(Object.isFrozen(calls[1]!.params)).toBe(true);
    const result = [{ value: "b", label: "B区" }]; second.resolve(result); await flushPromises(); result[0]!.label = "mutated";
    first.resolve([{ value: "old", label: "Old" }]); await flushPromises();
    expect(state.options.value).toEqual([{ value: "b", label: "B区" }]); expect(state.loading.value).toBe(false);
    wrapper.unmount();
  });
  it("debounces search, reuses bounded cache, expires it and cancels on unmount", async () => {
    vi.useFakeTimers();
    const loader = vi.fn(async () => [{ value: "x", label: "X" }]);
    const { wrapper, host, state } = harness(loader);
    host.opened = true; await flushPromises();
    state.query.value = "a"; state.query.value = "ab"; await vi.advanceTimersByTimeAsync(180); await flushPromises();
    expect(loader).toHaveBeenCalledTimes(2);
    await state.request(); expect(loader).toHaveBeenCalledTimes(2);
    for (let index = 0; index < 33; index++) { state.query.value = String(index); await state.request(); }
    state.query.value = "ab"; await state.request(); expect(loader).toHaveBeenCalledTimes(36);
    await vi.advanceTimersByTimeAsync(60_001); await state.request(); expect(loader).toHaveBeenCalledTimes(37);
    state.query.value = "pending"; wrapper.unmount(); await vi.advanceTimersByTimeAsync(200); expect(loader).toHaveBeenCalledTimes(37);
  });
  it("times out an unresponsive host and permits an explicit retry", async () => {
    vi.useFakeTimers();
    const calls: ReportParamOptionsInput[] = [];
    const loader: ReportParamOptionsLoader = input => { calls.push(input); return calls.length === 1 ? new Promise(() => {}) : Promise.resolve([{ value: "ok", label: "恢复" }]); };
    const { wrapper, host, state } = harness(loader);
    host.opened = true; await flushPromises();
    await vi.advanceTimersByTimeAsync(15_000); await flushPromises();
    expect(calls[0]!.signal.aborted).toBe(true); expect(state.failed.value).toBe(true); expect(state.loading.value).toBe(false);
    await state.request(); expect(state.failed.value).toBe(false); expect(state.options.value[0]?.value).toBe("ok");
    wrapper.unmount();
  });
  it("does not call loaders before parents exist and refuses malformed or oversized results", async () => {
    const loader = vi.fn(async () => Array.from({ length: 101 }, (_, index) => ({ value: String(index), label: "x" })));
    const { wrapper, host, state } = harness(loader);
    host.values.plant = ""; host.opened = true; await flushPromises(); expect(loader).not.toHaveBeenCalled(); expect(state.waiting.value).toBe(true);
    host.values.plant = "A"; await flushPromises(); expect(state.failed.value).toBe(true); expect(state.options.value).toEqual([]);
    wrapper.unmount();
  });
  it("changes a parent atomically clear all descendants and search text never becomes a selected value", async () => {
    const values = ref({ plant: "A", area: "a1", station: "a2" });
    const loader = vi.fn(async () => [{ value: "b1", label: "B区" }]);
    const wrapper = mount(TestHost, { props: { setupHost: () => () => h(ReportParamPanel, { defs: definitions, modelValue: values.value, messages: DEFAULT_MESSAGES, attempted: false, loadOptions: loader, "onUpdate:modelValue": (next: Record<string, string>) => { values.value = next as typeof values.value; } }) }, attachTo: document.body });
    await wrapper.get("select").setValue("B"); expect(values.value).toEqual({ plant: "B", area: "", station: "" });
    const input = wrapper.findAll('[role="combobox"]')[0]!;
    await input.trigger("click"); await flushPromises();
    await input.setValue("unselected text"); expect(values.value.area).toBe("");
    await vi.waitFor(() => expect(wrapper.findAll('[role="option"]')).toHaveLength(1));
    await input.trigger("keydown", { key: "Enter", isComposing: true }); expect(values.value.area).toBe("");
    await input.trigger("keydown", { key: "Enter" }); await flushPromises(); expect(values.value.area).toBe("b1");
    expect((input.element as HTMLInputElement).value).toBe("B区");
    expect(loader.mock.calls.length).toBeGreaterThan(0); wrapper.unmount();
  });
});
