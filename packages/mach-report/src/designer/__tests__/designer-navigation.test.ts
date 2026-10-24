import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { describe, expect, it, vi } from "vitest";
import { createTableTemplate, defineReportTemplate } from "../../index";
import { useTemplateEditor } from "../useTemplateEditor";
import { useTemplateWorkspace } from "../useTemplateWorkspace";
import { useTemplateInspector } from "../useTemplateInspector";
import { useDesignerNavigation } from "../useDesignerNavigation";

describe("designer target navigation boundary", () => {
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
