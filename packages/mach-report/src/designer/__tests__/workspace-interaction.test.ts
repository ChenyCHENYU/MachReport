import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import {
  createTableTemplate,
  defineReportTemplate,
  resolveGridLayout,
  paginateTemplate,
  createReportChartData,
  validateReportTemplateDocument,
  type ListComponent,
  type ReportTemplateDocument,
} from "../../index";
import ReportTemplateEditor from "../ReportTemplateEditor.vue";
import type { TemplateEditorController } from "../useTemplateEditor";
import { canvasComponentPlacement, placeCanvasComponent } from "../canvas-placement";
import { insertionChart, insertionColumn } from "../insertion-binding";
import {
  appendCanvasColumn,
  removeCanvasColumn,
  addCanvasHeaderRow,
  mergeCanvasHeader,
} from "../canvas-commands";

function document() {
  return defineReportTemplate({
    id: "workspace",
    name: "生产报表",
    revision: "1",
    template: createTableTemplate({
      layout: "wide",
      columns: [
        { header: "炉号", field: "heat" },
        { header: "重量", field: "weight", valueType: "number" },
      ],
    }),
  });
}
function editor() {
  return mount(ReportTemplateEditor, {
    attachTo: window.document.body,
    props: {
      modelValue: document(),
      dataSchemas: {
        detail: {
          fields: [
            {
              field: "heat",
              label: "炉号",
              type: "text",
              semanticRole: "identifier",
            },
            { field: "weight", label: "重量", type: "number" },
            { field: "energy", label: "电量", type: "number" },
          ],
        },
      },
    },
    global: { stubs: { ReportPreview: true } },
  });
}
function latest(wrapper: ReturnType<typeof editor>): ReportTemplateDocument {
  return wrapper
    .emitted("update:modelValue")!
    .at(-1)![0] as ReportTemplateDocument;
}
async function acceptNewPage(wrapper: ReturnType<typeof editor>): Promise<void> {
  const confirm = wrapper.find(".mr-insert-confirm-action");
  if (confirm.exists()) await confirm.trigger("click");
}
describe("连续设计操作", () => {
  it("动态明细避让完整数据和未来新增行，追加文字在独立版面保持原始数据", () => {
    const value = document();
    const rows = Array.from({ length: 30 }, (_, index) => ({ heat: `H${index}`, weight: index }));
    const placement = placeCanvasComponent(value, 0, {
      kind: "text", text: "生产说明", leftMm: 0, topMm: 0, widthMm: 60, heightMm: 10,
    });
    expect(placement.newPage).toBe(true);
    const plan = paginateTemplate(value.template, { detail: rows }).plan;
    const note = plan.pages.find(page => page.components.some(component => component.text === "生产说明"));
    expect(note).toBeDefined();
    expect(note!.components.every(component => !component.table)).toBe(true);
    expect(JSON.stringify(plan)).toContain("H29");
    expect(rows[29]).toEqual({ heat: "H29", weight: 29 });
  });
  it("新图表和字段复用真实契约，保留精确度量、单位与编号语义", () => {
    const schema = { rowKey: "id", fields: [
      { field: "heat", label: "炉号", type: "text" as const, semanticRole: "identifier" as const },
      { field: "weight", label: "重量", unit: "kg", type: "decimal" as const },
    ] };
    const binding = insertionChart(schema, "production", "记录数")!;
    expect(binding).toMatchObject({ categoryField: "heat", measures: [{ field: "weight", numeric: "decimal" }] });
    expect(createReportChartData([{ heat: "H1", weight: "42.125" }], binding).series[0]!.values).toEqual([42.125]);
    expect(insertionColumn(schema.fields[0]!, 28)).toMatchObject({ semanticRole: "identifier" });
    expect(insertionColumn(schema.fields[1]!, 28)).toMatchObject({ semanticRole: "measure", header: "重量 (kg)" });
    expect(insertionChart({ fields: [] }, "empty", "记录数")).toBeUndefined();
  });
  it("旧码图的fallbackText与预编码图片沿用既有输出契约", async () => {
    const value = document();
    value.template.pages[0]!.components.push({
      kind: "barcode", fallbackText: "0000418", leftMm: 0, topMm: 0, widthMm: 40, heightMm: 12,
    }, {
      kind: "qrcode", imageData: "data:image/png;base64,iVBORw0KGgo=", leftMm: 45, topMm: 0, widthMm: 12, heightMm: 12,
    });
    const wrapper = editor();
    await wrapper.setProps({ modelValue: value });
    await flushPromises();
    expect((wrapper.vm as unknown as TemplateEditorController).canApply).toBe(true);
    wrapper.unmount();
  });
  it("待配置图片暂停预览和所有保存入口，撤销插入后恢复原状态", async () => {
    const wrapper = editor();
    const save = vi.fn(async (value: ReportTemplateDocument) => value);
    await wrapper.setProps({ save });
    await wrapper.get(".mr-insert-trigger").trigger("click");
    await wrapper.findAll(".mr-insert-grid button")
      .find(button => button.text().startsWith("图片或 Logo"))!.trigger("click");
    await acceptNewPage(wrapper);
    const controller = wrapper.vm as unknown as TemplateEditorController;
    expect(controller.canApply).toBe(false);
    await controller.save();
    expect(save).not.toHaveBeenCalled();
    expect(controller.saveReason).toContain("图片或编码");
    controller.undo!();
    await flushPromises();
    expect(controller.canApply).toBe(true);
    wrapper.unmount();
  });
  it("统一添加入口从业务名称追加表格列，一次撤销后可重做，原始文档保持独立", async () => {
    const wrapper = editor();
    await wrapper.get(".mr-insert-trigger").trigger("click");
    (wrapper.get(".mr-insert-field").element as HTMLButtonElement).focus();
    await wrapper.get(".mr-insert-field").trigger("click");
    await flushPromises();
    expect(window.document.activeElement).toBe(wrapper.get(".mr-insert-panel input").element);
    await wrapper
      .findAll(".mr-insert-fields button")
      .find((button) => button.text().includes("电量"))!
      .trigger("click");
    const list = () =>
      latest(wrapper).template.pages[0]!.components.find(
        (component) => component.kind === "list",
      ) as ListComponent;
    expect(list().columns.at(-1)).toMatchObject({
      field: "energy",
      header: "电量",
    });
    expect(list().widthMm).toBe(
      list().columns.reduce((sum, column) => sum + column.widthMm, 0),
    );
    await wrapper.get('button[aria-label="撤销"]').trigger("click");
    expect(list().columns).toHaveLength(2);
    await wrapper.get('button[aria-label="重做"]').trigger("click");
    expect(list().columns).toHaveLength(3);
    expect(validateReportTemplateDocument(latest(wrapper)).ok).toBe(true);
    wrapper.unmount();
  });
  it("连续添加文字避开现有内容，输入控件保留原生撤销，画布快捷键撤销整次动作", async () => {
    const wrapper = editor();
    for (let index = 0; index < 2; index++) {
      await wrapper.get(".mr-insert-trigger").trigger("click");
      await wrapper
        .findAll(".mr-insert-grid button")
        .find((button) => button.text().startsWith("说明文字"))!
        .trigger("click");
      await acceptNewPage(wrapper);
    }
    const page = () => latest(wrapper).template.pages.at(-1)!;
    const added = page().components.slice(-2);
    expect(
      added[0]!.leftMm !== added[1]!.leftMm ||
        added[0]!.topMm !== added[1]!.topMm,
    ).toBe(true);
    const count = page().components.length;
    await wrapper
      .get("textarea")
      .trigger("keydown", { key: "z", ctrlKey: true });
    expect(page().components).toHaveLength(count);
    await wrapper.trigger("keydown", { key: "z", ctrlKey: true });
    expect(page().components).toHaveLength(
      count - 1,
    );
    wrapper.unmount();
  });
  it("受控设计模式直接显示画布，并按宿主能力隐藏无效工具", async () => {
    const wrapper = editor();
    await wrapper.setProps({
      mode: "design",
      showModeSwitch: false,
      capabilities: { params: false, advanced: false },
    });
    await flushPromises();
    expect(wrapper.find(".mr-designer-mode").exists()).toBe(false);
    expect(
      wrapper.find(".mr-design-canvas").exists() ||
        wrapper.find(".mr-canvas").exists(),
    ).toBe(true);
    expect(
      wrapper.findAll('[role="tab"]').some((tab) => tab.text() === "高级"),
    ).toBe(false);
    await wrapper
      .findAll('[role="tab"]')
      .find((tab) => tab.text() === "工具")!
      .trigger("click");
    expect(
      wrapper
        .findAll(".mr-designer-tool-tabs button")
        .some((button) => button.text().includes("查询参数")),
    ).toBe(false);
    wrapper.unmount();
  });
  it("字段增删保留多层合并表头与固定宽度，删除合并起点仍保持有效覆盖", () => {
    const value = document(),
      list = value.template.pages[0]!.components.find(
        (component) => component.kind === "list",
      ) as ListComponent;
    addCanvasHeaderRow(list);
    mergeCanvasHeader(list, 0, 0, 1);
    const width = list.widthMm;
    appendCanvasColumn(list, { header: "电量", field: "energy", widthMm: 28 });
    expect(list.widthMm).toBe(width);
    expect(
      resolveGridLayout(list.headerGrid!, width, 30).cells.find(
        (cell) => cell.ri === 0,
      )?.cell.colSpan,
    ).toBe(2);
    removeCanvasColumn(list, 0);
    expect(list.columns.map((column) => column.field)).toEqual([
      "weight",
      "energy",
    ]);
    expect(list.headerGrid!.colWidthsMm).toEqual(
      list.columns.map((column) => column.widthMm),
    );
    expect(validateReportTemplateDocument(value).ok).toBe(true);
  });

  it("preflights overflow without mutating the document and asks before adding a report page", async () => {
    const original = document();
    const snapshot = JSON.stringify(original);
    expect(canvasComponentPlacement(original.template.pages[0]!, {
      kind: "text", text: "说明", leftMm: 0, topMm: 0, widthMm: 60, heightMm: 10,
    }).newPage).toBe(true);
    expect(JSON.stringify(original)).toBe(snapshot);
    const wrapper = editor();
    const save = vi.fn(async (value: ReportTemplateDocument) => value);
    await wrapper.setProps({ save });
    await wrapper.get(".mr-insert-trigger").trigger("click");
    await wrapper.findAll(".mr-insert-grid button").find(button => button.text().startsWith("说明文字"))!.trigger("click");
    const confirmation = wrapper.get('.mr-insert-confirm [role="alertdialog"]');
    expect(confirmation.text()).toContain("模板版面 1 → 2");
    expect(confirmation.text()).toContain("最终输出页数由明细分页决定");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect((wrapper.vm as unknown as TemplateEditorController).canApply).toBe(false);
    expect((wrapper.vm as unknown as TemplateEditorController).blocked).toBe(true);
    await (wrapper.vm as unknown as TemplateEditorController).save();
    expect(save).not.toHaveBeenCalled();
    await confirmation.findAll("button").find(button => button.text() === "取消添加")!.trigger("click");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect((wrapper.vm as unknown as TemplateEditorController).canUndo).toBe(false);
    expect((wrapper.vm as unknown as TemplateEditorController).blocked).toBe(false);
    expect(window.document.activeElement).toBe(wrapper.get(".mr-insert-trigger").element);
    await wrapper.get(".mr-insert-trigger").trigger("click");
    await wrapper.findAll(".mr-insert-grid button").find(button => button.text().startsWith("说明文字"))!.trigger("click");
    await acceptNewPage(wrapper);
    expect(latest(wrapper).template.pages).toHaveLength(2);
    await wrapper.get('button[aria-label="撤销"]').trigger("click");
    expect(latest(wrapper).template.pages).toHaveLength(1);
    await wrapper.get('button[aria-label="重做"]').trigger("click");
    expect(latest(wrapper).template.pages).toHaveLength(2);
    wrapper.unmount();
  });

  it("cancels an uncommitted insertion when the host closes or resets the editor", async () => {
    const wrapper = editor();
    const controller = wrapper.vm as unknown as TemplateEditorController;
    async function requestText(): Promise<void> {
      await wrapper.get(".mr-insert-trigger").trigger("click");
      await wrapper.findAll(".mr-insert-grid button").find(button => button.text().startsWith("说明文字"))!.trigger("click");
      expect(wrapper.find(".mr-insert-confirm").exists()).toBe(true);
    }
    await requestText();
    expect(await controller.guardChanges()).toBe(true);
    await flushPromises();
    expect(wrapper.find(".mr-insert-confirm").exists()).toBe(false);
    await requestText();
    await controller.reset();
    await flushPromises();
    expect(wrapper.find(".mr-insert-confirm").exists()).toBe(false);
    expect(latest(wrapper)).toEqual(document());
    wrapper.unmount();
  });

  it("shows label face and total-output impacts, preserves physical size and cancels through Escape", async () => {
    const wrapper = editor();
    const labels = defineReportTemplate({ id: "labels", name: "标签", template: {
      repeat: { dataset: "records", copies: 2 },
      pages: [{ widthMm: 30, heightMm: 20, components: [{ kind: "rect", leftMm: 0, topMm: 0, widthMm: 30, heightMm: 20 }] }],
    } });
    await wrapper.setProps({ modelValue: labels, datasets: { records: [{ code: "A" }, { code: "B" }, { code: "C" }] } });
    const before = wrapper.emitted("update:modelValue")?.length ?? 0;
    await wrapper.get(".mr-insert-trigger").trigger("click");
    await wrapper.findAll(".mr-insert-grid button").find(button => button.text().startsWith("说明文字"))!.trigger("click");
    const confirmation = wrapper.get('.mr-insert-confirm [role="alertdialog"]');
    expect(confirmation.text()).toContain("30 × 20 mm");
    expect(confirmation.text()).toContain("每份标签 1 → 2 个版面");
    expect(confirmation.text()).toContain("按当前设计样本，标签数 6 → 12 张");
    expect(window.document.activeElement?.textContent).toBe("取消添加");
    await confirmation.trigger("keydown", { key: "Tab" });
    expect(window.document.activeElement?.textContent).toBe("新增版面并添加");
    await confirmation.trigger("keydown", { key: "Escape" });
    expect(wrapper.find(".mr-insert-confirm").exists()).toBe(false);
    expect(wrapper.emitted("update:modelValue")?.length ?? 0).toBe(before);
    await wrapper.get(".mr-insert-trigger").trigger("click");
    await wrapper.findAll(".mr-insert-grid button").find(button => button.text().startsWith("说明文字"))!.trigger("click");
    await acceptNewPage(wrapper);
    expect(latest(wrapper).template.pages.map(page => [page.widthMm, page.heightMm])).toEqual([[30, 20], [30, 20]]);
    wrapper.unmount();
  });

  it("keeps an oversized code unmodified and does not insert or shrink it", async () => {
    const wrapper = editor();
    await wrapper.setProps({ modelValue: defineReportTemplate({ id: "small", name: "小标签", template: {
      pages: [{ widthMm: 15, heightMm: 15, components: [] }],
    } }) });
    const before = wrapper.emitted("update:modelValue")?.length ?? 0;
    await wrapper.get(".mr-insert-trigger").trigger("click");
    await wrapper.findAll(".mr-insert-grid button").find(button => button.text().startsWith("二维码"))!.trigger("click");
    expect(wrapper.get(".mr-designer-insert-notice").text()).toContain("内容尺寸大于当前纸张");
    expect(wrapper.find(".mr-insert-confirm").exists()).toBe(false);
    expect(wrapper.emitted("update:modelValue")?.length ?? 0).toBe(before);
    wrapper.unmount();
  });
});
