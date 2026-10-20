import { flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import { describe, expect, it, vi } from "vitest";
import { createTableTemplate, defineReportTemplate, type ReportParamDef } from "../../index";
import ParamEditor from "../ParamEditor.vue";

function document(params: ReportParamDef[] = []) { return defineReportTemplate({ id: "parameter", name: "Parameter", template: { ...createTableTemplate({ columns: [{ field: "name", header: "名称" }] }), params } }); }
const click = async (wrapper: ReturnType<typeof mount>, text: string) => wrapper.findAll("button").find(button => button.text() === text)!.trigger("click");

describe("visual parameter designer", () => {
  it("edits locally and applies a complete definition array only after shared validation", async () => {
    const doc = reactive(document([{ field: "date", label: "日期", type: "date", required: true }]));
    const accept = vi.fn((params: ReportParamDef[]) => { doc.template.params = params; return true; });
    const wrapper = mount(ParamEditor, { props: { document: doc, accept } });
    await wrapper.get('input[aria-label="参数标识"]').setValue("period");
    await wrapper.get('select[aria-label="控件类型"]').setValue("dateRange");
    await wrapper.findAll('input[type="checkbox"]')[1]!.setValue(true);
    await wrapper.get('input[aria-label="默认值"]').setValue("2026-10-20/");
    expect(doc.template.params?.[0]?.field).toBe("date"); expect(accept).not.toHaveBeenCalled();
    expect(wrapper.get(".mr-param-editor__errors").text()).toContain("完整且有序");
    expect(wrapper.findAll("button").find(button => button.text() === "校验并应用参数")!.attributes("disabled")).toBeDefined();
    expect(wrapper.get(".mr-param-editor__impact").text()).toContain("移除：date");
    await wrapper.get('input[aria-label="默认值"]').setValue("2026-10-01/2026-10-20");
    await wrapper.get('input[aria-label="最小值（含边界）"]').setValue("2026-10-01");
    await click(wrapper, "校验并应用参数"); await flushPromises();
    expect(accept).toHaveBeenCalledTimes(1);
    expect(doc.template.params).toEqual([{ field: "period", label: "日期", type: "dateRange", required: true, defaultValue: "2026-10-01/2026-10-20", min: "2026-10-01" }]);
    expect(wrapper.emitted("dirty")?.at(-1)).toEqual([false]); wrapper.unmount();
  });
  it("creates static select options, prevents duplicate keys, reorders and deletes atomically", async () => {
    const doc = reactive(document([{ field: "plant", type: "select", options: [{ value: "A", label: "厂A" }] }]));
    const accept = vi.fn((params: ReportParamDef[]) => { doc.template.params = params; return true; });
    const wrapper = mount(ParamEditor, { props: { document: doc, accept } });
    await click(wrapper, "+ 添加选项");
    await wrapper.get('input[aria-label="接口值 2"]').setValue("B"); await wrapper.get('input[aria-label="显示文字 2"]').setValue("厂B");
    await click(wrapper, "+ 添加参数"); await wrapper.get('input[aria-label="参数标识"]').setValue("plant");
    expect(wrapper.get(".mr-param-editor__errors").text()).toContain("不重复");
    await wrapper.get('input[aria-label="参数标识"]').setValue("year"); await wrapper.get('select[aria-label="控件类型"]').setValue("year");
    await click(wrapper, "↑ 上移参数"); await click(wrapper, "校验并应用参数"); await flushPromises();
    expect(doc.template.params).toEqual([{ field: "year", type: "year" }, { field: "plant", type: "select", options: [{ value: "A", label: "厂A" }, { value: "B", label: "厂B" }] }]);
    await click(wrapper, "删除参数"); await click(wrapper, "校验并应用参数"); await flushPromises();
    expect(doc.template.params?.map(param => param.field)).toEqual(["plant"]); wrapper.unmount();
  });
  it("retains unapplied drafts on external parameter changes and requires explicit restoration", async () => {
    const doc = reactive(document([{ field: "x", type: "text" }])); const accept = vi.fn(() => true);
    const wrapper = mount(ParamEditor, { props: { document: doc, accept } });
    await wrapper.get('input[aria-label="显示名称"]').setValue("本地未保存");
    doc.template.params = [{ field: "server", type: "year" }]; await flushPromises();
    expect((wrapper.get('input[aria-label="显示名称"]').element as HTMLInputElement).value).toBe("本地未保存");
    expect(wrapper.text()).toContain("模板参数已在其他操作中变更");
    expect((wrapper.vm as unknown as { apply(): boolean }).apply()).toBe(false); expect(accept).not.toHaveBeenCalled();
    await click(wrapper, "恢复参数草稿");
    expect((wrapper.get('input[aria-label="参数标识"]').element as HTMLInputElement).value).toBe("server");
    expect(wrapper.emitted("dirty")?.at(-1)).toEqual([false]); wrapper.unmount();
  });
  it("keeps rejected transactions dirty, handles readonly mode and never mutates source options", async () => {
    const doc = document([{ field: "plant", type: "select", options: [{ value: "A", label: "厂A" }] }]);
    const wrapper = mount(ParamEditor, { props: { document: doc, accept: () => false } });
    await wrapper.get('input[aria-label="显示文字 1"]').setValue("本地厂名"); await click(wrapper, "校验并应用参数");
    expect(wrapper.text()).toContain("参数未应用"); expect(doc.template.params?.[0]?.options?.[0]?.label).toBe("厂A");
    expect((wrapper.vm as unknown as { pending: boolean }).pending).toBe(true);
    await wrapper.setProps({ readonly: true });
    expect(wrapper.get('input[aria-label="参数标识"]').attributes("disabled")).toBeDefined();
    expect((wrapper.vm as unknown as { apply(): boolean }).apply()).toBe(false);
    await click(wrapper, "恢复参数草稿"); expect((wrapper.vm as unknown as { pending: boolean }).pending).toBe(false); wrapper.unmount();
  });
});
