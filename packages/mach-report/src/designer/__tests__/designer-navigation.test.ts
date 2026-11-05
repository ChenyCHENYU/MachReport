import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { describe, expect, it, vi } from "vitest";
import { createTableTemplate, defineReportTemplate } from "../../index";
import { useTemplateEditor } from "../useTemplateEditor";
import { useTemplateWorkspace } from "../useTemplateWorkspace";
import { useTemplateInspector } from "../useTemplateInspector";
import { useDesignerNavigation } from "../useDesignerNavigation";
import ReportTemplateEditor from "../ReportTemplateEditor.vue";

describe("designer target navigation boundary", () => {
  it("keeps the field selected through the outline after visiting another page", async () => {
    const template = createTableTemplate({ columns: [{ field: "heat", header: "炉号" }, { field: "energy", header: "总用电量" }] });
    template.pages.push({ widthMm: 210, heightMm: 297, meta: { title: "附页" }, components: [{ kind: "text", text: "附页内容", leftMm: 10, topMm: 10, widthMm: 80, heightMm: 10 }] });
    const wrapper = mount(ReportTemplateEditor, { props: { modelValue: defineReportTemplate({ id: "test", name: "Test", template }) }, attachTo: document.body, global: { stubs: { ReportPreview: true } } });
    await wrapper.findAll('[role="tab"]').find(tab => tab.text() === "工具")!.trigger("click");
    await wrapper.findAll("button").find(button => button.text() === "结构大纲")!.trigger("click");
    await vi.dynamicImportSettled();
    await flushPromises();
    const search = wrapper.get('input[placeholder="搜索版面、组件、字段或引用"]');
    await search.setValue("附页");
    await wrapper.findAll(".mr-outline-tree button").find(button => button.text().includes("附页") && !button.text().includes("附页内容"))!.trigger("click");
    await search.setValue("energy");
    await wrapper.findAll(".mr-outline-tree button").find(button => button.text().includes("总用电量"))!.trigger("click");
    await wrapper.findAll('[role="tab"]').find(tab => tab.text() === "字段")!.trigger("click");
    expect(wrapper.get(".mr-designer-current-name small").text()).toBe("energy");
    wrapper.unmount();
  });
  it("does not let a late rule-discard confirmation replace a newer tool target", async () => {
    let editor!: ReturnType<typeof useTemplateEditor>, navigation!: ReturnType<typeof useDesignerNavigation>, workspace!: ReturnType<typeof useTemplateWorkspace>;
    const wrapper = mount(defineComponent({ setup() {
      const template = createTableTemplate({ columns: [{ field: "x", header: "X" }] });
      const list = template.pages[0]!.components.find(component => component.kind === "list")!;
      template.pages[0]!.components = [list, { ...list, id: "second" }];
      editor = useTemplateEditor({ modelValue: defineReportTemplate({ id: "test", name: "Test", template }) }, () => {});
      const inspector = useTemplateInspector(editor.selected, editor.activeList);
      workspace = useTemplateWorkspace(editor, inspector, () => undefined);
      navigation = useDesignerNavigation(editor, workspace, inspector, { id: "test", readonly: () => false });
      inspector.section.value = "tools"; workspace.tool.value = "reuse";
      return () => null;
    } }));
    let approve!: (approved: boolean) => void;
    vi.spyOn(editor, "isToolPending").mockReturnValue(true);
    vi.spyOn(editor, "guardChanges").mockImplementation(() => new Promise(resolve => { approve = resolve; }));
    const old = navigation.chooseCanvas({ pageIndex: 0, componentIndex: 1 });
    await navigation.chooseCanvas({ pageIndex: 0, componentIndex: 0 });
    approve(true); await old;
    expect(workspace.canvasSelection.value?.componentIndex).toBe(0);
    expect(navigation.toolPreview.value).toBe(true);
    wrapper.unmount();
  });
});
