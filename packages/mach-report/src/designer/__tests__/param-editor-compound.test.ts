import { flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import { describe, expect, it, vi } from "vitest";
import { createTableTemplate, defineReportTemplate, type ReportParamDef } from "../../index";
import ParamEditor from "../ParamEditor.vue";
function doc(params: ReportParamDef[]) { return defineReportTemplate({ id: "native-params", name: "Native", template: { ...createTableTemplate({ columns: [{ field: "name", header: "名称" }] }), params } }); }
const click = async (wrapper: ReturnType<typeof mount>, text: string) => wrapper.findAll("button").find(button => button.text() === text)!.trigger("click");
describe("compound parameter visual designer", () => {
  it("designs tree options with sibling levels, previews leaf defaults and saves an independent tree", async () => {
    const document = reactive(doc([{ field: "area", label: "区域", type: "cascader", options: [{ value: "CN", label: "中国" }] }]));
    const accept = vi.fn((params: ReportParamDef[]) => { document.template.params = params; return true; });
    const wrapper = mount(ParamEditor, { props: { document, accept }, attachTo: window.document.body });
    await wrapper.get('button[aria-label="添加下级 1"]').trigger("click");
    await wrapper.get('input[aria-label="接口值 2"]').setValue("YT"); await wrapper.get('input[aria-label="显示文字 2"]').setValue("烟台");
    expect(document.template.params?.[0]?.options?.[0]?.children).toBeUndefined();
    await wrapper.findAll('.mr-param-editor__checks input[type="checkbox"]')[1]!.setValue(true);
    await wrapper.get('select[aria-label="区域 · 1"]').setValue("CN");
    expect(wrapper.get(".mr-param-editor__errors").text()).toContain("请选择完整的末级路径");
    await wrapper.get('select[aria-label="区域 · 2"]').setValue("YT");
    await click(wrapper, "校验并应用参数"); await flushPromises();
    expect(document.template.params).toEqual([{ field: "area", label: "区域", type: "cascader", defaultValue: '["CN","YT"]', options: [{ value: "CN", label: "中国", children: [{ value: "YT", label: "烟台" }] }] }]);
    expect(accept).toHaveBeenCalledTimes(1); wrapper.unmount();
  });
  it("configures item budgets and numeric range defaults through actual native controls", async () => {
    const document = reactive(doc([{ field: "weights", label: "重量", type: "numberRange" }]));
    const accept = vi.fn((params: ReportParamDef[]) => { document.template.params = params; return true; });
    const wrapper = mount(ParamEditor, { props: { document, accept } });
    await wrapper.findAll('.mr-param-editor__checks input[type="checkbox"]')[1]!.setValue(true);
    await wrapper.get('input[aria-label="重量 · 最小值"]').setValue("0"); await wrapper.get('input[aria-label="重量 · 最大值"]').setValue("10");
    await wrapper.get('input[aria-label="最小值（含边界）"]').setValue("0"); await click(wrapper, "校验并应用参数"); await flushPromises();
    expect(document.template.params?.[0]).toMatchObject({ type: "numberRange", min: 0, defaultValue: "[0,10]" });
    await wrapper.findAll('.mr-param-editor__checks input[type="checkbox"]')[1]!.setValue(false);
    await wrapper.get('select[aria-label="控件类型"]').setValue("multiSelect");
    await wrapper.get('input[aria-label="最少选择项数"]').setValue("1"); await wrapper.get('input[aria-label="最多选择项数"]').setValue("101");
    expect(wrapper.get('[aria-label="最多选择项数"]').attributes("aria-invalid")).toBe("true");
    await wrapper.get('input[aria-label="最多选择项数"]').setValue("3"); await click(wrapper, "校验并应用参数"); await flushPromises();
    expect(document.template.params?.[0]).toMatchObject({ type: "multiSelect", minItems: 1, maxItems: 3 }); wrapper.unmount();
  });
});
