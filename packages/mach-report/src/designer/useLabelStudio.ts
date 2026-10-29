import { computed, ref, shallowRef, watch, onMounted, onScopeDispose } from "vue";
import { createReportSource, defineLabelReport, imposeLabelSheets, parseReportTemplate, serializeReportTemplate, type DatasetContract, type LabelReportRows, type ReportTemplateDocument } from "@agile-team/mach-report";
import { createCodeAssetRenderers } from "@agile-team/mach-report/codes";
import { provideMachReportConfig } from "@agile-team/mach-report/vue";
import type { TemplateEditorController, TemplateEditorOptions } from "./useTemplateEditor";
import { createLabelStudioDocument } from "./label-studio-template";
import { LABEL_STUDIO_MESSAGES, type LabelStudioMessages } from "./label-studio-messages";

export interface LabelStudioOptions {
  rows: LabelReportRows;
  schema: DatasetContract;
  title?: string;
  identityField?: string;
  modelValue?: ReportTemplateDocument;
  preview?: TemplateEditorOptions["preview"];
  save?: TemplateEditorOptions["save"];
  beforeDiscard?: TemplateEditorOptions["beforeDiscard"];
  messages?: Partial<LabelStudioMessages>;
}
export interface LabelStudioController { readonly busy?: boolean; guardChanges(): Promise<boolean>; prepare(): Promise<ReportTemplateDocument | undefined> }
/** One controlled document and one query snapshot; no extra fetch, business save or copied dataset. */
export function useLabelStudio(props: LabelStudioOptions, emit: (document: ReportTemplateDocument) => void) {
  const m = computed(() => ({ ...LABEL_STUDIO_MESSAGES, ...props.messages }));
  const title = computed(() => props.title ?? m.value.title);
  const document = shallowRef(props.modelValue ? parseReportTemplate(props.modelValue) : createLabelStudioDocument(props.schema, title.value, props.identityField));
  let savedDocument = parseReportTemplate(document.value);
  onMounted(() => { if (!props.modelValue) emit(parseReportTemplate(document.value)); });
  const mode = ref<"preview" | "design">("preview"), record = ref("all"), recordIndex = ref(1), sheet = ref(false), busy = ref(false);
  const editor = ref<TemplateEditorController>();
  const notice = ref("");
  let disposed = false;
  onScopeDispose(() => { disposed = true; });
  const assets = { assetRenderers: createCodeAssetRenderers() };
  provideMachReportConfig({ get defaults() { return { assets, ...props.preview }; } });
  watch(() => props.modelValue, value => {
    if (value && serializeReportTemplate(value) !== serializeReportTemplate(document.value)) { document.value = parseReportTemplate(value); savedDocument = parseReportTemplate(value); }
  });
  watch(() => props.rows, () => { record.value = "all"; recordIndex.value = 1; });
  function update(value: ReportTemplateDocument): void { notice.value = ""; document.value = value; emit(value); }
  const rows = computed(() => record.value === "all" ? props.rows : Number.isSafeInteger(recordIndex.value) && props.rows[recordIndex.value - 1] ? [props.rows[recordIndex.value - 1]!] : []);
  const dataset = computed(() => document.value.template.repeat?.dataset ?? "records");
  const datasets = computed(() => ({ [dataset.value]: rows.value as Record<string, unknown>[] }));
  const schemas = computed(() => ({ [dataset.value]: props.schema }));
  const bindings = computed(() => [{ id: dataset.value, label: title.value, rowKey: props.schema.rowKey, fields: props.schema.fields }]);
  const paper = computed(() => document.value.template.pages[0]);
  const labelCount = computed(() => {
    const copies = document.value.template.repeat?.copies ?? 1;
    let total = 0;
    for (const row of rows.value) {
      const value = typeof copies === "number" ? copies : Object.getOwnPropertyDescriptor(row, copies.field)?.value;
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 1000) return undefined;
      total += value * document.value.template.pages.length;
    }
    return total;
  });
  const fetcher = computed(() => {
    const source = createReportSource({ labels: defineLabelReport({ template: document.value.template, rows: rows.value, dataSchema: props.schema }) });
    const imposed = sheet.value;
    return async (input: Parameters<typeof source>[0]) => {
      const plan = await source(input);
      return imposed ? imposeLabelSheets(plan, { paper: "a4", columns: 2, rows: 4, marginMm: 12, gapMm: 4, signal: input.signal }) : plan;
    };
  });
  const save: NonNullable<TemplateEditorOptions["save"]> = async (draft, context) => {
    const saved = props.save ? await props.save(draft, context) : parseReportTemplate(draft);
    if (disposed || context.signal.aborted) throw new DOMException("标签模板保存已取消", "AbortError");
    savedDocument = parseReportTemplate(saved); update(saved); return saved;
  };
  async function prepare(): Promise<ReportTemplateDocument | undefined> {
    if (busy.value || disposed) return;
    busy.value = true;
    try {
      if (mode.value === "design" && editor.value) {
        if (editor.value.canApply === false) { notice.value = editor.value.saveReason || m.value.applyFirst; return; }
        if (editor.value.pendingLocalChanges) await editor.value.save();
        if (editor.value.pendingLocalChanges) { notice.value = m.value.saveFailed; return; }
      }
      if (!disposed) { notice.value = ""; return parseReportTemplate(document.value); }
    } finally { busy.value = false; }
  }
  async function navigate(next: "preview" | "design"): Promise<void> {
    if (next !== mode.value && await prepare()) mode.value = next;
  }
  async function guardChanges(): Promise<boolean> {
    if (busy.value) return false;
    const pending = editor.value?.pendingLocalChanges;
    if (editor.value && !await editor.value.guardChanges()) return false;
    if (pending) update(parseReportTemplate(savedDocument));
    return true;
  }
  return { m, notice, title, document, mode, record, recordIndex, sheet, busy, editor, rows, dataset, datasets, schemas, bindings, paper, labelCount, fetcher, update, save, navigate, prepare, guardChanges };
}
