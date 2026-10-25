import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import ReportParamPanel from "../ReportParamPanel.vue";
import ReportPreview from "../ReportPreview.vue";
import { DEFAULT_MESSAGES } from "../config";
import type { ReportParamOptionsLoader } from "../param-options";
import type { ReportParamDef } from "../../index";
const defs: ReportParamDef[] = [
  { field: "plants", label: "工厂", type: "multiSelect", maxItems: 2, options: [{ value: "a,b", label: "甲厂" }, { value: "002", label: "乙厂" }, { value: "c", label: "丙厂" }] },
  { field: "region", label: "区域", type: "cascader", options: [{ value: "CN", label: "中国", children: [{ value: "YT", label: "烟台" }] }, { value: "US", label: "美国" }] },
  { field: "qty", label: "重量", type: "numberRange", min: 0, max: 100 },
];
function host(initial: Record<string, string> = {}, definitions = defs, loadOptions?: ReportParamOptionsLoader) {
  const values = ref(initial);
  const wrapper = mount(defineComponent({ setup: () => () => h(ReportParamPanel, { defs: definitions, modelValue: values.value, messages: DEFAULT_MESSAGES, attempted: true, loadOptions, "onUpdate:modelValue": (next: Record<string, string>) => { values.value = next; } }) }), { attachTo: document.body });
  return { wrapper, values };
}
describe("native compound query inputs", () => {
  it("searches static choices, toggles independent selected values and respects maximum item count", async () => {
    const { wrapper, values } = host();
    const input = wrapper.get('[role="combobox"]'); await input.trigger("click"); await flushPromises();
    expect(wrapper.get('[role="listbox"]').attributes("aria-multiselectable")).toBe("true");
    await wrapper.findAll('[role="option"]')[0]!.trigger("click");
    await wrapper.findAll('[role="option"]')[1]!.trigger("click");
    await wrapper.findAll('[role="option"]')[2]!.trigger("click");
    expect(values.value.plants).toBe('["a,b","002"]');
    await input.setValue("甲厂"); expect(wrapper.findAll('[role="option"]')).toHaveLength(1);
    await input.trigger("keydown", { key: "Enter" }); expect(values.value.plants).toBe('["002"]');
    await input.trigger("keydown", { key: "Escape" }); expect((input.element as HTMLInputElement).value).toBe("乙厂"); wrapper.unmount();
  });
  it("exposes cascader levels, rejects parent-only selections, clears descendants and preserves real zeros", async () => {
    const { wrapper, values } = host();
    const first = wrapper.get('select[aria-label="区域 · 1"]');
    await first.setValue("CN"); expect(values.value.region).toBe('["CN",null]');
    expect(wrapper.get(".mrp-param-error").text()).toContain("请选择完整的末级路径");
    await wrapper.get('select[aria-label="区域 · 2"]').setValue("YT"); expect(values.value.region).toBe('["CN","YT"]');
    await first.setValue("US"); expect(values.value.region).toBe('["US"]'); expect(wrapper.find('select[aria-label="区域 · 2"]').exists()).toBe(false);
    await wrapper.get('input[aria-label="重量 · 最小值"]').setValue("0"); expect(values.value.qty).toBe('[0,null]');
    await wrapper.get('input[aria-label="重量 · 最大值"]').setValue("2.5"); expect(values.value.qty).toBe('[0,2.5]');
    expect(wrapper.findAll(".mrp-param-error")).toHaveLength(0); wrapper.unmount();
  });
  it("uses the existing loader for remote tree options, snapshots children and supports retry status", async () => {
    const options = [{ value: "CN", label: "中国", children: [{ value: "YT", label: "烟台" }] }];
    const loader = vi.fn(async () => options);
    const { values, wrapper } = host({}, [{ field: "region", label: "区域", type: "cascader", optionsSource: "regions" }], loader);
    await flushPromises(); expect(loader).toHaveBeenCalledTimes(1); options[0]!.children[0]!.label = "mutated";
    await wrapper.get('select[aria-label="区域 · 1"]').setValue("CN"); expect(values.value.region).toBe('["CN",null]');
    expect(wrapper.get('select[aria-label="区域 · 2"]').text()).toContain("烟台");
    await wrapper.get('select[aria-label="区域 · 2"]').setValue("YT"); expect(values.value.region).toBe('["CN","YT"]'); wrapper.unmount();
  });
  it("blocks incomplete requests in ReportPreview, submits canonical values and resets all native controls", async () => {
    const fetcher = vi.fn(async () => ({ schemaVersion: "v1", pages: [] }));
    const wrapper = mount(ReportPreview, { props: { reportId: "compound", paramDefs: defs, autoLoad: false, fetcher }, attachTo: document.body });
    await wrapper.get('input[aria-label="重量 · 最小值"]').setValue("0"); await wrapper.get(".mrp-param-query").trigger("click"); expect(fetcher).not.toHaveBeenCalled();
    await wrapper.get('input[aria-label="重量 · 最大值"]').setValue("10");
    await wrapper.get('select[aria-label="区域 · 1"]').setValue("CN"); await wrapper.get(".mrp-param-query").trigger("click"); expect(fetcher).not.toHaveBeenCalled();
    await wrapper.get('select[aria-label="区域 · 2"]').setValue("YT"); await wrapper.get(".mrp-param-query").trigger("click"); await flushPromises();
    expect(fetcher).toHaveBeenCalledWith(expect.objectContaining({ params: { qty: "[0,10]", region: '["CN","YT"]' } }));
    await wrapper.findAll(".mrp-params-actions button")[1]!.trigger("click");
    expect((wrapper.get('input[aria-label="重量 · 最小值"]').element as HTMLInputElement).value).toBe(""); expect((wrapper.get('select[aria-label="区域 · 1"]').element as HTMLSelectElement).value).toBe(""); wrapper.unmount();
  });
});
