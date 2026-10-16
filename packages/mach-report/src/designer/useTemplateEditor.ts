import { computed, onBeforeUnmount, ref, watch } from "vue";
import { parseReportTemplate, resolveGridLayout, serializeReportTemplate, validateReportTemplateDocument, type DatasetRows, type ListComponent, type ReportTemplateDocument } from "@agile-team/mach-report";
import { createLocalFetcher, provideMachReportConfig, type MachReportDefaults } from "@agile-team/mach-report/vue";
import { TEMPLATE_EDITOR_MESSAGES, type TemplateEditorMessages } from "./messages";

export interface TemplateEditorSaveContext { expectedRevision?: string; signal: AbortSignal }
export interface TemplateEditorOptions {
  modelValue: ReportTemplateDocument;
  datasets?: DatasetRows;
  readonly?: boolean;
  messages?: Partial<TemplateEditorMessages>;
  preview?: Pick<MachReportDefaults, "showExport" | "showPrint" | "showPdfWindow" | "theme" | "assets" | "pdfFontUrl" | "toolbar">;
  save?: (document: ReportTemplateDocument, context: TemplateEditorSaveContext) => Promise<ReportTemplateDocument>;
}

/** 属性面板与保存状态独立于预览；服务端修订冲突必须保持草稿，不能覆盖为旧值。 */
export function useTemplateEditor(props: TemplateEditorOptions, emit: (event: "update:modelValue" | "saved", document: ReportTemplateDocument) => void) {
  const draft = ref(parseReportTemplate(props.modelValue));
  const original = ref(serializeReportTemplate(draft.value));
  const selected = ref(0);
  const json = ref(serializeReportTemplate(draft.value));
  const error = ref("");
  const saving = ref(false);
  const messages = computed(() => ({ ...TEMPLATE_EDITOR_MESSAGES, ...props.messages }));
  const previewOptions = computed(() => ({
    showExport: false, showPrint: false, showPdfWindow: false, ...props.preview,
    theme: {
      shellBg: "#f1f5f9", shellFg: "#334155", toolbarBg: "#ffffff", toolbarBorder: "#e2e8f0", toolbarFg: "#334155",
      btnFg: "#475569", btnBorder: "#cbd5e1", btnHoverBg: "#eff6ff", btnHoverFg: "#1d4ed8", btnActiveBg: "#2563eb", ...props.preview?.theme
    }
  }));
  provideMachReportConfig({ get defaults() { return previewOptions.value; } });
  let controller: AbortController | undefined;
  let generation = 0;
  const validation = computed(() => validateReportTemplateDocument(draft.value));
  const dirty = computed(() => {
    try { return serializeReportTemplate(draft.value) !== original.value; }
    catch { return true; }
  });
  const lists = computed(() => draft.value.template.pages.flatMap((page, pageIndex) => page.components.flatMap((component, componentIndex) => component.kind === "list" ? [{ component, pageIndex, componentIndex }] : [])));
  const activeList = computed<ListComponent | undefined>(() => lists.value[selected.value]?.component);
  const headerAlignments = computed(() => {
    const list = activeList.value;
    if (!list) return [];
    // 与分页器一致：正文列样式参与表头基样式，随后按列表、列的表头配置覆盖。
    const styles = list.columns.map((column) => column.headerStyle?.align ?? column.headerAlign ?? list.headerStyle?.align ?? list.headerAlign ?? column.style?.align ?? "center");
    if (list.headerGrid && validation.value.ok) {
      for (const box of resolveGridLayout(list.headerGrid, list.widthMm, 100).cells) {
        for (let index = box.ci; index < box.ci + (box.cell.colSpan ?? 1); index++) styles[index] = box.cell.style?.align ?? "left";
      }
    }
    return styles;
  });
  // 属性编辑仅预览显式提供的数据，不触发业务查询；模板的参数定义仍完整保存在文档中。
  const fetcher = computed(() => validation.value.ok ? createLocalFetcher({ draft: { template: draft.value.template, datasets: props.datasets ?? {}, params: [] } }) : undefined);

  function cancelSave(): void { generation++; controller?.abort(); controller = undefined; saving.value = false; }
  watch(() => props.modelValue, (value) => {
    const document = parseReportTemplate(value);
    // v-model 回显不是服务器的新版本，不能清除尚未保存的草稿状态。
    try { if (serializeReportTemplate(document) === serializeReportTemplate(draft.value)) return; }
    catch { /* 当前无效草稿可被显式外部文档替换。 */ }
    cancelSave(); draft.value = document; original.value = serializeReportTemplate(document);
    json.value = original.value; error.value = ""; selected.value = 0;
  });
  onBeforeUnmount(cancelSave);

  function changed(): void {
    error.value = "";
    if (validation.value.ok) {
      json.value = serializeReportTemplate(draft.value);
      emit("update:modelValue", parseReportTemplate(draft.value));
    }
  }
  function setName(value: string): void { if (props.readonly || saving.value) return; draft.value.name = value; changed(); }
  function setDescription(value: string): void { if (props.readonly || saving.value) return; draft.value.description = value; changed(); }
  function setColumn(index: number, key: "header" | "field" | "widthMm" | "align" | "headerAlign" | "semanticRole" | "editable", value: string | boolean): void {
    if (props.readonly || saving.value) return;
    const column = activeList.value?.columns[index];
    if (!column) return;
    Object.assign(column, { [key]: key === "widthMm" ? Number(value) : value });
    if (key === "header") updateMergedHeader(index, String(value));
    if (key === "headerAlign") updateMergedHeaderAlignment(index, value as "left" | "center" | "right" | "justify");
    if (key === "widthMm") updateWidths();
    changed();
  }
  function updateWidths(): void {
    const target = lists.value[selected.value];
    if (!target) return;
    const list = target.component, page = draft.value.template.pages[target.pageIndex]!;
    const widths = list.columns.map((column) => column.widthMm);
    if (list.headerGrid) list.headerGrid.colWidthsMm = widths;
    if (page.layout === "wide" && widths.every((width) => Number.isFinite(width) && width > 0)) {
      list.widthMm = widths.reduce((sum, width) => sum + width, 0);
      page.widthMm = Math.max(...page.components.map((component) => component.leftMm + component.widthMm)) + (page.marginRightMm ?? 0);
    }
  }
  function updateMergedHeader(index: number, text: string): void {
    const list = activeList.value;
    if (!list?.headerGrid) return;
    const boxes = resolveGridLayout(list.headerGrid, list.widthMm, 100).cells;
    const box = boxes.filter(({ ci, cell }) => ci <= index && ci + (cell.colSpan ?? 1) > index).slice(-1)[0];
    if (!box) return;
    Object.assign(box.cell, { text, rawText: text, value: text });
    list.columns.slice(box.ci, box.ci + (box.cell.colSpan ?? 1)).forEach((item) => { item.header = text; });
  }
  function updateMergedHeaderAlignment(index: number, align: "left" | "center" | "right" | "justify"): void {
    const list = activeList.value;
    const column = list?.columns[index];
    if (column?.headerStyle?.align !== undefined) column.headerStyle = { ...column.headerStyle, align };
    if (!list?.headerGrid) return;
    const boxes = resolveGridLayout(list.headerGrid, list.widthMm, 100).cells;
    const box = boxes.filter(({ ci, cell }) => ci <= index && ci + (cell.colSpan ?? 1) > index).slice(-1)[0];
    if (!box) return;
    box.cell.style = { ...box.cell.style, align };
    list.columns.slice(box.ci, box.ci + (box.cell.colSpan ?? 1)).forEach((item) => {
      item.headerAlign = align;
      if (item.headerStyle?.align !== undefined) item.headerStyle = { ...item.headerStyle, align };
    });
  }
  function applyJson(): void {
    if (props.readonly || saving.value) return;
    try {
      const document = parseReportTemplate(json.value);
      if (document.id !== draft.value.id) throw new Error("属性编辑不允许更换模板 ID，请另存为新模板");
      if (document.revision !== draft.value.revision) throw new Error("修订号由保存服务管理，不能在 JSON 中修改");
      draft.value = document; selected.value = 0; changed();
    } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
  }
  function reset(): void {
    if (saving.value || props.readonly) return;
    draft.value = parseReportTemplate(original.value); json.value = original.value; error.value = "";
    emit("update:modelValue", parseReportTemplate(draft.value));
  }
  async function save(): Promise<void> {
    if (!props.save || props.readonly || saving.value || !validation.value.ok) return;
    const job = ++generation;
    controller = new AbortController(); saving.value = true; error.value = "";
    const document = parseReportTemplate(draft.value);
    try {
      const saved = parseReportTemplate(await props.save(document, { expectedRevision: document.revision, signal: controller.signal }));
      if (job !== generation) return;
      if (saved.id !== document.id) throw new Error("保存服务返回了其他模板的文档");
      draft.value = saved; original.value = serializeReportTemplate(saved); json.value = original.value;
      emit("saved", parseReportTemplate(saved)); emit("update:modelValue", parseReportTemplate(saved));
    } catch (cause) {
      if (job === generation) error.value = cause instanceof Error ? cause.message : String(cause);
    } finally { if (job === generation) { saving.value = false; controller = undefined; } }
  }
  return { draft, json, selected, error, saving, dirty, validation, lists, activeList, headerAlignments, previewOptions, fetcher, messages, setName, setDescription, setColumn, applyJson, reset, save };
}
