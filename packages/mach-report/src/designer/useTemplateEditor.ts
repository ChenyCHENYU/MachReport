import { computed, onBeforeUnmount, ref, watch } from "vue";
import { provideTemplateToolDrafts } from "./useTemplateToolDrafts";
import { useTemplateDraftRecovery } from "./useTemplateDraftRecovery";
import { useTemplateConflict, type TemplateEditorConflictOptions } from "./useTemplateConflict";
import type { ReportTemplateFragment, ReportDocumentStyle } from "../source/template-fragments";
import type { TemplateDraftStorage } from "./draft-storage";
import type { TemplateProductMessages } from "./product-messages";
import type { TemplateReviewMessages } from "./review-messages";
import type { TemplateRecoveryMessages } from "./recovery-messages";
import {
  parseReportTemplate,
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
import { useTemplateHistory, type TemplateHistoryContext } from "./useTemplateHistory";
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
export interface TemplateEditorController {
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
  /** Optional independently persisted Excel source and binding recipe. */
  bindingSession?: AnyExcelBindingSession;
  readonly?: boolean;
  messages?: Partial<TemplateEditorMessages>;
  preview?: Pick<
    MachReportDefaults,
    | "showExport"
    | "showPrint"
    | "showPdfWindow"
    | "theme"
    | "assets"
    | "pdfFontUrl"
    | "toolbar"
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
  const original = ref(serializeReportTemplate(draft.value));
  const json = ref(serializeReportTemplate(draft.value));
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
    theme: {
      shellBg: "#f1f5f9",
      shellFg: "#334155",
      toolbarBg: "#ffffff",
      toolbarBorder: "#e2e8f0",
      toolbarFg: "#334155",
      btnFg: "#475569",
      btnBorder: "#cbd5e1",
      btnHoverBg: "#eff6ff",
      btnHoverFg: "#1d4ed8",
      btnActiveBg: "#2563eb",
      ...props.preview?.theme,
    },
  }));
  provideMachReportConfig({
    get defaults() {
      return previewOptions.value;
    },
  });
  let controller: AbortController | undefined;
  let generation = 0;
  const validation = computed(() =>
    validateReportTemplateDocument(draft.value),
  );
  const dirty = computed(() => {
    try {
      return serializeReportTemplate(draft.value) !== original.value;
    } catch {
      return true;
    }
  });
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
  const toolDrafts = provideTemplateToolDrafts(setToolPending);
  const pendingLocalChanges = computed(
    () => dirty.value || json.value !== appliedJson.value || toolPending.value || !!columns.fieldChange.value,
  );
  const snapshot = () =>
    JSON.stringify({
      document: draft.value,
      json: json.value,
      appliedJson: appliedJson.value,
    });
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
  const fetcher = computed(() =>
    validation.value.ok
      ? createLocalFetcher({
          draft: {
            template: draft.value.template,
            datasets: props.datasets ?? {},
            params: [],
          },
        })
      : undefined,
  );

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
    cancelSave();
    conflict.clear(); toolDrafts.clear();
    draft.value = document;
    original.value = serializeReportTemplate(document);
    json.value = original.value;
    appliedJson.value = json.value;
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
      try {
        document = parseReportTemplate(value);
      } catch (cause) {
        error.value = cause instanceof Error ? cause.message : String(cause);
        return;
      }
      // v-model echoes retain the baseline and cannot clear an unapplied JSON draft.
      try {
        if (
          serializeReportTemplate(document) ===
          serializeReportTemplate(draft.value)
        )
          return;
      } catch {
        /* Invalid local fields remain guarded. */
      }
      const job = ++replacementGeneration;
      cancelSave();
      if (!(await guardChanges("replace", document))) {
        if (job === replacementGeneration && validation.value.ok)
          emit("update:modelValue", parseReportTemplate(draft.value));
        return;
      }
      if (job === replacementGeneration) load(document);
    },
  );
  onBeforeUnmount(() => {
    replacementGeneration++;
    cancelSave();
  });

  function changed(): void {
    discard.cancel();
    error.value = "";
    if (validation.value.ok) {
      json.value = serializeReportTemplate(draft.value);
      appliedJson.value = json.value;
      emit("update:modelValue", parseReportTemplate(draft.value));
    }
    // Navigation itself is not an edit; each frame retains this operation's
    // before/after coordinates independently from adjacent edits on other pages.
    if (history.record(snapshot(), historyView?.read())) historyViewRevision.value++;
  }
  function transaction(
    change: (document: ReportTemplateDocument) => void,
  ): boolean {
    if (!canEdit()) return false;
    try {
      const candidate = parseReportTemplate(draft.value);
      change(candidate);
      const result = validateReportTemplateDocument(candidate);
      if (!result.ok)
        throw new Error(
          result.errors
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join("\n"),
        );
      draft.value = candidate;
      changed();
      return true;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      return false;
    }
  }
  async function replaceDocument(
    value: ReportTemplateDocument,
  ): Promise<boolean> {
    if (!canEdit()) return false;
    try {
      const candidate = parseReportTemplate(value);
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
    changed();
  }
  function setDescription(value: string): void {
    if (!canEdit()) return;
    draft.value.description = value;
    changed();
  }
  function applyJson(): void {
    if (props.readonly || blocked.value) return;
    try {
      const document = parseReportTemplate(json.value);
      if (document.id !== draft.value.id)
        throw new Error("属性编辑不允许更换模板 ID，请另存为新模板");
      if (document.revision !== draft.value.revision)
        throw new Error("修订号由保存服务管理，不能在 JSON 中修改");
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
    emit("update:modelValue", parseReportTemplate(draft.value));
  }
  function moveHistory(delta: -1 | 1): void {
    if (blocked.value || props.readonly) return;
    // A new JSON edit after undo starts a fresh history branch.
    history.record(snapshot(), historyView?.read());
    const frame = history.move(delta);
    if (!frame) return;
    discard.cancel();
    const restored = JSON.parse(frame) as {
      document: ReportTemplateDocument;
      json: string;
      appliedJson: string;
    };
    draft.value = restored.document;
    json.value = restored.json;
    appliedJson.value = restored.appliedJson;
    error.value = "";
    selected.value = 0;
    columns.clearSelection();
    if (history.context.value) historyView?.restore(history.context.value);
    if (validation.value.ok)
      emit("update:modelValue", parseReportTemplate(draft.value));
  }
  async function save(): Promise<void> {
    if (!props.save || !canEdit() || !validation.value.ok) return;
    if (toolPending.value || columns.fieldChange.value) { error.value = messages.value.toolsPending; return; }
    const job = ++generation;
    controller = new AbortController();
    saving.value = true;
    error.value = "";
    const document = parseReportTemplate(draft.value);
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
      draft.value = saved;
      original.value = serializeReportTemplate(saved);
      json.value = original.value;
      appliedJson.value = json.value;
      history.reset(snapshot(), historyView?.read());
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
    local: () => parseReportTemplate(draft.value),
    async applyLatest(document) {
      if (!await guardChanges("replace", document)) return false;
      load(document); emit("update:modelValue", parseReportTemplate(document)); return true;
    },
    rebase(latest) {
      const candidate = parseReportTemplate(draft.value);
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
      emit("update:modelValue", parseReportTemplate(draft.value));
    },
  });
  const recovery = useTemplateDraftRecovery({
    storage: () => props.draftStorage,
    id: () => draft.value.id,
    baseline: () => original.value,
    pending: () => pendingLocalChanges.value,
    changedSource: () => [draft.value, original.value, json.value, appliedJson.value, toolDrafts.records.value],
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
      emit("update:modelValue", parseReportTemplate(draft.value));
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
    messages,
    setName,
    setDescription,
    setColumn,
    applyJson,
    reset,
    save,
  };
}
