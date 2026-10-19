import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { describe, expect, it, vi } from "vitest";
import {
  createTableTemplate,
  defineReportTemplate,
  RENDER_PLAN_SCHEMA_VERSION,
  type ReportTemplateDocument,
} from "../../index";
import ReportTemplateEditor from "../ReportTemplateEditor.vue";
import type { ExcelBindingSession } from "../../xlsx/binding-workflow";
function fixture() {
  return defineReportTemplate({
    id: "daily",
    name: "日报",
    template: createTableTemplate({
      layout: "wide",
      title: "标题",
      columns: [{ header: "炉号", field: "heat" }],
    }),
  });
}
const session: ExcelBindingSession = {
  version: "1.0",
  identity: { id: "bound", name: "绑定" },
  recipe: {
    version: "1.0",
    sheet: "日报",
    dataset: "detail",
    rowKey: "heat",
    regions: { header: "A1:A1", detail: "A2:A2" },
    fields: ["heat"],
  },
  source: {
    warnings: [],
    sheets: [
      {
        name: "日报",
        index: 1,
        range: "A1:A2",
        rowCount: 2,
        columnCount: 1,
        pageStart: 0,
        pageCount: 1,
      },
    ],
    template: {
      schemaVersion: RENDER_PLAN_SCHEMA_VERSION,
      pages: [
        {
          widthMm: 30,
          heightMm: 100,
          components: [
            {
              kind: "text",
              leftMm: 0,
              topMm: 0,
              widthMm: 30,
              heightMm: 16,
              meta: { xlsxSheet: "日报", xlsxRange: "A1:A2" },
              grid: {
                cells: [[{ text: "炉号" }], [{ text: "001" }]],
                colWidthsMm: [30],
                rowHeightsMm: [8, 8],
              },
            },
          ],
        },
      ],
    },
  },
};
const wizard = defineComponent({
  name: "ExcelBindingWizard",
  props: {
    session: { type: Object, default: undefined },
    datasets: { type: Array, default: () => [] },
    readonly: Boolean,
  },
  emits: ["apply"],
  setup(props, { emit }) {
    return () =>
      h(
        "button",
        {
          disabled: props.readonly,
          onClick: () =>
            emit("apply", {
              document: { ...fixture(), id: "bound", name: "绑定" },
              recipe: session.recipe,
              session,
              warnings: [],
            }),
        },
        "生成绑定模板",
      );
  },
});
async function tab(wrapper: ReturnType<typeof mount>, name: string) {
  const target = wrapper
    .findAll('[role="tab"]')
    .find((item) => item.text() === name);
  if (!target) throw new Error(`Missing tab ${name}`);
  await target.trigger("click");
  await flushPromises();
}
describe("完整设计器工作流", () => {
  it("绑定会话传给向导，旧草稿取消不发送accepted事件，确认后只发一次完整会话", async () => {
    const wrapper = mount(ReportTemplateEditor, {
      props: { modelValue: fixture(), bindingSession: session },
      global: { stubs: { ReportPreview: true, ExcelBindingWizard: wizard } },
    });
    await tab(wrapper, "模板");
    await wrapper.get("input").setValue("未保存名称");
    await tab(wrapper, "工具");
    const mounted = wrapper.getComponent({ name: "ExcelBindingWizard" });
    expect(mounted.props("session")).toEqual(session);
    await mounted.get("button").trigger("click");
    await flushPromises();
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(true);
    await wrapper.findAll('[role="alertdialog"] button')[0]!.trigger("click");
    await flushPromises();
    expect(wrapper.emitted("excel-bound")).toBeUndefined();
    await mounted.get("button").trigger("click");
    await wrapper.findAll('[role="alertdialog"] button')[1]!.trigger("click");
    await flushPromises();
    expect(wrapper.emitted("excel-bound")).toHaveLength(1);
    expect(wrapper.emitted("excel-bound")![0]![0]).toMatchObject({
      document: { id: "daily", name: "绑定" },
      session: { ...session, identity: { id: "daily", name: "绑定" } },
    });
    wrapper.unmount();
  });
  it("组件页首次页眉/页脚使用合理位置，字号兼容px导入且移除旧覆盖", async () => {
    const document = fixture(),
      component = document.template.pages[0]!.components[0]!;
    if (component.kind === "list") throw new Error("fixture");
    component.style = { fontSizePx: 16 };
    const wrapper = mount(ReportTemplateEditor, {
      props: { modelValue: document },
      global: { stubs: { ReportPreview: true } },
    });
    await tab(wrapper, "组件");
    const objects = wrapper
      .findAll("label")
      .find((label) => label.text().startsWith("组件目录"))!
      .get("select");
    await objects.setValue("0");
    await flushPromises();
    const labels = wrapper.findAll("label");
    const repeat = labels
      .find((label) => label.text().startsWith("每页重复"))!
      .get("select");
    await repeat.setValue("footer");
    let next = wrapper.emitted("update:modelValue")!.at(-1)![0] as ReturnType<
      typeof fixture
    >;
    const footer = next.template.pages[0]!.components[0]!;
    if (footer.kind === "list") throw new Error("fixture");
    expect(footer.topMm).toBe(
      next.template.pages[0]!.heightMm -
        (next.template.pages[0]!.marginBottomMm ?? 0) -
        footer.heightMm,
    );
    await repeat.setValue("header");
    next = wrapper.emitted("update:modelValue")!.at(-1)![0] as ReturnType<
      typeof fixture
    >;
    expect(next.template.pages[0]!.components[0]!.topMm).toBe(
      next.template.pages[0]!.marginTopMm ?? 0,
    );
    const size = wrapper
      .findAll("label")
      .find((label) => label.text().startsWith("字号"))!
      .get("input");
    expect(size.element.value).toBe("12");
    await size.setValue("15");
    next = wrapper.emitted("update:modelValue")!.at(-1)![0] as ReturnType<
      typeof fixture
    >;
    expect(next.template.pages[0]!.components[0]!).toMatchObject({
      style: { fontSize: 15 },
    });
    expect(
      "style" in next.template.pages[0]!.components[0]! &&
        next.template.pages[0]!.components[0]!.style?.fontSizePx,
    ).toBeUndefined();
    wrapper.unmount();
  });
  it("工具中的设计/预览切换回实际画布且保留已加载绑定会话", async () => {
    const wrapper = mount(ReportTemplateEditor, {
      props: { modelValue: fixture(), bindingSession: session },
      global: { stubs: { ReportPreview: true, ExcelBindingWizard: wizard } },
    });
    await tab(wrapper, "工具");
    const mounted = wrapper.getComponent({ name: "ExcelBindingWizard" });
    expect(wrapper.find(".mr-designer-preview").exists()).toBe(false);
    const preview = wrapper
      .findAll("button")
      .find((button) => button.text() === "预览")!;
    await preview.trigger("click");
    await flushPromises();
    expect(wrapper.find(".mr-designer-preview").exists()).toBe(true);
    expect(wrapper.find('[role="tab"][aria-selected="true"]').text()).toBe(
      "字段",
    );
    expect(mounted.element).toBeDefined();
    expect(wrapper.get(".mr-designer-tools").attributes("style")).toContain(
      "display: none",
    );
    await tab(wrapper, "工具");
    const design = wrapper
      .findAll("button")
      .find((button) => button.text() === "设计")!;
    await design.trigger("click");
    await flushPromises();
    expect(wrapper.find(".mr-canvas").exists()).toBe(true);
    expect(wrapper.find('[role="tab"][aria-selected="true"]').text()).toBe(
      "组件",
    );
    expect(mounted.props("session")).toEqual(session);
    wrapper.unmount();
  });

  it("真实绑定向导替换内容保留当前身份与修订，保存使用原CAS修订且事件会话一致", async () => {
    const document = { ...fixture(), revision: "5" };
    const save = vi.fn(
      async (
        candidate: ReportTemplateDocument,
        context: { expectedRevision?: string },
      ) => {
        expect(candidate.id).toBe("daily");
        expect(candidate.revision).toBe("5");
        expect(context.expectedRevision).toBe("5");
        return { ...candidate, revision: "6" };
      },
    );
    const wrapper = mount(ReportTemplateEditor, {
      props: {
        modelValue: document,
        bindingSession: session,
        bindingDatasets: [
          {
            id: "detail",
            rowKey: "heat",
            fields: [{ field: "heat", type: "text", label: "炉号" }],
          },
        ],
        save,
      },
      global: { stubs: { ReportPreview: true } },
    });
    await tab(wrapper, "工具");
    await vi.dynamicImportSettled();
    await flushPromises();
    const wizard = wrapper.getComponent({ name: "ExcelBindingWizard" });
    const id = wizard
      .findAll("label")
      .find((label) => label.text().startsWith("模板标识"))!
      .get("input");
    expect(id.element.value).toBe("daily");
    expect(id.attributes("readonly")).toBeDefined();
    const apply = wizard
      .findAll("button")
      .find((button) => button.text() === "校验并使用模板")!;
    expect(apply.attributes("disabled")).toBeUndefined();
    await apply.trigger("click");
    await flushPromises();
    const accepted = wrapper.emitted("excel-bound")![0]![0] as {
      document: typeof document;
      session: ExcelBindingSession;
    };
    expect(accepted.document).toMatchObject({ id: "daily", revision: "5" });
    expect(accepted.session.identity).toEqual({
      id: "daily",
      name: accepted.document.name,
    });
    expect(wrapper.emitted("update:modelValue")!.at(-1)![0]).toEqual(
      accepted.document,
    );
    const saveButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "保存草稿")!;
    await saveButton.trigger("click");
    await flushPromises();
    expect(save).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted("saved")![0]![0]).toMatchObject({
      id: "daily",
      revision: "6",
    });
    wrapper.unmount();
  });
});
