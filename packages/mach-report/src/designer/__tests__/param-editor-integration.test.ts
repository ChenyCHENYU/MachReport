import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { createTableTemplate, defineReportTemplate, type ReportTemplateDocument } from "../../index";
import ReportTemplateEditor from "../ReportTemplateEditor.vue";
import ParamEditor from "../ParamEditor.vue";

async function tab(wrapper: ReturnType<typeof mount>, name: string): Promise<void> {
  await wrapper.findAll('[role="tab"]').find(button => button.text() === name)!.trigger("click");
  await flushPromises();
}
function document() { return defineReportTemplate({ id: "parameter-flow", name: "参数设计", revision: "1", template: createTableTemplate({ columns: [{ field: "id", header: "编号" }] }) }); }
function params(wrapper: ReturnType<typeof mount>): ReportTemplateDocument["template"]["params"] { return (wrapper.emitted("update:modelValue")!.at(-1)![0] as ReportTemplateDocument).template.params; }

describe("integrated parameter design transactions", () => {
  it("guards unapplied form edits across tools and sections, then participates in undo/redo and CAS save", async () => {
    const save = vi.fn(async (doc: ReportTemplateDocument) => ({ ...doc, revision: "2" }));
    const wrapper = mount(ReportTemplateEditor, { props: { modelValue: document(), save }, global: { stubs: { ReportPreview: true } } });
    await tab(wrapper, "工具"); await wrapper.findAll(".mr-designer-tool-tabs button").find(button => button.text() === "查询参数")!.trigger("click");
    await flushPromises(); await vi.dynamicImportSettled();
    const form = wrapper.getComponent(ParamEditor);
    await form.findAll("button").find(button => button.text() === "+ 添加参数")!.trigger("click");
    await form.get('input[aria-label="参数标识"]').setValue("month");
    await form.get('select[aria-label="控件类型"]').setValue("month");
    expect(wrapper.get(".mr-designer-save").attributes("disabled")).toBeDefined();
    await (wrapper.vm as unknown as { save(): Promise<void> }).save(); expect(save).not.toHaveBeenCalled();
    await tab(wrapper, "模板"); await tab(wrapper, "工具");
    expect((form.get('input[aria-label="参数标识"]').element as HTMLInputElement).value).toBe("month");
    await wrapper.findAll(".mr-designer-tool-tabs button").find(button => button.text() === "发布检查")!.trigger("click");
    await wrapper.findAll(".mr-designer-tool-tabs button").find(button => button.text() === "查询参数")!.trigger("click");
    expect((form.get('select[aria-label="控件类型"]').element as HTMLSelectElement).value).toBe("month");
    const guard = (wrapper.vm as unknown as { guardChanges(): Promise<boolean> }).guardChanges(); await flushPromises();
    expect(wrapper.get('[role="alertdialog"]').text()).toContain("保留当前修改");
    await wrapper.findAll('[role="alertdialog"] button')[0]!.trigger("click"); expect(await guard).toBe(false);
    await form.findAll("button").find(button => button.text() === "校验并应用参数")!.trigger("click"); await flushPromises();
    expect(params(wrapper)).toEqual([{ field: "month", type: "month" }]);
    expect(wrapper.get(".mr-designer-save").attributes("disabled")).toBeUndefined();
    await wrapper.get('button[aria-label="撤销"]').trigger("click"); await flushPromises();
    expect(params(wrapper)).toBeUndefined(); expect(form.text()).toContain("尚未配置查询参数");
    await wrapper.get('button[aria-label="重做"]').trigger("click"); await flushPromises();
    expect(params(wrapper)).toEqual([{ field: "month", type: "month" }]);
    await wrapper.get(".mr-designer-save").trigger("click"); await flushPromises();
    expect(save).toHaveBeenCalledTimes(1); expect(save.mock.calls[0]?.[0].template.params).toEqual([{ field: "month", type: "month" }]);
    expect((save.mock.calls[0] as unknown[])[1]).toMatchObject({ expectedRevision: "1" });
    expect(wrapper.emitted("saved")?.[0]?.[0]).toMatchObject({ revision: "2" });
    expect((wrapper.vm as unknown as { pendingLocalChanges: boolean }).pendingLocalChanges).toBe(false); wrapper.unmount();
  });
});
