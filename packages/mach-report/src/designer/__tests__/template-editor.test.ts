import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, type PropType } from "vue";
import { describe, expect, it, vi } from "vitest";
import {
  createTableTemplate,
  defineReportTemplate,
  paginateTemplate,
  type ReportTemplateDocument,
} from "../../index";
import {
  useTemplateEditor,
  type TemplateEditorOptions,
} from "../useTemplateEditor";

function document() {
  return defineReportTemplate({
    id: "daily",
    name: "日报",
    revision: "1",
    template: createTableTemplate({
      layout: "wide",
      columns: [
        { header: "炉号", field: "heat" },
        { header: "产重", field: "weight" },
      ],
    }),
  });
}
function harness(options: TemplateEditorOptions) {
  let editor!: ReturnType<typeof useTemplateEditor>;
  const wrapper = mount(
    defineComponent({
      props: {
        modelValue: {
          type: Object as PropType<ReportTemplateDocument>,
          required: true,
        },
        readonly: Boolean,
        beforeDiscard: {
          type: Function as PropType<TemplateEditorOptions["beforeDiscard"]>,
          default: undefined,
        },
        save: {
          type: Function as PropType<TemplateEditorOptions["save"]>,
          default: undefined,
        },
        datasets: {
          type: Object as PropType<TemplateEditorOptions["datasets"]>,
          default: undefined,
        },
      },
      emits: ["update:modelValue", "saved"],
      setup(props, { emit }) {
        editor = useTemplateEditor(props as TemplateEditorOptions, emit);
        return () => null;
      },
    }),
    { props: options },
  );
  return {
    wrapper,
    get editor() {
      return editor;
    },
  };
}

describe("轻量模板属性编辑器", () => {
  it("keeps preview identity for metadata edits and refreshes only layout or dataset changes", async () => {
    const { wrapper, editor } = harness({ modelValue: document(), datasets: { detail: [{ heat: "A", weight: 0 }] } });
    await flushPromises();
    const initial = editor.fetcher.value;
    editor.setName("New name"); editor.setDescription("Description");
    await flushPromises();
    expect(editor.fetcher.value).toBe(initial);
    expect(editor.pendingLocalChanges.value).toBe(true);
    editor.setColumn(1, "header", "New header");
    await flushPromises();
    expect(editor.fetcher.value).not.toBe(initial);
    const layout = editor.fetcher.value;
    await wrapper.setProps({ datasets: { detail: [{ heat: "B", weight: 2 }] } });
    expect(editor.fetcher.value).not.toBe(layout);
    wrapper.unmount();
  });
  it("普通表头的默认对齐及分层覆盖在属性面板与真实分页结果中保持一致", () => {
    const configurations = [
      {},
      { column: { style: { align: "right" as const } } },
      {
        headerAlign: "left" as const,
        column: { style: { align: "right" as const } },
      },
      {
        headerAlign: "left" as const,
        headerStyle: { align: "center" as const },
      },
      {
        headerStyle: { align: "center" as const },
        column: { headerAlign: "right" as const },
      },
      {
        column: {
          headerAlign: "right" as const,
          headerStyle: { align: "justify" as const },
        },
      },
    ];
    for (const { column, ...configuration } of configurations) {
      const doc = document();
      const list = doc.template.pages[0]!.components[0]!;
      if (list.kind !== "list") throw new Error("fixture");
      delete list.headerAlign;
      Object.assign(list, configuration);
      Object.assign(list.columns[0]!, column);
      const { wrapper, editor } = harness({ modelValue: doc });
      const plan = paginateTemplate(editor.draft.value.template, {
        detail: [],
      }).plan;
      const header = plan.pages[0]!.components.find(
        (component) => component.table?.role === "header",
      )!;
      expect(editor.headerAlignments.value[0]).toBe(
        header.grid!.cells[0]![0]!.style!.align,
      );
      wrapper.unmount();
    }
  });

  it("导入的合并表头修改对齐和文字后，实际计划同步更新且原始文档不变", () => {
    const doc = document();
    const list = doc.template.pages[0]!.components.find(
      (component) => component.kind === "list",
    )!;
    if (list.kind !== "list") throw new Error("fixture");
    list.headerGrid = {
      cells: [[{ text: "Combined", colSpan: 2, style: { align: "left" } }]],
      colWidthsMm: [30, 30],
      rowHeightsMm: [8],
    };
    const { wrapper, editor } = harness({ modelValue: doc });
    expect(editor.headerAlignments.value).toEqual(["left", "left"]);
    editor.setColumn(1, "headerAlign", "right");
    expect(editor.headerAlignments.value).toEqual(["right", "right"]);
    editor.setColumn(1, "header", "Updated");
    const plan = paginateTemplate(editor.draft.value.template, {
      detail: [],
    }).plan;
    const header = plan.pages[0]!.components.find(
      (component) => component.table?.role === "header",
    )!;
    expect(header.grid!.cells[0]![0]).toMatchObject({
      text: "Updated",
      colSpan: 2,
      style: { align: "right" },
    });
    expect(
      editor.activeList.value!.columns.map((column) => column.headerAlign),
    ).toEqual(["right", "right"]);
    expect(list.headerGrid.cells[0]![0]).toMatchObject({
      text: "Combined",
      style: { align: "left" },
    });
    wrapper.unmount();
  });
  it("v-model回显不清空dirty，保存使用修订号且失败不丢草稿", async () => {
    const original = document();
    const save = vi.fn(
      async (
        value: ReportTemplateDocument,
        _context: Parameters<NonNullable<TemplateEditorOptions["save"]>>[1],
      ) => ({ ...value, revision: "2" }),
    );
    const { wrapper, editor } = harness({ modelValue: original, save });
    editor.setName("更新日报");
    const echoed = wrapper.emitted(
      "update:modelValue",
    )![0]![0] as ReportTemplateDocument;
    await wrapper.setProps({ modelValue: echoed });
    expect(editor.dirty.value).toBe(true);
    expect(original.name).toBe("日报");
    await editor.save();
    expect(save.mock.calls[0]?.[1]).toMatchObject({ expectedRevision: "1" });
    expect(editor.draft.value.revision).toBe("2");
    expect(editor.dirty.value).toBe(false);
    editor.setName("继续编辑");
    await wrapper.setProps({
      save: vi.fn().mockRejectedValue(new Error("版本冲突")),
    });
    await editor.save();
    expect(editor.error.value).toBe("版本冲突");
    expect(editor.draft.value.name).toBe("继续编辑");
    expect(editor.dirty.value).toBe(true);
    wrapper.unmount();
  });

  it("字段语义/自然列宽变化作用于真实预览，非法值阻止预览和保存", async () => {
    const { wrapper, editor } = harness({
      modelValue: document(),
      datasets: { detail: [{ heat: "00123", weight: 0 }] },
      beforeDiscard: () => true,
    });
    editor.setColumn(0, "semanticRole", "identifier");
    editor.setColumn(0, "widthMm", "45");
    expect(editor.activeList.value?.widthMm).toBe(75);
    const plan = paginateTemplate(editor.draft.value.template, {
      detail: [{ heat: "00123", weight: 0 }],
    }).plan;
    expect(plan.pages[0]?.pageWidthMm).toBe(95);
    expect(
      plan.pages[0]?.components[1]?.grid?.cells[0]?.[0]?.style?.align,
    ).toBe("center");
    editor.setColumn(0, "widthMm", "0");
    expect(editor.validation.value.ok).toBe(false);
    expect(editor.fetcher.value).toBeUndefined();
    await editor.reset();
    expect(editor.validation.value.ok).toBe(true);
    wrapper.unmount();
  });

  it("只读不编辑，JSON不能越权更换ID/修订，外部换模板取消旧保存", async () => {
    const { wrapper, editor } = harness({
      modelValue: document(),
      readonly: true,
      beforeDiscard: () => true,
    });
    editor.setName("禁止");
    expect(editor.draft.value.name).toBe("日报");
    await wrapper.setProps({ readonly: false });
    editor.json.value = JSON.stringify({ ...document(), id: "other" });
    editor.applyJson();
    expect(editor.error.value).toContain("不允许更换模板 ID");
    editor.undo();
    let done!: (document: ReportTemplateDocument) => void;
    const save = vi.fn(
      () =>
        new Promise<ReportTemplateDocument>((resolve) => {
          done = resolve;
        }),
    );
    await wrapper.setProps({ save });
    editor.setName("旧草稿");
    const pending = editor.save();
    const replacement = { ...document(), id: "replacement", name: "新模板" };
    await wrapper.setProps({ modelValue: replacement });
    done({ ...document(), name: "迟到结果", revision: "99" });
    await pending;
    await flushPromises();
    expect(editor.draft.value.id).toBe("replacement");
    expect(editor.saving.value).toBe(false);
    wrapper.unmount();
  });

  it("带必填参数的模板可以预览已提供的数据，不删除原文档参数契约", async () => {
    const doc = document();
    doc.template.params = [{ field: "date", type: "date", required: true }];
    const { wrapper, editor } = harness({
      modelValue: doc,
      datasets: { detail: [{ heat: "00123", weight: 0 }] },
    });
    const plan = await editor.fetcher.value!({
      reportIds: ["draft"],
      params: {},
    });
    expect(
      plan.pages[0]?.components.some(
        (component) => component.table?.role === "body",
      ),
    ).toBe(true);
    expect(editor.draft.value.template.params?.[0]?.required).toBe(true);
    wrapper.unmount();
  });

  it("默认确认保护恢复及外部替换，未应用 JSON 也属于本地修改", async () => {
    const { wrapper, editor } = harness({ modelValue: document() });
    editor.json.value = "{尚未完成";
    expect(editor.dirty.value).toBe(false);
    expect(editor.pendingLocalChanges.value).toBe(true);
    const pending = editor.reset();
    expect(editor.confirmation.value?.reason).toBe("reset");
    editor.decideDiscard(false);
    await pending;
    expect(editor.json.value).toBe("{尚未完成");
    const replacement = { ...document(), id: "next", name: "其他模板" };
    await wrapper.setProps({ modelValue: replacement });
    expect(editor.confirmation.value?.reason).toBe("replace");
    expect(editor.draft.value.id).toBe("daily");
    editor.decideDiscard(true);
    await flushPromises();
    expect(editor.draft.value.id).toBe("next");
    expect(editor.pendingLocalChanges.value).toBe(false);
    wrapper.unmount();
  });

  it("异步宿主保护只应用最新意图，失败与迟到响应不覆盖草稿", async () => {
    const resolvers: Array<(allow: boolean) => void> = [];
    const beforeDiscard = vi.fn(
      () => new Promise<boolean>((resolve) => resolvers.push(resolve)),
    );
    const { wrapper, editor } = harness({
      modelValue: document(),
      beforeDiscard,
    });
    editor.setName("未保存");
    await wrapper.setProps({ modelValue: { ...document(), id: "one" } });
    await wrapper.setProps({ modelValue: { ...document(), id: "two" } });
    resolvers[0]!(true);
    await flushPromises();
    expect(editor.draft.value.id).toBe("daily");
    resolvers[1]!(true);
    await flushPromises();
    expect(editor.draft.value.id).toBe("two");
    editor.setName("保留我");
    await wrapper.setProps({
      beforeDiscard: async () => {
        throw new Error("确认服务不可用");
      },
    });
    await editor.reset();
    expect(editor.draft.value.name).toBe("保留我");
    expect(editor.error.value).toBe("确认服务不可用");
    wrapper.unmount();
  });

  it("列搜索保留物理索引、批量对齐是一笔撤销，保存后的历史不会回退修订", async () => {
    const save = vi.fn(async (value: ReportTemplateDocument) => ({
      ...value,
      revision: "2",
    }));
    const { wrapper, editor } = harness({ modelValue: document(), save });
    editor.query.value = "weight";
    expect(editor.visibleColumns.value.map((item) => item.index)).toEqual([1]);
    editor.selectVisible(true);
    editor.alignColumns("align", "right");
    expect(editor.activeList.value!.columns[1]!.align).toBe("right");
    expect(editor.activeList.value!.columns[0]!.align).toBeUndefined();
    editor.undo();
    expect(editor.activeList.value!.columns[1]!.align).toBeUndefined();
    editor.redo();
    expect(editor.activeList.value!.columns[1]!.align).toBe("right");
    await editor.save();
    expect(editor.canUndo.value).toBe(false);
    expect(editor.draft.value.revision).toBe("2");
    editor.setName("修订 2 修改");
    editor.undo();
    expect(editor.draft.value.revision).toBe("2");
    expect(editor.pendingLocalChanges.value).toBe(false);
    wrapper.unmount();
  });

  it("未应用 JSON 阻止保存和属性覆盖，撤销重做可保留该输入", async () => {
    const save = vi.fn(async (value: ReportTemplateDocument) => value);
    const { wrapper, editor } = harness({ modelValue: document(), save });
    editor.json.value = "{working";
    editor.setName("不能覆盖");
    await editor.save();
    expect(save).not.toHaveBeenCalled();
    expect(editor.draft.value.name).toBe("日报");
    editor.undo();
    expect(editor.jsonPending.value).toBe(false);
    editor.redo();
    expect(editor.json.value).toBe("{working");
    wrapper.unmount();
  });

  it("自定义确认忽略取消时，替换决定和卸载仍结束旧 guardChanges 等待", async () => {
    const answers: Array<(allow: boolean) => void> = [];
    const { wrapper, editor } = harness({
      modelValue: document(),
      beforeDiscard: () =>
        new Promise<boolean>((resolve) => answers.push(resolve)),
    });
    editor.setName("本地草稿");
    const first = editor.guardChanges();
    await flushPromises();
    const second = editor.guardChanges();
    await expect(first).resolves.toBe(false);
    await flushPromises();
    expect(answers).toHaveLength(2);
    wrapper.unmount();
    await expect(second).resolves.toBe(false);
    expect(editor.blocked.value).toBe(false);
    answers.forEach((resolve) => resolve(true));
    await flushPromises();
    expect(editor.draft.value.name).toBe("本地草稿");
  });
  it("设计命令事务仅提交有效候选，一次撤销，非法候选及readonly/JSON/saving不写草稿", async () => {
    const { wrapper, editor } = harness({ modelValue: document() });
    expect(
      editor.transaction((draft) => {
        draft.name = "设计名称";
        draft.description = "一笔命令";
      }),
    ).toBe(true);
    expect(wrapper.emitted("update:modelValue")).toHaveLength(1);
    editor.undo();
    expect(editor.draft.value.name).toBe("日报");
    expect(editor.draft.value.description).toBeUndefined();
    editor.redo();
    expect(
      editor.transaction((draft) => {
        draft.template.pages[0]!.widthMm = -1;
      }),
    ).toBe(false);
    expect(editor.validation.value.ok).toBe(true);
    expect(editor.error.value).toContain("widthMm");
    editor.json.value = "{尚未应用";
    expect(
      editor.transaction((draft) => {
        draft.name = "不允许";
      }),
    ).toBe(false);
    editor.undo();
    await wrapper.setProps({ readonly: true });
    expect(
      editor.transaction((draft) => {
        draft.name = "不允许";
      }),
    ).toBe(false);
    wrapper.unmount();
  });
  it("导入独立模板先保护旧草稿，取消不覆盖，确认才以新身份应用", async () => {
    const { wrapper, editor } = harness({ modelValue: document() });
    editor.setName("保留");
    const replacement = { ...document(), id: "imported", name: "导入" };
    const first = editor.replaceDocument(replacement);
    editor.decideDiscard(false);
    await expect(first).resolves.toBe(false);
    expect(editor.draft.value.name).toBe("保留");
    const second = editor.replaceDocument(replacement);
    editor.decideDiscard(true);
    await expect(second).resolves.toBe(true);
    expect(editor.draft.value.id).toBe("imported");
    expect(editor.pendingLocalChanges.value).toBe(true);
    wrapper.unmount();
  });
});
