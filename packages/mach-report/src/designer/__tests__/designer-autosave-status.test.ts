import { flushPromises, mount } from "@vue/test-utils";
import { expect, it } from "vitest";
import { createTableTemplate, defineReportTemplate } from "../../index";
import ReportTemplateEditor from "../ReportTemplateEditor.vue";

it("keeps asynchronous draft feedback in the existing header while storage errors remain actionable", async () => {
  let complete!: () => void, fail = false;
  const gate = new Promise<void>(resolve => { complete = resolve; });
  const wrapper = mount(ReportTemplateEditor, {
    props: {
      modelValue: defineReportTemplate({ id: "autosave-status", name: "日报", template: createTableTemplate({ columns: [{ field: "heat", header: "炉号" }] }) }),
      draftStorage: { scope: "test", debounceMs: 0, adapter: { read: () => null, remove() {}, async write() { await gate; if (fail) throw new Error("storage unavailable"); } } },
      recoveryMessages: { saving: "暂存进行中", autosaved: "本地暂存完成", storageError: "暂存失败" },
    },
    global: { stubs: { ReportPreview: true, TemplateDesignCanvas: true } },
  });
  const tick = async () => { await flushPromises(); await new Promise(resolve => setTimeout(resolve, 5)); await flushPromises(); };
  try {
    await tick();
    const header = wrapper.get(".mr-designer-bar [role=status]");
    await wrapper.get('[data-mr-control="column-header"]').setValue("新炉号"); await tick();
    expect(header.text()).toBe("暂存进行中");
    expect(header.attributes("aria-atomic")).toBe("true");
    expect(header.attributes("title")).toBe("暂存进行中 · 有未保存修改");
    complete(); await tick();
    expect(header.text()).toBe("本地暂存完成");
    expect(wrapper.find(".mr-recovery-status").exists()).toBe(false);
    fail = true;
    await wrapper.get('[data-mr-control="column-header"]').setValue("再次修改"); await tick();
    expect(header.text()).toBe("有未保存修改");
    expect(wrapper.get('[role="alert"]').text()).toContain("暂存失败：storage unavailable");
    expect(wrapper.get('[role="alert"] button').text()).toBe("放弃草稿");
  } finally { complete(); wrapper.unmount(); }
});
