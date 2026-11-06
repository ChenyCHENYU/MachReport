import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { provideTemplateToolDrafts } from "./useTemplateToolDrafts";
import type { ColumnVisualMessages } from "./column-visual-messages";
import { useTemplateDraftRecovery } from "./useTemplateDraftRecovery";
import { useTemplateConflict, type TemplateEditorConflictOptions } from "./useTemplateConflict";
import type { ReportTemplateFragment, ReportDocumentStyle } from "../source/template-fragments";
import type { TemplateDraftStorage } from "./draft-storage";
import type { TemplateProductMessages } from "./product-messages";
import type { TemplateReviewMessages } from "./review-messages";
import type { TemplateRecoveryMessages } from "./recovery-messages";
import {
  parseReportTemplate,
  ReportTemplateError,
  serializeReportTemplate,
  validateReportTemplateDocument,
  type DatasetRows,
  type DatasetContract,
  type ReportTemplateFixture,
  type ReportTemplateDocument,
} from "@agile-team/mach-report";
import {
  createLocalFetcher,
  provideMachReportConfig,
  type MachReportDefaults,
} from "@agile-team/mach-report/vue";
import { useTemplateColumns } from "./useTemplateColumns";
import { copyTemplateDocumentSnapshot, useTemplateDocumentSnapshot } from "./template-document-snapshot";
import { stringifyValidatedTemplate } from "../source/template-serialization";
import { useTemplateHistory, type TemplateHistoryContext } from "./useTemplateHistory";
import { restoreTemplateHistoryDocument, serializeTemplateHistory, type TemplateHistoryState } from "./template-history-state";
import {
  useTemplateDiscard,
  type TemplateEditorBeforeDiscard,
  type TemplateEditorBeforeDiscardContext,
} from "./useTemplateDiscard";
import type {
  ExcelBindingDataset,
} from "../xlsx/binding-workflow";
import type { AnyExcelBindingSession } from "../xlsx/region-binding-workflow";
import {
  TEMPLATE_EDITOR_MESSAGES,
  type TemplateEditorMessages,
} from "./messages";

export interface TemplateEditorSaveContext {
  expectedRevision?: string;
  signal: AbortSignal;
}
export type TemplateEditorPanel = "fields" | "components" | "layout" | "excel" | "rules" | "params" | "review";
export interface TemplateEditorController {
  /** Open a task through the package navigation, without reaching into child DOM. */
  openPanel?(target: TemplateEditorPanel): void;
  /** Insert a native/registered component through validation, geometry constraints and undo history. */
  insertComponent(component: import("@agile-team/mach-report").TemplateComponent): boolean;
  applyTemplate?(template: import("@agile-team/mach-report").ReportTemplate): boolean;
  undo?(): void;
  redo?(): void;
  readonly canUndo?: boolean;
  readonly canRedo?: boolean;
  readonly canApply?: boolean;
  readonly saveReason?: string;
  readonly pendingLocalChanges: boolean;
  readonly saving?: boolean;
  readonly blocked?: boolean;
  guardChanges(
    reason?: TemplateEditorBeforeDiscardContext["reason"],
    replacement?: ReportTemplateDocument,
  ): Promise<boolean>;
  reset(): Promise<void>;
  save(): Promise<void>;
}
export interface TemplateEditorOptions extends TemplateEditorConflictOptions {
  /** Hide the duplicate save action when the host already provides an apply/save footer. */
  showSave?: boolean;
  /** Host-controlled view for an editor embedded inside a studio. */
  mode?: "design" | "preview";
  showModeSwitch?: boolean;
  capabilities?: Partial<Record<"params" | "excel" | "rules" | "review" | "advanced" | "outline" | "reuse", boolean>>;
  insertionMessages?: Partial<import("./insertion-messages").DesignerInsertMessages>;
  guideMessages?: Partial<import("./guide-messages").DesignerGuideMessages>;
  /** Opt-in declaration-only recovery. Scope should include project and account identity. */
  draftStorage?: TemplateDraftStorage;
  recoveryMessages?: Partial<TemplateRecoveryMessages>;
  productMessages?: Partial<TemplateProductMessages>;
  reviewMessages?: Partial<TemplateReviewMessages>;
  fragments?: ReportTemplateFragment[];
  documentStyles?: ReportDocumentStyle[];
  reviewFixtures?: ReportTemplateFixture[];
  modelValue: ReportTemplateDocument;
  datasets?: DatasetRows;
  dataSchemas?: Record<string, DatasetContract>;
  bindingDatasets?: ExcelBindingDataset[];
  /** Adopt the host's declared field meaning only after an explicit Excel binding is accepted. */
  bindingDataContract?: ReportTemplateDocument["template"]["dataContract"];
  /** Optional independently persisted Excel source and binding recipe. */
  bindingSession?: AnyExcelBindingSession;
  readonly?: boolean;
  messages?: Partial<TemplateEditorMessages>;
  visualMessages?: Partial<ColumnVisualMessages>;
  preview?: Pick<
    MachReportDefaults,
    | "showExport"
    | "showPrint"
    | "showPdfWindow"
    | "theme"
    | "assets"
    | "pdfFontUrl"
    | "toolbar"
    | "loadParamOptions"
  >;
  beforeDiscard?: TemplateEditorBeforeDiscard;
  save?: (
    document: ReportTemplateDocument,
    context: TemplateEditorSaveContext,
  ) => Promise<ReportTemplateDocument>;
}

/** 属性面板与保存状态独立于预览；服务端修订冲突必须保持草稿，不能覆盖为旧值。 */
export function useTemplateEditor(
  props: TemplateEditorOptions,
  emit: (
    event: "update:modelValue" | "saved",
    document: ReportTemplateDocument,
  ) => void,
) {
  const draft = ref(parseReportTemplate(props.modelValue));
  const documentSnapshot = useTemplateDocumentSnapshot(draft);
  const copyDraft = () => copyTemplateDocumentSnapshot(documentSnapshot.value);
  const initialJson = documentSnapshot.value.json;
  if (initialJson === undefined) throw new ReportTemplateError(documentSnapshot.value.validation.errors);
  const original = ref(initialJson);
  const json = ref(original.value);
  const error = ref("");
  const saving = ref(false);
  const messages = computed(() => ({
    ...TEMPLATE_EDITOR_MESSAGES,
    ...props.messages,
  }));
  const previewOptions = computed(() => ({
    showExport: false,
    showPrint: false,
    showPdfWindow: false,
    ...props.preview,
  }));
  provideMachReportConfig({
    get defaults() {
      return previewOptions.value;
    },
  });
  let controller: AbortController | undefined;
  let generation = 0;
  const validation = computed(() => documentSnapshot.value.validation);
  const dirty = computed(() => documentSnapshot.value.json !== original.value);
  const appliedJson = ref(json.value);
  const jsonPending = computed(() => json.value !== appliedJson.value);
  const localDrafts = ref<Record<string, boolean>>({});
  const localRevision = ref(0);
  const toolEpoch = ref(0);
  const toolPending = computed(() => Object.values(localDrafts.value).some(Boolean));
  const pendingTools = computed(() => Object.keys(localDrafts.value).filter(tool => localDrafts.value[tool]));
  function setToolPending(tool: string, pending: boolean): void {
    localDrafts.value = { ...localDrafts.value, [tool]: pending }; localRevision.value++;
  }
  let restoringHistory = false;
  let documentFramePending = false;
  let jsonHistoryRevision: { revision?: string } | undefined;
  const toolDrafts = provideTemplateToolDrafts(setToolPending, () => {
    if (restoringHistory) return;
    if (documentFramePending) history.amend(snapshot(), historyView?.read());
    else history.record(snapshot(), historyView?.read());
  });
  const pendingLocalChanges = computed(
    () => dirty.value || json.value !== appliedJson.value || toolPending.value || !!columns.fieldChange.value,
  );
  // A validated plain copy avoids walking Vue proxies again for history. Invalid
  // local input still uses the raw draft so undo can restore the unfinished edit.
  const historyDocument = computed(() => documentSnapshot.value.json === undefined ? draft.value : copyDraft());
  const historySnapshot = computed(() => serializeTemplateHistory(historyDocument.value, toolDrafts.records.value,
    jsonPending.value ? { text: json.value, revision: jsonHistoryRevision ? jsonHistoryRevision.revision : draft.value.revision } : undefined));
  const snapshot = () => historySnapshot.value;
  const history = useTemplateHistory(snapshot());
  const historyViewRevision = ref(0);
  let historyView: { read: () => TemplateHistoryContext; restore: (context: TemplateHistoryContext) => void } | undefined;
  function connectHistoryView(view: NonNullable<typeof historyView>): void {
    historyView = view;
    history.annotate(view.read());
  }
  function captureHistoryView(): void { history.annotate(historyView?.read()); }
  const discard = useTemplateDiscard(() => props.beforeDiscard);
  const blocked = computed(() => saving.value || discard.pending.value || conflict.active.value || recovery.checking.value || !!recovery.available.value);
  const canEdit = () => !props.readonly && !blocked.value && !jsonPending.value;
  const columns = useTemplateColumns(
    draft,
    () => validation.value.ok,
    canEdit,
    changed,
  );
  const { selected, lists, activeList, headerAlignments, setColumn } = columns;
  watch(selected, () => columns.clearSelection());
  // 属性编辑仅预览显式提供的数据，不触发业务查询；模板的参数定义仍完整保存在文档中。
  // Document metadata does not change the report. Keep its fetcher identity stable
  // while editing a name/description; only layout/data changes invalidate preview.
  const previewFetcher = shallowRef<ReturnType<typeof createLocalFetcher>>();
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  let changeGroup: string | undefined;
  let previewGroup: string | undefined;
  function refreshPreview(): void {
    clearTimeout(previewTimer);
    previewTimer = undefined;
    previewFetcher.value = createLocalFetcher({ draft: {
      get template() { return draft.value.template; },
      get datasets() { return props.datasets ?? {}; }, params: [],
    } });
  }
  watch(() => draft.value.template, () => {
    clearTimeout(previewTimer);
    const sameTextEdit = changeGroup && previewGroup === changeGroup;
    if (sameTextEdit) previewTimer = setTimeout(refreshPreview, 150);
    else refreshPreview();
    previewGroup = changeGroup;
  }, { deep: true, immediate: true });
  // Dataset changes retain deep/in-place support, without rescanning all source
  // rows for every template keystroke.
  watch(() => props.datasets, () => { previewGroup = undefined; refreshPreview(); }, { deep: true });
  const fetcher = computed(() => validation.value.ok ? previewFetcher.value : undefined);

  function cancelSave(): void {
    generation++;
    controller?.abort();
    controller = undefined;
    saving.value = false;
  }
  let replacementGeneration = 0;
  async function guardChanges(
    reason: TemplateEditorBeforeDiscardContext["reason"] = "replace",
    replacement?: ReportTemplateDocument,
  ): Promise<boolean> {
    if (!pendingLocalChanges.value) return true;
    const before = snapshot(), beforeLocal = localRevision.value;
    try {
      const allowed = await discard.request({
        reason,
        document: JSON.parse(
          JSON.stringify(draft.value),
        ) as ReportTemplateDocument,
        replacement: replacement ? parseReportTemplate(replacement) : undefined,
        pendingLocalChanges: true,
      });
      return allowed && before === snapshot() && beforeLocal === localRevision.value;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      return false;
    }
  }
  function load(document: ReportTemplateDocument): void {
    const nextJson = serializeReportTemplate(document);
    cancelSave();
    conflict.clear(); toolDrafts.clear();
    draft.value = document;
    original.value = nextJson;
    json.value = original.value;
    appliedJson.value = json.value;
    jsonHistoryRevision = undefined;
    error.value = "";
    selected.value = 0;
    columns.clearSelection(); columns.cancelFieldChange();
    localDrafts.value = {}; localRevision.value++; toolEpoch.value++;
    history.reset(snapshot(), historyView?.read());
  }
  watch(
    () => props.modelValue,
    async (value) => {
      let document: ReportTemplateDocument;
      let incomingJson: string;
      try {
        document = parseReportTemplate(value);
        incomingJson = stringifyValidatedTemplate(document);
      } catch (cause) {
        error.value = cause instanceof Error ? cause.message : String(cause);
        return;
      }
      // v-model echoes retain the baseline and cannot clear an unapplied JSON draft.
      if (incomingJson === documentSnapshot.value.json) return;
      const job = ++replacementGeneration;
      cancelSave();
      if (!(await guardChanges("replace", document))) {
        if (job === replacementGeneration && validation.value.ok)
          emit("update:modelValue", copyDraft());
        return;
      }
      if (job === replacementGeneration) load(document);
    },
  );
  onBeforeUnmount(() => {
    replacementGeneration++;
    cancelSave();
    clearTimeout(previewTimer);
  });

  function changed(group?: string): void {
    changeGroup = group;
    documentFramePending = true;
    queueMicrotask(() => { documentFramePending = false; });
    discard.cancel();
    error.value = "";
    const current = documentSnapshot.value;
    if (current.json !== undefined) {
      json.value = current.json;
      appliedJson.value = json.value;
      jsonHistoryRevision = undefined;
      emit("update:modelValue", copyTemplateDocumentSnapshot(current));
    }
    // Navigation itself is not an edit; each frame retains this operation's
    // before/after coordinates independently from adjacent edits on other pages.
    if (history.record(snapshot(), historyView?.read(), group)) historyViewRevision.value++;
  }
  function transaction(
    change: (document: ReportTemplateDocument) => void,
  ): boolean {
    if (!canEdit()) return false;
    try {
      const candidate = copyDraft();
      change(candidate);
      const result = validateReportTemplateDocument(candidate);
      if (!result.ok)
        throw new Error(
          result.errors
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join("\n"),
        );
      stringifyValidatedTemplate(candidate);
      draft.value = candidate;
      changed();
      return true;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      return false;
    }
  }
  function applyTemplate(template: import("@agile-team/mach-report").ReportTemplate): boolean {
    if (toolPending.value || columns.fieldChange.value) {
      error.value = messages.value.toolsPending;
      return false;
    }
    return transaction(document => { document.template = parseReportTemplate({ ...document, template }).template; });
  }
  async function replaceDocument(
    value: ReportTemplateDocument,
  ): Promise<boolean> {
    if (!canEdit()) return false;
    try {
      const candidate = parseReportTemplate(value);
      stringifyValidatedTemplate(candidate);
      if (!(await guardChanges("replace", candidate))) return false;
      if (!canEdit()) return false;
      draft.value = candidate;
      selected.value = 0;
      columns.clearSelection();
      changed();
      return true;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      return false;
    }
  }
  function setName(value: string): void {
    if (!canEdit()) return;
    draft.value.name = value;
    changed("document:name");
  }
  function setDescription(value: string): void {
    if (!canEdit()) return;
    draft.value.description = value;
    changed("document:description");
  }
  function applyJson(): void {
    if (props.readonly || blocked.value) return;
    try {
      const document = parseReportTemplate(json.value);
      if (document.id !== draft.value.id)
        throw new Error("属性编辑不允许更换模板 ID，请另存为新模板");
      if (document.revision !== draft.value.revision)
        if (!jsonHistoryRevision || document.revision !== jsonHistoryRevision.revision)
          throw new Error("修订号由保存服务管理，不能在 JSON 中修改");
      if (draft.value.revision === undefined) delete document.revision;
      else document.revision = draft.value.revision;
      stringifyValidatedTemplate(document);
      draft.value = document;
      selected.value = 0;
      columns.clearSelection();
      changed();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    }
  }
  async function reset(): Promise<void> {
    if (blocked.value || props.readonly || !(await guardChanges("reset")))
      return;
    load(parseReportTemplate(original.value));
    emit("update:modelValue", copyDraft());
  }
  function moveHistory(delta: -1 | 1): void {
    if (blocked.value || props.readonly) return;
    // A new JSON edit after undo starts a fresh history branch.
    history.record(snapshot(), historyView?.read());
    const frame = history.move(delta);
    if (!frame) return;
    discard.cancel();
    const restored = JSON.parse(frame) as TemplateHistoryState;
    restoringHistory = true;
    draft.value = restoreTemplateHistoryDocument(restored, parseReportTemplate(original.value));
    // Invalid form input is a reversible local draft too. It may be displayed in
    // the JSON inspector, while validation continues to block preview and save.
    appliedJson.value = documentSnapshot.value.json ?? JSON.stringify(draft.value, null, 2);
    json.value = restored.json?.text ?? appliedJson.value;
    jsonHistoryRevision = restored.json ? { revision: restored.json.revision } : undefined;
    toolDrafts.restore(restored.tools);
    queueMicrotask(() => { restoringHistory = false; });
    error.value = "";
    const listIndex = history.context.value?.listIndex;
    selected.value = listIndex !== undefined && lists.value[listIndex] ? listIndex : 0;
    columns.clearSelection();
    if (history.context.value) historyView?.restore(history.context.value);
    if (validation.value.ok)
      emit("update:modelValue", copyDraft());
  }
  async function save(): Promise<void> {
    if (!props.save || !canEdit() || !validation.value.ok) return;
    if (toolPending.value || columns.fieldChange.value) { error.value = messages.value.toolsPending; return; }
    const job = ++generation;
    controller = new AbortController();
    saving.value = true;
    error.value = "";
    const document = copyDraft();
    try {
      const saved = parseReportTemplate(
        await props.save(document, {
          expectedRevision: document.revision,
          signal: controller.signal,
        }),
      );
      if (job !== generation) return;
      if (saved.id !== document.id)
        throw new Error("保存服务返回了其他模板的文档");
      const savedJson = stringifyValidatedTemplate(saved);
      draft.value = saved;
      original.value = savedJson;
      json.value = original.value;
      appliedJson.value = json.value;
      history.endGroup();
      jsonHistoryRevision = undefined;
      toolDrafts.clear(); recovery.flush();
      emit("saved", parseReportTemplate(saved));
      emit("update:modelValue", parseReportTemplate(saved));
    } catch (cause) {
      if (job === generation) {
        error.value = cause instanceof Error ? cause.message : String(cause);
        if (cause && typeof cause === "object" && "code" in cause && cause.code === "conflict") conflict.begin();
      }
    } finally {
      if (job === generation) {
        saving.value = false;
        controller = undefined;
      }
    }
  }
  const conflict = useTemplateConflict({
    configuration: () => props,
    baseline: () => parseReportTemplate(original.value),
    local: copyDraft,
    async applyLatest(document) {
      if (!await guardChanges("replace", document)) return false;
      load(document); emit("update:modelValue", parseReportTemplate(document)); return true;
    },
    rebase(latest) {
      const candidate = copyDraft();
      if (latest.revision === undefined) delete candidate.revision;
      else candidate.revision = latest.revision;
      const nextJson = serializeReportTemplate(candidate);
      const nextBaseline = serializeReportTemplate(latest);
      const pendingJson = jsonPending.value;
      // Commit only after both documents validate. Preserve nested tool references.
      if (candidate.revision === undefined) delete draft.value.revision;
      else draft.value.revision = candidate.revision;
      original.value = nextBaseline;
      if (!pendingJson) json.value = nextJson;
      appliedJson.value = nextJson;
      history.reset(snapshot(), historyView?.read());
      emit("update:modelValue", copyDraft());
    },
  });
  const recovery = useTemplateDraftRecovery({
    storage: () => props.draftStorage,
    id: () => draft.value.id,
    baseline: () => original.value,
    pending: () => pendingLocalChanges.value,
    changedSource: () => [snapshot(), original.value, json.value, appliedJson.value],
    snapshot: () => ({ version: 1, templateId: draft.value.id, savedAt: new Date().toISOString(), baseline: parseReportTemplate(original.value), document: JSON.parse(JSON.stringify(draft.value)) as ReportTemplateDocument, json: json.value, appliedJson: appliedJson.value, tools: toolDrafts.records.value }),
    restore(record) {
      if (props.readonly || saving.value) return;
      const latest = parseReportTemplate(props.modelValue);
      draft.value = parseReportTemplate(record.document);
      original.value = serializeReportTemplate(record.baseline);
      json.value = record.json; appliedJson.value = record.appliedJson;
      toolEpoch.value++; toolDrafts.restore(record.tools);
      const ruleKey = Object.keys(record.tools).find(key => key.startsWith("rules:"));
      if (ruleKey) { const [, pageIndex, componentIndex] = ruleKey.split(":"); const index = lists.value.findIndex(item => item.pageIndex === Number(pageIndex) && item.componentIndex === Number(componentIndex)); if (index >= 0) selected.value = index; }
      history.reset(snapshot(), historyView?.read());
      if (serializeReportTemplate(latest) !== original.value) conflict.begin(latest);
      emit("update:modelValue", copyDraft());
    },
  });
  const canUndo = computed(
    () => history.canUndo.value || snapshot() !== history.current.value,
  );
  const canRedo = computed(
    () => history.canRedo.value && snapshot() === history.current.value,
  );
  return {
    ...columns,
    recovery,
    conflict,
    editingReadonly: computed(() => props.readonly === true),
    connectHistoryView,
    captureHistoryView,
    historyViewRevision,
    transaction,
    applyTemplate,
    replaceDocument,
    originalDocument: computed(() => parseReportTemplate(original.value)),
    canUndo,
    canRedo,
    undo: () => moveHistory(-1),
    redo: () => moveHistory(1),
    pendingLocalChanges,
    setToolPending,
    isToolPending: (tool: string) => localDrafts.value[tool] === true,
    toolEpoch,
    toolPending,
    pendingTools,
    jsonPending,
    blocked,
    confirmation: discard.confirmation,
    decideDiscard: discard.decide,
    guardChanges,
    draft,
    json,
    selected,
    error,
    saving,
    dirty,
    validation,
    lists,
    activeList,
    headerAlignments,
    previewOptions,
    fetcher,
    flushPreview: refreshPreview,
    messages,
    setName,
    setDescription,
    setColumn,
    applyJson,
    reset,
    save,
  };
}
