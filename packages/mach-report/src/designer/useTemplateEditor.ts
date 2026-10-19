import { computed, onBeforeUnmount, ref, watch } from "vue";
import { parseReportTemplate, serializeReportTemplate, validateReportTemplateDocument, type DatasetRows, type ReportTemplateDocument } from "@agile-team/mach-report";
import { createLocalFetcher, provideMachReportConfig, type MachReportDefaults } from "@agile-team/mach-report/vue";
import { useTemplateColumns } from "./useTemplateColumns";
import { useTemplateHistory } from "./useTemplateHistory";
import { useTemplateDiscard, type TemplateEditorBeforeDiscard, type TemplateEditorBeforeDiscardContext } from "./useTemplateDiscard";
import { TEMPLATE_EDITOR_MESSAGES, type TemplateEditorMessages } from "./messages";

export interface TemplateEditorSaveContext { expectedRevision?: string; signal: AbortSignal }
export interface TemplateEditorController {
  readonly pendingLocalChanges: boolean;
  readonly saving?: boolean;
  readonly blocked?: boolean;
  guardChanges(reason?: TemplateEditorBeforeDiscardContext["reason"], replacement?: ReportTemplateDocument): Promise<boolean>;
  reset(): Promise<void>;
  save(): Promise<void>;
}
export interface TemplateEditorOptions {
  modelValue: ReportTemplateDocument;
  datasets?: DatasetRows;
  readonly?: boolean;
  messages?: Partial<TemplateEditorMessages>;
  preview?: Pick<MachReportDefaults, "showExport" | "showPrint" | "showPdfWindow" | "theme" | "assets" | "pdfFontUrl" | "toolbar">;
  beforeDiscard?: TemplateEditorBeforeDiscard;
  save?: (document: ReportTemplateDocument, context: TemplateEditorSaveContext) => Promise<ReportTemplateDocument>;
}

/** 属性面板与保存状态独立于预览；服务端修订冲突必须保持草稿，不能覆盖为旧值。 */
export function useTemplateEditor(props: TemplateEditorOptions, emit: (event: "update:modelValue" | "saved", document: ReportTemplateDocument) => void) {
  const draft = ref(parseReportTemplate(props.modelValue));
  const original = ref(serializeReportTemplate(draft.value));
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
  const appliedJson = ref(json.value);
  const jsonPending = computed(() => json.value !== appliedJson.value);
  const pendingLocalChanges = computed(() => dirty.value || json.value !== appliedJson.value);
  const snapshot = () => JSON.stringify({ document: draft.value, json: json.value, appliedJson: appliedJson.value });
  const history = useTemplateHistory(snapshot());
  const discard = useTemplateDiscard(() => props.beforeDiscard);
  const blocked = computed(() => saving.value || discard.pending.value);
  const canEdit = () => !props.readonly && !blocked.value && !jsonPending.value;
  const columns = useTemplateColumns(draft, () => validation.value.ok, canEdit, changed);
  const { selected, lists, activeList, headerAlignments, setColumn } = columns;
  watch(selected, () => columns.clearSelection());
  // 属性编辑仅预览显式提供的数据，不触发业务查询；模板的参数定义仍完整保存在文档中。
  const fetcher = computed(() => validation.value.ok ? createLocalFetcher({ draft: { template: draft.value.template, datasets: props.datasets ?? {}, params: [] } }) : undefined);

  function cancelSave(): void { generation++; controller?.abort(); controller = undefined; saving.value = false; }
  let replacementGeneration = 0;
  async function guardChanges(reason: TemplateEditorBeforeDiscardContext["reason"] = "replace", replacement?: ReportTemplateDocument): Promise<boolean> {
    if (!pendingLocalChanges.value) return true;
    const before = snapshot();
    try {
      const allowed = await discard.request({ reason, document: JSON.parse(JSON.stringify(draft.value)) as ReportTemplateDocument,
        replacement: replacement ? parseReportTemplate(replacement) : undefined, pendingLocalChanges: true });
      return allowed && before === snapshot();
    } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); return false; }
  }
  function load(document: ReportTemplateDocument): void {
    cancelSave(); draft.value = document; original.value = serializeReportTemplate(document);
    json.value = original.value; appliedJson.value = json.value; error.value = ""; selected.value = 0; columns.clearSelection();
    history.reset(snapshot());
  }
  watch(() => props.modelValue, async (value) => {
    let document: ReportTemplateDocument;
    try { document = parseReportTemplate(value); }
    catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); return; }
    // v-model echoes retain the baseline and cannot clear an unapplied JSON draft.
    try { if (serializeReportTemplate(document) === serializeReportTemplate(draft.value)) return; }
    catch { /* Invalid local fields remain guarded. */ }
    const job = ++replacementGeneration;
    cancelSave();
    if (!await guardChanges("replace", document)) {
      if (job === replacementGeneration && validation.value.ok) emit("update:modelValue", parseReportTemplate(draft.value));
      return;
    }
    if (job === replacementGeneration) load(document);
  });
  onBeforeUnmount(() => { replacementGeneration++; cancelSave(); });

  function changed(): void {
    discard.cancel();
    error.value = "";
    if (validation.value.ok) {
      json.value = serializeReportTemplate(draft.value); appliedJson.value = json.value;
      emit("update:modelValue", parseReportTemplate(draft.value));
    }
    history.record(snapshot());
  }
  function setName(value: string): void { if (!canEdit()) return; draft.value.name = value; changed(); }
  function setDescription(value: string): void { if (!canEdit()) return; draft.value.description = value; changed(); }
  function applyJson(): void {
    if (props.readonly || blocked.value) return;
    try {
      const document = parseReportTemplate(json.value);
      if (document.id !== draft.value.id) throw new Error("属性编辑不允许更换模板 ID，请另存为新模板");
      if (document.revision !== draft.value.revision) throw new Error("修订号由保存服务管理，不能在 JSON 中修改");
      draft.value = document; selected.value = 0; columns.clearSelection(); changed();
    } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
  }
  async function reset(): Promise<void> {
    if (blocked.value || props.readonly || !await guardChanges("reset")) return;
    load(parseReportTemplate(original.value));
    emit("update:modelValue", parseReportTemplate(draft.value));
  }
  function moveHistory(delta: -1 | 1): void {
    if (blocked.value || props.readonly) return;
    // A new JSON edit after undo starts a fresh history branch.
    history.record(snapshot());
    const frame = history.move(delta);
    if (!frame) return;
    discard.cancel();
    const restored = JSON.parse(frame) as { document: ReportTemplateDocument; json: string; appliedJson: string };
    draft.value = restored.document; json.value = restored.json; appliedJson.value = restored.appliedJson; error.value = "";
    selected.value = 0; columns.clearSelection();
    if (validation.value.ok) emit("update:modelValue", parseReportTemplate(draft.value));
  }
  async function save(): Promise<void> {
    if (!props.save || !canEdit() || !validation.value.ok) return;
    const job = ++generation;
    controller = new AbortController(); saving.value = true; error.value = "";
    const document = parseReportTemplate(draft.value);
    try {
      const saved = parseReportTemplate(await props.save(document, { expectedRevision: document.revision, signal: controller.signal }));
      if (job !== generation) return;
      if (saved.id !== document.id) throw new Error("保存服务返回了其他模板的文档");
      draft.value = saved; original.value = serializeReportTemplate(saved); json.value = original.value; appliedJson.value = json.value;
      history.reset(snapshot());
      emit("saved", parseReportTemplate(saved)); emit("update:modelValue", parseReportTemplate(saved));
    } catch (cause) {
      if (job === generation) error.value = cause instanceof Error ? cause.message : String(cause);
    } finally { if (job === generation) { saving.value = false; controller = undefined; } }
  }
  const canUndo = computed(() => history.canUndo.value || snapshot() !== history.current.value);
  const canRedo = computed(() => history.canRedo.value && snapshot() === history.current.value);
  return { ...columns, canUndo, canRedo, undo: () => moveHistory(-1), redo: () => moveHistory(1), pendingLocalChanges, jsonPending, blocked, confirmation: discard.confirmation, decideDiscard: discard.decide, guardChanges, draft, json, selected, error, saving, dirty, validation, lists, activeList, headerAlignments, previewOptions, fetcher, messages, setName, setDescription, setColumn, applyJson, reset, save };
}
