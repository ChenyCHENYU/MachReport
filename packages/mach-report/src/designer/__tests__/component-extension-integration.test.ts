// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { createReportComponentRegistry, defineReportTemplate, type ReportTemplateDocument } from "../../index";
import ReportTemplateEditor from "../ReportTemplateEditor.vue";
import type { TemplateEditorController } from "../useTemplateEditor";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const document = () => defineReportTemplate({ id: "extensions", name: "Extensions", template: { pages: [{ widthMm: 100, heightMm: 100, components: [] }] } });

describe("registered component canvas insertion", () => {
  it("uses the public editor command, owned geometry/history, and the existing preview assets option", async () => {
    const registry = createReportComponentRegistry([{ id: "business.stamp", version: "1.0.0", kind: "image", label: "Stamp", properties: { caption: { label: "Caption", type: "string", required: true } }, load: () => ({ render: () => PNG }) }]);
    const wrapper = mount(ReportTemplateEditor, { props: { modelValue: document(), preview: { assets: registry.assets } } });
    const editor = wrapper.vm as unknown as TemplateEditorController;
    try {
      const component = { ...registry.createComponent("business.stamp", { props: { caption: "Approved" } }), leftMm: 95, topMm: 95, widthMm: 20, heightMm: 10 };
      expect(editor.insertComponent(component)).toBe(true); component.widthMm = 1;
      await flushPromises();
      const updates = wrapper.emitted("update:modelValue")!;
      const updated = updates[updates.length - 1]![0] as ReportTemplateDocument;
      expect(updated.template.pages[0]!.components[0]).toMatchObject({ leftMm: 80, topMm: 90, widthMm: 20, heightMm: 10 });
      expect(editor.pendingLocalChanges).toBe(true);
      expect(wrapper.find('.mr-designer-preview img').attributes("src")).toBe(PNG);
      await wrapper.get('button[aria-label="撤销"]').trigger("click"); await flushPromises();
      expect(wrapper.find('.mr-designer-preview img').exists()).toBe(false);
      await wrapper.get('button[aria-label="重做"]').trigger("click"); await flushPromises();
      expect(wrapper.find('.mr-designer-preview img').attributes("src")).toBe(PNG);
      await wrapper.setProps({ readonly: true });
      expect(editor.insertComponent(component)).toBe(false);
    } finally { wrapper.unmount(); await registry.dispose(); }
  });

  it("rejects an invalid host component without partial insertion or executable JSON", async () => {
    const wrapper = mount(ReportTemplateEditor, { props: { modelValue: document() } }), editor = wrapper.vm as unknown as TemplateEditorController;
    try {
      expect(editor.insertComponent({ kind: "image", leftMm: 0, topMm: 0, widthMm: -1, heightMm: 10 })).toBe(false);
      expect(editor.pendingLocalChanges).toBe(false); expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    } finally { wrapper.unmount(); }
  });
});
