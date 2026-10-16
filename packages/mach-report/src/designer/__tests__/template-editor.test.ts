import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, type PropType } from "vue";
import { describe, expect, it, vi } from "vitest";
import { createTableTemplate, defineReportTemplate, paginateTemplate, type ReportTemplateDocument } from "../../index";
import { useTemplateEditor, type TemplateEditorOptions } from "../useTemplateEditor";

function document() { return defineReportTemplate({ id: "daily", name: "日报", revision: "1", template: createTableTemplate({ layout: "wide", columns: [{ header: "炉号", field: "heat" }, { header: "产重", field: "weight" }] }) }); }
function harness(options: TemplateEditorOptions) {
  let editor!: ReturnType<typeof useTemplateEditor>;
  const wrapper = mount(defineComponent({
    props: { modelValue: { type: Object as PropType<ReportTemplateDocument>, required: true }, readonly: Boolean, save: { type: Function as PropType<TemplateEditorOptions["save"]>, default: undefined }, datasets: { type: Object as PropType<TemplateEditorOptions["datasets"]>, default: undefined } }, emits: ["update:modelValue", "saved"],
    setup(props, { emit }) { editor = useTemplateEditor(props as TemplateEditorOptions, emit); return () => null; }
  }), { props: options });
  return { wrapper, get editor() { return editor; } };
}

describe("轻量模板属性编辑器", () => {
  it("导入的合并表头修改对齐和文字后，实际计划同步更新且原始文档不变", () => {
    const doc = document();
    const list = doc.template.pages[0]!.components.find((component) => component.kind === "list")!;
    if (list.kind !== "list") throw new Error("fixture");
    list.headerGrid = { cells: [[{ text: "Combined", colSpan: 2, style: { align: "left" } }]], colWidthsMm: [30, 30], rowHeightsMm: [8] };
    const { wrapper, editor } = harness({ modelValue: doc });
    expect(editor.headerAlignments.value).toEqual(["left", "left"]);
    editor.setColumn(1, "headerAlign", "right");
    expect(editor.headerAlignments.value).toEqual(["right", "right"]);
    editor.setColumn(1, "header", "Updated");
    const plan = paginateTemplate(editor.draft.value.template, { detail: [] }).plan;
    const header = plan.pages[0]!.components.find((component) => component.table?.role === "header")!;
    expect(header.grid!.cells[0]![0]).toMatchObject({ text: "Updated", colSpan: 2, style: { align: "right" } });
    expect(editor.activeList.value!.columns.map((column) => column.headerAlign)).toEqual(["right", "right"]);
    expect(list.headerGrid.cells[0]![0]).toMatchObject({ text: "Combined", style: { align: "left" } });
    wrapper.unmount();
  });
  it("v-model回显不清空dirty，保存使用修订号且失败不丢草稿", async () => {
    const original = document();
    const save = vi.fn(async (value: ReportTemplateDocument, _context: Parameters<NonNullable<TemplateEditorOptions["save"]>>[1]) => ({ ...value, revision: "2" }));
    const { wrapper, editor } = harness({ modelValue: original, save });
    editor.setName("更新日报");
    const echoed = wrapper.emitted("update:modelValue")![0]![0] as ReportTemplateDocument;
    await wrapper.setProps({ modelValue: echoed });
    expect(editor.dirty.value).toBe(true);
    expect(original.name).toBe("日报");
    await editor.save();
    expect(save.mock.calls[0]?.[1]).toMatchObject({ expectedRevision: "1" });
    expect(editor.draft.value.revision).toBe("2");
    expect(editor.dirty.value).toBe(false);
    editor.setName("继续编辑");
    await wrapper.setProps({ save: vi.fn().mockRejectedValue(new Error("版本冲突")) });
    await editor.save();
    expect(editor.error.value).toBe("版本冲突");
    expect(editor.draft.value.name).toBe("继续编辑");
    expect(editor.dirty.value).toBe(true);
    wrapper.unmount();
  });

  it("字段语义/自然列宽变化作用于真实预览，非法值阻止预览和保存", () => {
    const { wrapper, editor } = harness({ modelValue: document(), datasets: { detail: [{ heat: "00123", weight: 0 }] } });
    editor.setColumn(0, "semanticRole", "identifier");
    editor.setColumn(0, "widthMm", "45");
    expect(editor.activeList.value?.widthMm).toBe(75);
    const plan = paginateTemplate(editor.draft.value.template, { detail: [{ heat: "00123", weight: 0 }] }).plan;
    expect(plan.pages[0]?.pageWidthMm).toBe(95);
    expect(plan.pages[0]?.components[1]?.grid?.cells[0]?.[0]?.style?.align).toBe("center");
    editor.setColumn(0, "widthMm", "0");
    expect(editor.validation.value.ok).toBe(false);
    expect(editor.fetcher.value).toBeUndefined();
    editor.reset();
    expect(editor.validation.value.ok).toBe(true);
    wrapper.unmount();
  });

  it("只读不编辑，JSON不能越权更换ID/修订，外部换模板取消旧保存", async () => {
    const { wrapper, editor } = harness({ modelValue: document(), readonly: true });
    editor.setName("禁止"); expect(editor.draft.value.name).toBe("日报");
    await wrapper.setProps({ readonly: false });
    editor.json.value = JSON.stringify({ ...document(), id: "other" }); editor.applyJson();
    expect(editor.error.value).toContain("不允许更换模板 ID");
    let done!: (document: ReportTemplateDocument) => void;
    const save = vi.fn(() => new Promise<ReportTemplateDocument>((resolve) => { done = resolve; }));
    await wrapper.setProps({ save }); editor.setName("旧草稿"); const pending = editor.save();
    const replacement = { ...document(), id: "replacement", name: "新模板" };
    await wrapper.setProps({ modelValue: replacement });
    done({ ...document(), name: "迟到结果", revision: "99" }); await pending; await flushPromises();
    expect(editor.draft.value.id).toBe("replacement"); expect(editor.saving.value).toBe(false);
    wrapper.unmount();
  });

  it("带必填参数的模板可以预览已提供的数据，不删除原文档参数契约", async () => {
    const doc = document(); doc.template.params = [{ field: "date", type: "date", required: true }];
    const { wrapper, editor } = harness({ modelValue: doc, datasets: { detail: [{ heat: "00123", weight: 0 }] } });
    const plan = await editor.fetcher.value!({ reportIds: ["draft"], params: {} });
    expect(plan.pages[0]?.components.some((component) => component.table?.role === "body")).toBe(true);
    expect(editor.draft.value.template.params?.[0]?.required).toBe(true);
    wrapper.unmount();
  });
});
