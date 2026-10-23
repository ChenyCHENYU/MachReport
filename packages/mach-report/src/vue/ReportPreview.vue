<script setup lang="ts">
/**
 * ReportPreview：接收报表 ID 和 PlanFetcher，预览与导出 RenderPlan。
 *
 * 职责编排（实现在 composables，本文件保持薄壳）：
 * - usePageWindow：视口虚拟化（自然坐标系 + gap）
 * - useZoom：transform: scale 缩放（零重排；Ctrl+滚轮/键盘 ±/持久化记忆）
 * - usePrintExport：打印/导出/PDF 窗口（流式打印 + named pages）
 * - useReportSearch/useThumbs/useDebugPanel：搜索（防抖+高亮）/缩略图/调试面板
 * - 配置优先级：props > provideMachReportConfig 叠加 > preset > 插件 config.defaults > 内置缺省
 */
import {
  computed,
  inject,
  nextTick,
  onMounted,
  onUnmounted,
  provide,
  ref,
  shallowRef,
  watch,
  watchEffect
} from "vue";
import type { PropType } from "vue";
import type { RenderPlan, ReportCellEdit, AssetRenderOptions, OutputFormat } from "@agile-team/mach-report";
import {
  renderPlanToCanvas,
  ReportCellEditError
} from "@agile-team/mach-report";
import { normalizeReportIds, type PlanFetcher } from "./adapters";
import { usePageWindow } from "./composables/usePageWindow";
import { usePageRendering } from "./composables/usePageRendering";
import { useZoom } from "./composables/useZoom";
import { usePrintExport } from "./composables/usePrintExport";
import { clearHighlights, highlightTextNodes } from "./composables/useHighlight";
import {
  useDebugPanel,
  useLoadTiming,
  useReportSearch,
  useThumbs
} from "./composables/useReportSearch";
import ReportToolbar from "./ReportToolbar.vue";
import ReportPagination from "./ReportPagination.vue";
import ReportRecordNavigation from "./ReportRecordNavigation.vue";
import ReportCalculationPanel from "./ReportCalculationPanel.vue";
import { useSelectionCalculation } from "./composables/useSelectionCalculation";
import ReportSettings from "./ReportSettings.vue";
import ReportEmpty from "./ReportEmpty.vue";
import ReportDiscardDialog from "./ReportDiscardDialog.vue";
import ReportTaskStatus from "./ReportTaskStatus.vue";
import ReportDiagnostics from "./ReportDiagnostics.vue";
import ReportDataExplanation from "./ReportDataExplanation.vue";
import ReportDrillActions from "./ReportDrillActions.vue";
import { useReportDrill } from "./composables/useReportDrill";
import type { ReportDrillOptions } from "./drill";
import type { ReportParamOptionsLoader } from "./param-options";
import ReportPrintSettings from "./ReportPrintSettings.vue";
import { createPrintCalibrationPlan } from "./print-calibration";
import { printPlans } from "./composables/usePrintExport";
import type { ReportPrintOptions, ReportPrintCalibration } from "./print-options";
import type { ReportDataTarget } from "../source/data-explanation";
import { usePreviewFont } from "./composables/usePreviewFont";
import { useDiscardGuard } from "./composables/useDiscardGuard";
import { usePreviewTask } from "./composables/usePreviewTask";
import { usePreviewDiagnostics } from "./composables/usePreviewDiagnostics";
import type { ReportBeforeDiscard, ReportDiscardReason, ReportOutputOptions, ReportPreviewTask, ReportPreviewDiagnostic } from "./guards";
import ReportParamPanel from "./ReportParamPanel.vue";
import ReportEditBar from "./ReportEditBar.vue";
import ReportNavigation from "./ReportNavigation.vue";
import ReportImportSummary from "./ReportImportSummary.vue";
import type { ReportParamDef } from "@agile-team/mach-report";
import {
  MACH_REPORT_CONTROLLER_KEY,
  MACH_REPORT_FETCHER_KEY,
  MACH_REPORT_PDF_EXPORTER_KEY
} from "./injection-keys";
import {
  themeToCssVars,
  resolveCalculationMessages,
  type MachReportMessages
} from "./config";

import { MachReportError, normalizeReportLoadError, toErrorDetail, type MachReportErrorCode } from "./errors";
import type { MachReportController, MachReportState, MachReportStateError } from "./controller";
import type { ReportEditingOptions } from "./editing";
import type { ExcelImportOptions, ExcelImportResult } from "../xlsx/import-types";
import { useCellEditing } from "./composables/useCellEditing";
import { cloneReportSnapshot } from "./snapshot";
import { usePreviewConfiguration } from "./composables/usePreviewConfiguration";
import { scopeQueryDiagnostics } from "./query-diagnostics";
import { useCellSelection, type ReportFieldTarget } from "./composables/useCellSelection";
import { useFrozenPanes } from "./composables/useFrozenPanes";
import { useReportParams } from "./composables/useReportParams";
import { forwardOutputAbort } from "../output/progress";
import { loadPreviewPlan, importPreviewPlan } from "./preview-plan";
import { type MachReportToolbarOptions, type ReportEmptyState, type ReportPreviewPreferences, type ReportPreviewTool, type ReportInteractionOptions, type ReportPreferencesOptions, type ReportSection } from "./tools";

const props = defineProps({
  drill: { type: Object as PropType<ReportDrillOptions>, default: undefined },
  loadParamOptions: { type: Function as PropType<ReportParamOptionsLoader>, default: undefined },
  reportId: {
    type: [String, Array] as PropType<string | string[] | null>,
    default: null
  },
  params: {
    type: Object as PropType<Record<string, string>>,
    default: () => ({})
  },
  height: { type: String, default: "100vh" },
  autoLoad: { type: Boolean, default: true },
  /** 以下显隐/间距不传时走配置中心（preset > defaults > 内置缺省） */
  showExport: { type: Boolean, default: undefined },
  showPrint: { type: Boolean, default: undefined },
  showPdfWindow: { type: Boolean, default: undefined },
  showSettings: { type: Boolean, default: undefined },
  toolbar: { type: Object as PropType<MachReportToolbarOptions>, default: undefined },
  interaction: { type: Object as PropType<ReportInteractionOptions>, default: undefined },
  preferences: { type: Object as PropType<ReportPreferencesOptions>, default: undefined },
  guardChanges: { type: Boolean, default: undefined },
  beforeDiscard: { type: Function as PropType<ReportBeforeDiscard>, default: undefined },
  output: { type: Object as PropType<ReportOutputOptions>, default: undefined },
  assets: { type: Object as PropType<AssetRenderOptions>, default: undefined },
  printOptions: { type: Object as PropType<ReportPrintOptions>, default: undefined },
  /** 保留表头的零行业务结果；不改变计划和导出内容。 */
  emptyState: { type: [Boolean, Object] as PropType<boolean | ReportEmptyState>, default: false },
  /** 页间距（px）；不传走配置中心 */
  gapPx: { type: Number, default: undefined },
  /** 工具栏/状态文案覆写（不传走配置中心 messages） */
  messages: { type: Object as PropType<Partial<MachReportMessages>>, default: undefined },
  /** 启用的 preset 名（不传用配置中心 defaultPreset） */
  preset: { type: String, default: undefined },
  /** 调试面板（也可用 URL ?mrp-debug=1 开启） */
  debug: { type: Boolean, default: false },
  /** 参数定义（优先级：prop > 模板 params；有定义且未关闭时显示查询面板） */
  paramDefs: {
    type: Array as PropType<ReportParamDef[] | undefined>,
    default: undefined
  },
  /** 参数面板显隐（不传走配置中心，缺省 true；有参数定义才渲染） */
  showParams: { type: Boolean, default: undefined },
  editable: { type: [Boolean, Object] as PropType<boolean | ReportEditingOptions>, default: undefined },
  excelImport: { type: [Boolean, Object] as PropType<boolean | ExcelImportOptions>, default: undefined },
  fetcher: {
    type: Function as unknown as PropType<PlanFetcher | null>,
    default: null
  }
});

const emit = defineEmits<{
  (e: "loaded", pageCount: number): void;
  (e: "task", task: Readonly<ReportPreviewTask>): void;
  (e: "diagnostic", diagnostic: Readonly<ReportPreviewDiagnostic>): void;
  (e: "error", message: string, detail?: { code: string; cause?: unknown }): void;
  (e: "warning", message: string): void;
  (e: "cell-edit", edit: ReportCellEdit): void;
  (e: "template-import", result: ExcelImportResult): void;
  (e: "preferences-change", preferences: Readonly<ReportPreviewPreferences>): void;
}>();

const plan = shallowRef<RenderPlan | null>(null);
const loading = ref(false);
const errorMessage = ref("");
const lastError = shallowRef<Readonly<MachReportStateError> | null>(null);
const exporting = ref<string | null>(null);
const printing = ref(false);

const exportNotice = ref<{ kind: "error" | "warning" | "progress"; message: string } | null>(null);
const currentPage = ref(1);
const containerRef = ref<HTMLElement | null>(null);
const viewportRef = ref<HTMLElement | null>(null);
const thumbsRef = ref<HTMLElement | null>(null);
const showThumbs = ref(false);
const importing = ref(false);
const settingsOpen = ref(false);
const settingsSection = ref<"general" | "tools" | "advanced">("general");
const importedResult = shallowRef<Pick<ExcelImportResult, "sheets" | "warnings"> | null>(null);
const importInputRef = ref<HTMLInputElement | null>(null);
const toolbarRef = ref<InstanceType<typeof ReportToolbar> | null>(null);
const timing = useLoadTiming();
let viewportObserver: ResizeObserver | null = null;
let destroyed = false;
const task = usePreviewTask((value) => emit("task", value));
const diagnostics = usePreviewDiagnostics((value) => emit("diagnostic", value));
const dataExplanations = computed(() => diagnostics.entries.value.filter(entry => entry.valueState && entry.target));
const outputDiagnostics = computed(() => diagnostics.entries.value.filter(entry => !entry.valueState));
const loadedContext = shallowRef<{ reportIds: readonly string[]; params: Readonly<Record<string, string>> } | null>(null);

const wideReport = computed(() => !!plan.value?.pages.length && plan.value.pages.every((page) => page.layout === "wide"));
const PX_PER_MM = 96 / 25.4;
const UI_MEMORY_KEY = "mach-report:ui";
const WIDE_UI_MEMORY_KEY = "mach-report:ui:wide";
let zoomMemoryKey = UI_MEMORY_KEY;

const injectedFetcher = inject(MACH_REPORT_FETCHER_KEY, null);
const injectedPdfExporter = inject(MACH_REPORT_PDF_EXPORTER_KEY, null);

const reportIds = computed(() => normalizeReportIds(props.reportId));
const effectiveFetcher = computed(() => props.fetcher ?? injectedFetcher);
const pageCount = computed(() => plan.value?.pages.length ?? 0);
const state = computed<MachReportState>(() => Object.freeze({
  loading: loading.value,
  hasPlan: pageCount.value > 0,
  pageCount: pageCount.value,
  currentPage: currentPage.value,
  exporting: exporting.value,
  printing: printing.value,
  canExport: !loading.value && !importing.value && !editing.saving.value && pageCount.value > 0 && exporting.value === null,
  canPrint: !loading.value && !importing.value && !editing.saving.value && pageCount.value > 0 && !printing.value,
  error: lastError.value,
  pdfFont: pdfFont.value,
  editing: editing.active.value !== null,
  saving: editing.saving.value,
  importing: importing.value,
  dirty: editing.differences.value.length > 0,
  pendingLocalChanges: editing.pendingLocalChanges.value,
  task: task.state.value,
  diagnostics: diagnostics.entries.value,
  reportIds: loadedContext.value?.reportIds ?? [],
  params: loadedContext.value?.params ?? {},
  canUndo: editing.canUndo.value,
  canRedo: editing.canRedo.value,
  changeCount: editing.differences.value.length,
  selection: cells.selection.value ? cloneReportSnapshot(cells.selection.value) : null
}));

function reportError(message: string, code: MachReportErrorCode, cause?: unknown): void {
  lastError.value = Object.freeze({ message, code, cause });
  emit("error", message, { code, cause });
}

const {
  resolved, resolvedMessages, effectiveShowExport,
  effectiveShowSettings, effectiveGuardChanges, effectiveOutput, effectiveInteraction, effectiveAssets,
  effectiveGapPx, effectiveShowParams, availableTools, tools, toolState, visibleExportFormats,
  effectiveEditable, effectiveExcelImport, persistedEditing, emptyStateContent, sessionInteraction
} = usePreviewConfiguration(props, wideReport, (message) => emit("warning", message));
const localPrintCalibration = ref<ReportPrintCalibration>();
const effectivePrintOptions = computed<ReportPrintOptions>(() => ({ ...resolved.value.printOptions, ...props.printOptions, calibration: localPrintCalibration.value ?? { ...resolved.value.printOptions?.calibration, ...props.printOptions?.calibration } }));
watch([() => props.printOptions, () => resolved.value.printOptions], () => { localPrintCalibration.value = undefined; });
let calibrationPrintController: AbortController | undefined;
const pdfToolsEnabled = computed(() => toolState.value.pdf || toolState.value.pdfWindow);
const calculationsEnabled = computed(() => effectiveInteraction.value.calculations === true);
const calculationMessages = computed(() => resolveCalculationMessages(resolvedMessages.value));
const { pdfFont, getPdfExporter, checkPdfFont, retryPdfFont, cancelFontCheck } = usePreviewFont({
  plan, fontUrl: () => resolved.value.pdfFontUrl,
  enabled: () => pdfToolsEnabled.value,
  injectedExporter: injectedPdfExporter, destroyed: () => destroyed
});

async function onToolChange(key: ReportPreviewTool, enabled: boolean): Promise<void> {
  // 不因隐藏编辑工具丢弃输入；验证或保存失败时保留编辑能力和原值。
  if (key === "editing" && !enabled && !await editing.settle()) return;
  tools.setEnabled(key, enabled);
  emit("preferences-change", Object.freeze({ ...toolState.value }));
}

async function resetTools(): Promise<void> {
  if (!await editing.settle()) return;
  tools.reset();
  sessionInteraction.value = {};
  localPrintCalibration.value = undefined;
  emit("preferences-change", Object.freeze({ ...toolState.value }));
}
async function toggleSettings(section: "general" | "tools" | "advanced" = "general"): Promise<void> {
  if (settingsOpen.value) { settingsOpen.value = false; return; }
  // Wait for the active editor before moving focus into an aria-modal dialog.
  // A rejected save must keep both the input and its focus available for correction.
  const ready = editing.settle();
  if (!(typeof ready === "boolean" ? ready : await ready) || destroyed || !effectiveShowSettings.value) return;
  settingsSection.value = section;
  settingsOpen.value = true;
}
function editErrorMessage(cause: unknown): string {
  if (cause instanceof ReportCellEditError) {
    const messages: Record<string, string | undefined> = {
      number: resolvedMessages.value.editInvalidNumber,
      boolean: resolvedMessages.value.editInvalidBoolean,
      conflict: resolvedMessages.value.editConflict,
      atomic: resolvedMessages.value.editAtomicRequired,
      limit: resolvedMessages.value.clipboardLimit,
      readonly: resolvedMessages.value.editReadOnly,
      missing: resolvedMessages.value.editMissing,
      recalculation: resolvedMessages.value.editRecalculationUnavailable,
      duplicate: resolvedMessages.value.editDuplicate,
      clipboard: resolvedMessages.value.clipboardInvalid
    };
    return messages[cause.code] ?? cause.message;
  }
  return cause instanceof Error ? cause.message : "单元格保存失败";
}
const editing = useCellEditing({
  plan,
  options: effectiveEditable,
  blocked: () => loading.value || importing.value || exporting.value !== null || printing.value || discard.pending.value,
  label: () => resolvedMessages.value.editCell ?? "编辑单元格",
  errorMessage: editErrorMessage,
  suspendBlur: () => discard.request.value !== null,
  onChange: (edit) => { lastError.value = null; exportNotice.value = null; emit("cell-edit", edit); },
  onError: (message, cause) => {
    exportNotice.value = { kind: "error", message };
    reportError(message, "edit", cause);
  },
  onNavigate: (address, key, backwards) => cells.navigate(address, key, backwards)
});
const cells = useCellSelection({
  plan, root: containerRef,
  enabled: () => !!effectiveEditable.value || calculationsEnabled.value || !!(props.drill ?? resolved.value.drill),
  editable: () => !!effectiveEditable.value,
  busy: () => loading.value || importing.value || editing.saving.value || !!exporting.value || printing.value || discard.pending.value,
  differences: () => editing.differences.value,
  gotoPage, edit: editing.editCell, apply: editing.apply, undo: editing.undo, redo: editing.redo,
  error: (cause) => { const message = editErrorMessage(cause); exportNotice.value = { kind: "error", message }; reportError(message, "edit", cause); }
});
const calculation = useSelectionCalculation({ plan, selection: cells.selection, enabled: () => calculationsEnabled.value });
function openCalculations(): void { void toggleSettings("advanced"); }
const discard = useDiscardGuard({
  pending: () => editing.pendingLocalChanges.value,
  reportIds: () => loadedContext.value?.reportIds ?? reportIds.value,
  hook: () => props.beforeDiscard ?? resolved.value.beforeDiscard,
  enabled: () => effectiveGuardChanges.value,
  snapshot: () => [plan.value, editing.active.value?.editor.input.value],
  error: (cause) => reportError(cause instanceof Error ? cause.message : "修改保护回调失败", "config", cause)
});
async function confirmDiscard(reason: ReportDiscardReason = "leave"): Promise<boolean> { return discard.check(reason); }
const drill = useReportDrill({
  plan, selection: cells.selection,
  options: () => props.drill ?? resolved.value.drill,
  params: () => ({ ...loadedContext.value?.params }),
  view: () => ({ zoom: zoom.value, scrollTop: containerRef.value?.scrollTop ?? 0, scrollLeft: containerRef.value?.scrollLeft ?? 0 }),
  messages: () => resolvedMessages.value,
  busy: () => loading.value || importing.value || editing.saving.value || !!exporting.value || printing.value,
  beforeOpen: () => confirmDiscard("leave")
});
function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (!effectiveGuardChanges.value || !editing.pendingLocalChanges.value) return;
  event.preventDefault(); event.returnValue = "";
}
function cancelTask(): void { task.cancel(); }
function locateEdit(edit: ReportCellEdit): void {
  const address = editing.resolveAddress(edit);
  if (address) void cells.focusCell(address);
}
async function locateTarget(target: ReportFieldTarget): Promise<void> {
  if (!await cells.focusField(target)) exportNotice.value = { kind: "warning", message: resolvedMessages.value.locateFieldMissing ?? "Field not found" };
}
function locateDiagnostic(entry: Readonly<ReportPreviewDiagnostic>): void {
  if (entry.pageIndex === undefined) return;
  gotoPage(entry.pageIndex + 1);
  const path = entry.componentPath;
  if (entry.componentIndex !== undefined && path && path.length === 2) void cells.focusCell({ pageIndex: entry.pageIndex, componentIndex: entry.componentIndex, rowIndex: path[0]!, columnIndex: path[1]! });
}
function outputAllowed(format: string): boolean {
  const snapshot = plan.value;
  if (!snapshot) return false;
  const normalized = ({ excel: "xlsx", image: "png", doc: "word" } as Record<string, string>)[format] ?? format;
  const target: OutputFormat = normalized === "pdf" ? "pdf" : normalized === "xlsx" ? "xlsx" : normalized === "png" ? "canvas" : "dom";
  const issues = diagnostics.inspect(snapshot, target);
  if (plan.value !== snapshot) return false;
  if (issues.length && effectiveOutput.value.fidelity === "strict") {
    exportNotice.value = { kind: "error", message: resolvedMessages.value.diagnosticsStrict ?? "输出存在已知降级" };
    reportError(exportNotice.value.message, "export", { diagnostics: issues });
    return false;
  }
  return true;
}
function getOutputDiagnostics(format: OutputFormat): readonly Readonly<ReportPreviewDiagnostic>[] {
  return plan.value ? diagnostics.inspect(plan.value, format) : [];
}
const sections = computed<ReportSection[]>(() => {
  if (importedResult.value) return importedResult.value.sheets.map((sheet) => ({ label: sheet.name, pageIndex: sheet.pageStart }));
  const seen = new Set<string>();
  return plan.value?.pages.flatMap((page, pageIndex) => page.components.flatMap((component) => {
    const table = component.table;
    if (!table?.title || seen.has(table.id)) return [];
    seen.add(table.id); return [{ label: table.title, pageIndex }];
  })) ?? [];
});
async function locateField(field: string): Promise<void> {
  if (field && !await cells.focusField({ field })) exportNotice.value = { kind: "warning", message: resolvedMessages.value.locateFieldMissing ?? "Field not found" };
}
async function locateDataExplanation(target: ReportDataTarget): Promise<void> {
  if (!await cells.focusField(target)) exportNotice.value = { kind: "warning", message: resolvedMessages.value.locateFieldMissing ?? "Field not found" };
}
// ── 参数面板：定义优先级 prop > 模板 params；值合并优先级 面板值 > props.params ──
const paramMetadata = computed(() => {
  try { return { defs: props.paramDefs ?? effectiveFetcher.value?.getParamDefs?.(reportIds.value) ?? [], error: null }; }
  catch (cause) { return { defs: [], error: new MachReportError("config", cause instanceof Error ? cause.message : "查询参数配置无效", cause) }; }
});
const effectiveParamDefs = computed<ReportParamDef[]>(() => paramMetadata.value.defs);
const queryParams = useReportParams({ defs: effectiveParamDefs, reportIds, params: () => props.params, messages: () => resolvedMessages.value });
const { values: paramValues, attempted: paramAttempted, pendingRequired } = queryParams;
const paramPanelRef = ref<{ focusInvalid(): void } | null>(null);

function onParamQuery(): void {
  paramAttempted.value = true;
  if (!queryParams.validation.value.ok) void nextTick(() => paramPanelRef.value?.focusInvalid());
  void reload();
}

function onParamReset(): void {
  queryParams.reset(); errorMessage.value = ""; lastError.value = null;
}

const shellStyle = computed(() => ({
  height: props.height,
  "--mrp-page-gap": `${Math.max(0, effectiveGapPx.value)}px`,
  ...themeToCssVars(resolved.value.theme)
}));

const { zoom, zoomMode, applyFitZoom, setZoom } = useZoom(() => ({
  viewport: viewportRef.value,
  pageWidthPx: pageWindow.contentSize.value.w || 210 * PX_PER_MM
}));

const pageWindow = usePageWindow(plan, zoom, {
  pxPerMm: PX_PER_MM,
  gapPx: effectiveGapPx,
  overscan: computed(() => resolved.value.preview.overscanPages)
});
const { contentSize, windowRange, visiblePages, makeScrollHandler, refreshViewport } = pageWindow;
const onViewportScroll = makeScrollHandler(currentPage, pageCount);
const frozenPanes = useFrozenPanes({ root: containerRef, viewport: viewportRef, plan, zoom, options: () => effectiveInteraction.value });
watch([effectiveInteraction, zoom], () => frozenPanes.schedule(), { flush: "post" });

/** 缩放原始值（Ctrl+滚轮/键盘 ± 用）：clamp 30%~300% */
function setZoomRaw(next: number): void {
  setZoom(next * 100);
}

function invalidate(): void {
  calibrationPrintController?.abort();
  importing.value = false;
  editing.reset();
  cells.reset();
  importedResult.value = null;
  releasePrintFrame();
  plan.value = null;
  loadedContext.value = null;
  diagnostics.reset();
  currentPage.value = 1;
  search.reset();
}

/** 代际令牌：报表 ID 快速切换时，旧请求即使后返回也不得覆盖新数据 */
let reloadSeq = 0;
let loadController: AbortController | null = null;
function isCurrentLoad(seq: number, controller: AbortController): boolean {
  return seq === reloadSeq && !controller.signal.aborted && !destroyed;
}
function resetViewport(): void {
  if (!viewportRef.value) return;
  viewportRef.value.scrollTop = 0; viewportRef.value.scrollLeft = 0;
}
function emitImportWarnings(warnings: readonly string[], seq: number): boolean {
  for (const message of warnings) {
    if (seq !== reloadSeq) return false;
    emit("warning", message);
  }
  return seq === reloadSeq;
}

function readQueryParams(): Record<string, string> | null {
  if (paramMetadata.value.error) {
    const error = paramMetadata.value.error;
    invalidate(); errorMessage.value = error.message; reportError(error.message, error.code, error.cause);
    return null;
  }
  const query = queryParams.query();
  if (query.params) return query.params;
  invalidate();
  errorMessage.value = query.quiet ? "" : query.error!.message;
  if (!query.quiet) {
    paramAttempted.value = true;
    reportError(query.error!.message, query.error!.code, query.error!.cause);
  }
  return null;
}

async function reload(): Promise<void> {
  if (destroyed) return;
  if (effectiveGuardChanges.value && editing.pendingLocalChanges.value && !await discard.check("reload")) return;
  if (destroyed) return;
  const seq = ++reloadSeq;
  importing.value = false;
  loadController?.abort();
  loadController = null;
  const fetcher = effectiveFetcher.value;
  // 新一轮负责结束旧 loading；参数/配置早退时旧请求的 finally 已失去代际权限。
  loading.value = false;
  lastError.value = null;
  if (reportIds.value.length === 0) {
    errorMessage.value = "缺少报表 ID";
    invalidate();
    reportError(errorMessage.value, "param");
    return;
  }
  if (!fetcher) {
    errorMessage.value = "未提供渲染数据源 fetcher";
    invalidate();
    reportError(errorMessage.value, "config");
    return;
  }
  const params = readQueryParams();
  if (!params) return;
  loading.value = true;
  errorMessage.value = "";
  exportNotice.value = null;
  invalidate();
  const t0 = timing.start();
  const controller = new AbortController();
  loadController = controller;
  const operation = task.start("query", "query", () => {
    if (loadController !== controller) return;
    controller.abort(); reloadSeq++; loadController = null; loading.value = false;
  });
  const requestedIds = [...reportIds.value];
  const requestedParams = Object.freeze({ ...params });
  const reportedWarnings = new Set<string>();
  function reportWarning(message: string): void {
    if (seq !== reloadSeq || controller.signal.aborted || reportedWarnings.has(message)) return;
    reportedWarnings.add(message);
    resolved.value.logger.warn("[mach-report] 报表告警:", message);
    diagnostics.add({ code: "layout", severity: "warning", message });
    emit("warning", message);
  }
  try {
    const next = await loadPreviewPlan(fetcher, {
      reportIds: requestedIds,
      params,
      taskId: operation.taskId,
      onEvent: (event) => { if (seq === reloadSeq && !controller.signal.aborted) operation.update(event.stage, event.completed, event.total); },
      onQueryResult: (id, result, index) => { if (seq === reloadSeq && !controller.signal.aborted) diagnostics.addMany(scopeQueryDiagnostics(requestedIds, id, result.diagnostics ?? [], index)); },
      signal: controller.signal,
      onWarning: reportWarning
    }, effectiveAssets.value, operation.update);
    if (!isCurrentLoad(seq, controller)) return;
    plan.value = next;
    loadedContext.value = Object.freeze({ reportIds: Object.freeze(requestedIds), params: requestedParams });
    diagnostics.inspect(next, "dom");
    if (!isCurrentLoad(seq, controller)) return;
    operation.finish();
    currentPage.value = 1;
    timing.end(t0);
    resetViewport();
    // 纸张与宽表分别记忆，旧的适宽偏好不会把新宽表默认压成小字。
    const nextMemoryKey = wideReport.value ? WIDE_UI_MEMORY_KEY : UI_MEMORY_KEY;
    if (nextMemoryKey !== zoomMemoryKey) {
      zoomMemoryKey = nextMemoryKey;
      loadZoomMemory();
    }
    if (zoomMode.value === "fit") applyFitZoom();
    emit("loaded", next.pages.length);
  } catch (error) {
    if (seq !== reloadSeq) return;
    if (controller.signal.aborted) { operation.finish("cancelled"); return; }
    operation.finish("failed");
    const normalized = normalizeReportLoadError(error);
    errorMessage.value = normalized.message;
    const detail = toErrorDetail(normalized);
    reportError(normalized.message, detail.code, detail.cause);
  } finally {
    if (seq === reloadSeq) loading.value = false;
    if (loadController === controller) loadController = null;
  }
}

function gotoPage(n: number): void {
  if (destroyed || pageCount.value <= 0) return;
  const target = Math.max(1, Math.min(pageCount.value, n));
  currentPage.value = target;
  const vp = viewportRef.value;
  if (!vp) return;
  pageWindow.scrollToPage(vp, target - 1);
  // 程序化翻页即刻更新窗口；无需等待浏览器异步 scroll 事件才挂载目标页。
  pageRendering.prioritize(target - 1);
}

const exportApi = usePrintExport(plan, {
  getPdfExporter,
  beforeOutput: () => editing.settle(),
  onTask: (value) => task.receive(value, () => exportApi.cancel()),
  onDiagnostic: diagnostics.add,
  getXlsxOptions: () => resolved.value.xlsx,
  getPrintOptions: () => effectivePrintOptions.value,
  getPrintMessages: () => resolvedMessages.value,
  onError: (message, code) => {
    exportNotice.value = { kind: "error", message };
    reportError(message, (code ?? "print") as MachReportErrorCode);
  },
  onWarning: (message) => {
    exportNotice.value = { kind: "warning", message };
    diagnostics.add({ code: "output", severity: "warning", message });
    emit("warning", message);
  },
  onBusy: (format) => {
    exporting.value = format;
    if (format) {
      exportNotice.value = {
        kind: "progress",
        message: resolvedMessages.value.exporting.replace("{format}", format)
      };
    } else if (exportNotice.value?.kind === "progress") {
      exportNotice.value = null;
    }
  },
  onPrinting: (value) => { printing.value = value; }
});
const { releasePrintFrame, dispose } = exportApi;
const canCalibratePrint = computed(() => {
  const page = plan.value?.pages[0];
  return !!page && !wideReport.value && [page.pageWidthMm, page.pageHeightMm].every(size => size >= 25 && size <= 600);
});
async function testPrintCalibration(): Promise<void> {
  if (!canCalibratePrint.value || printing.value || loading.value || importing.value) return;
  const page = plan.value!.pages[0]!;
  printing.value = true;
  const controller = new AbortController(); calibrationPrintController = controller;
  try { await printPlans([createPrintCalibrationPlan(page.pageWidthMm, page.pageHeightMm)], { printOptions: effectivePrintOptions.value, signal: controller.signal, messages: resolvedMessages.value, onError: message => { exportNotice.value = { kind: "error", message }; } }); }
  catch { /* Superseded calibration output is cancelled without replacing the next report's status. */ }
  finally { if (calibrationPrintController === controller) { printing.value = false; calibrationPrintController = undefined; } }
}
async function print(): Promise<void> {
  if (loading.value || importing.value) return;
  const ready = editing.settle();
  if (!(typeof ready === "boolean" ? ready : await ready)) return;
  lastError.value = null;
  if (outputAllowed("html")) await exportApi.print();
}
async function exportAs(format: string): Promise<void> {
  if (loading.value || importing.value) return;
  const ready = editing.settle();
  if (!(typeof ready === "boolean" ? ready : await ready)) return;
  lastError.value = null;
  if (outputAllowed(format)) await exportApi.exportAs(format);
}
function openPdfWindow(): void {
  if (loading.value || importing.value || editing.active.value || editing.saving.value) {
    exportNotice.value = { kind: "warning", message: resolvedMessages.value.editingHint ?? "请先确认单元格修改" };
    return;
  }
  lastError.value = null;
  if (outputAllowed("pdf")) exportApi.openPdfWindow();
}

/** 控制器注入：后代组件 useReportPreview() 免模板 ref 编程式访问（与 expose 同面） */
/** 编程式设参查询：合并进面板值（面板本地字典经 v-model 同步），可选立即重载 */
async function setParams(values: Record<string, string>, opts: { reload?: boolean } = {}): Promise<void> {
  if (destroyed) return;
  paramValues.value = { ...paramValues.value, ...values };
  if (opts.reload !== false) { paramAttempted.value = true; await reload(); }
}

const controller: MachReportController = {
  reload, print, exportAs, openPdfWindow, gotoPage, setParams, checkPdfFont, importExcel, getPlan,
  cancelTask, confirmDiscard, getOutputDiagnostics,
  getChanges: editing.getChanges,
  undo: editing.undo, redo: editing.redo, restoreChanges: editing.restore,
  getDifferences: () => cloneReportSnapshot(editing.differences.value),
  getSelection: () => cells.selection.value ? cloneReportSnapshot(cells.selection.value) : null,
  focusCell: cells.focusCell, focusField: cells.focusField,
  copySelection: cells.copySelection, pasteSelection: cells.pasteSelection,
  get state() { return state.value; }
};
provide(MACH_REPORT_CONTROLLER_KEY, controller);

function getPlan(): RenderPlan | null {
  return plan.value ? cloneReportSnapshot(plan.value) : null;
}

function mergeExcelImportOptions(options?: ExcelImportOptions): ExcelImportOptions {
  const defaults = typeof effectiveExcelImport.value === "object" ? effectiveExcelImport.value : {};
  return { ...defaults, ...options, limits: { ...defaults.limits, ...options?.limits } };
}

function acceptImportedPlan(next: RenderPlan, result: ExcelImportResult): void {
  editing.reset();
  cells.reset();
  releasePrintFrame();
  search.reset();
  plan.value = next;
  loadedContext.value = null;
  diagnostics.reset();
  importedResult.value = { sheets: cloneReportSnapshot(result.sheets), warnings: [...result.warnings] };
  currentPage.value = 1;
  errorMessage.value = "";
  exportNotice.value = result.warnings.length ? { kind: "warning", message: result.warnings.join("；") } : null;
  resetViewport();
  zoomMemoryKey = wideReport.value ? WIDE_UI_MEMORY_KEY : UI_MEMORY_KEY;
  loadZoomMemory();
  diagnostics.addMany(result.warnings.map((message) => ({ code: "excel-import", severity: "warning" as const, message })));
  if (plan.value === next) diagnostics.inspect(next, "dom");
}

/** Import is an explicit local replacement; business mapping/storage remains in the host. */
async function importExcel(input: ArrayBuffer | Uint8Array | Blob, options?: ExcelImportOptions): Promise<ExcelImportResult | null> {
  if (destroyed) throw new MachReportError("config", "报表预览已卸载");
  if (effectiveGuardChanges.value && editing.pendingLocalChanges.value && !await discard.check("import")) return null;
  if (destroyed) return null;
  const seq = ++reloadSeq;
  loadController?.abort();
  loadController = null;
  loading.value = false;
  editing.cancel();
  exportApi.invalidatePending();
  importing.value = true;
  const controller = new AbortController();
  loadController = controller;
  lastError.value = null;
  exportNotice.value = { kind: "progress", message: resolvedMessages.value.importing ?? "正在导入 Excel…" };
  const operation = task.start("import", "import", () => {
    if (loadController !== controller) return;
    controller.abort(); reloadSeq++; loadController = null; importing.value = false; exportNotice.value = null;
  });
  const importOptions = mergeExcelImportOptions(options);
  const unlink = forwardOutputAbort(importOptions.signal, controller);
  try {
    const { result, plan: next } = await importPreviewPlan(input, {
      ...importOptions, onProgress: (done, total) => { operation.update("import", done, total); importOptions.onProgress?.(done, total); }
    }, effectiveAssets.value, controller.signal, (message) => { if (seq === reloadSeq) emit("warning", message); }, operation.update);
    if (!isCurrentLoad(seq, controller)) return null;
    if (!emitImportWarnings(result.warnings, seq)) return null;
    acceptImportedPlan(next, result);
    if (!isCurrentLoad(seq, controller)) return null;
    operation.finish();
    emit("template-import", result);
    if (seq === reloadSeq) emit("loaded", next.pages.length);
    return result;
  } catch (cause) {
    if (seq !== reloadSeq) return null;
    if (controller.signal.aborted) { operation.finish("cancelled"); return null; }
    operation.finish("failed");
    const error = new MachReportError("import", cause instanceof Error ? cause.message : "Excel 模板导入失败", cause);
    exportNotice.value = { kind: "error", message: error.message };
    reportError(error.message, "import", cause);
    throw error;
  } finally {
    unlink();
    if (seq === reloadSeq) importing.value = false;
    if (loadController === controller) loadController = null;
  }
}

function onImportFile(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file) void importExcel(file).catch(() => { /* The import API already emits the structured error. */ });
}

// ── 交互：Ctrl+滚轮缩放 / 键盘翻页与缩放 / Ctrl+F 搜索 ──
const search = useReportSearch({
  plan,
  gotoPage,
  debounceMs: computed(() => resolved.value.preview.searchDebounceMs),
  highlight: highlightTextNodes,
  clearHighlights
});
watch(() => toolState.value.search, (enabled) => {
  if (!enabled) { search.reset(); search.visible.value = false; }
});

function onWheel(e: WheelEvent): void {
  if (!e.ctrlKey || !toolState.value.zoom) return;
  e.preventDefault();
  setZoomRaw(zoom.value * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
}

function onKeydown(e: KeyboardEvent): void {
  if (cells.onKeydown(e)) return;
  if (e.target instanceof Element && e.target.closest("input,textarea,select,[contenteditable='true']")) return;
  if (toolState.value.search && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
    e.preventDefault();
    if (!search.visible.value) search.toggle();
    void nextTick(() => toolbarRef.value?.focusSearch());
    return;
  }
  switch (e.key) {
    case "PageDown":
      e.preventDefault();
      gotoPage(currentPage.value + 1);
      break;
    case "PageUp":
      e.preventDefault();
      gotoPage(currentPage.value - 1);
      break;
    case "Home":
      e.preventDefault();
      gotoPage(1);
      break;
    case "End":
      e.preventDefault();
      gotoPage(pageCount.value);
      break;
    case "+":
    case "=":
      e.preventDefault();
      if (toolState.value.zoom) setZoomRaw(zoom.value * 1.1);
      break;
    case "-":
      e.preventDefault();
      if (toolState.value.zoom) setZoomRaw(zoom.value / 1.1);
      break;
  }
}

/** 缩放模式持久化（mach-table persistence 同思路；隐私模式/SSR 静默降级） */
function persistZoom(): void {
  try {
    localStorage.setItem(
      zoomMemoryKey,
      JSON.stringify({ zoomMode: zoomMode.value === "fit" ? "fit" : Math.round(zoom.value * 100) })
    );
  } catch {
    /* localStorage 不可用时忽略 */
  }
}
watch([zoomMode, zoom], persistZoom);

/** 窗口内页 → DOM（holder 首次出现时挂载，页面级懒渲染）+ 搜索高亮 */
let lastFocusedMatch = "";
function revealSearchMatch(force = false): void {
  const activeMatch = search.activeMatch.value;
  if (!wideReport.value || !activeMatch) return;
  const matchKey = `${search.query.value}:${search.matchIndex.value}:${activeMatch.pageIndex}`;
  if (!force && matchKey === lastFocusedMatch) return;
  const holder = containerRef.value?.querySelector(`[data-page="${activeMatch.pageIndex + 1}"]`);
  const mark = holder?.querySelectorAll<HTMLElement>("mark.mrp-hit")[activeMatch.occurrence];
  if (mark) {
    mark.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    lastFocusedMatch = matchKey;
  }
}
const pageRendering = usePageRendering({
  plan, root: containerRef, pages: () => visiblePages.value,
  priority: () => search.activeMatch.value?.pageIndex ?? currentPage.value - 1,
  focusToken: () => search.activeMatch.value,
  query: () => search.query.value, zoom: () => zoom.value, loading: () => resolvedMessages.value.loading,
  clear: search.clear, highlight: search.apply,
  mounted: (holder) => { cells.refresh(holder); frozenPanes.schedule(); },
  ready: () => { if (!search.activeMatch.value) lastFocusedMatch = ""; revealSearchMatch(); },
  error: (cause) => { errorMessage.value = cause instanceof Error ? cause.message : String(cause); reportError(errorMessage.value, "render", cause); }
});

// Selection must not become a dependency of page rendering: recreating search <mark>
// nodes between two pointer clicks prevents the browser from dispatching dblclick.
watch(() => cells.selection.value, () => {
  cells.refresh();
}, { flush: "post" });

/** 查询清空时移除全部高亮标记 */
watch(() => search.query.value, (q) => {
  if (q) return;
  containerRef.value?.querySelectorAll(".mrp-page-holder").forEach((holder) => {
    search.clear(holder as HTMLElement);
  });
});

// ── 缩略图侧栏：懒渲染小画布 + 点击导航 ──
const thumbs = useThumbs(plan, {
  thumbsRoot: thumbsRef,
  visible: showThumbs,
  renderThumbCanvas: (pageIndex) => {
    try {
      const page = plan.value!.pages[pageIndex]!;
      // 画布本身限制到缩略图尺寸；超宽表不能先分配全宽位图再用 CSS 压缩。
      const dpr = Math.min(0.2, 116 / Math.max(1, page.pageWidthMm * PX_PER_MM));
      const { canvases } = renderPlanToCanvas(plan.value!, { start: pageIndex, end: pageIndex, dpr });
      return canvases[0] ?? null;
    } catch {
      return null; // 无 2D 环境（SSR/测试）：保留占位框
    }
  }
});
watchEffect(() => {
  thumbs.schedule();
}, { flush: "post" });

// ── 调试面板 ──
const debugRef = computed(() => props.debug);
const { debugStats } = useDebugPanel(debugRef, {
  plan,
  pageCount,
  windowRange,
  zoom,
  loadMs: timing.loadMs
});

function onResize(): void {
  refreshViewport(viewportRef.value);
  thumbs.schedule();
  if (zoomMode.value === "fit") applyFitZoom();
  revealSearchMatch(true);
}

function loadZoomMemory(): void {
  setZoom(zoomMemoryKey === WIDE_UI_MEMORY_KEY ? 100 : "fit");
  try {
    const saved = JSON.parse(localStorage.getItem(zoomMemoryKey) ?? "{}") as {
      zoomMode?: "fit" | number;
    };
    if (saved.zoomMode === "fit") setZoom("fit");
    else if (typeof saved.zoomMode === "number") setZoom(saved.zoomMode);
  } catch {
    /* 忽略 */
  }
}

onMounted(() => {
  window.addEventListener("resize", onResize);
  window.addEventListener("beforeunload", onBeforeUnload);
  if (typeof ResizeObserver !== "undefined" && viewportRef.value) {
    viewportObserver = new ResizeObserver(onResize);
    viewportObserver.observe(viewportRef.value);
  }
  refreshViewport(viewportRef.value);
  loadZoomMemory();
  if (props.autoLoad) void reload();
});

onUnmounted(() => {
  destroyed = true;
  calibrationPrintController?.abort();
  discard.cancel();
  task.cancel();
  editing.reset();
  importing.value = false;
  cancelFontCheck();
  reloadSeq++; // 卸载后未完成请求的成功/失败回调均失效
  loadController?.abort();
  loadController = null;
  window.removeEventListener("resize", onResize);
  window.removeEventListener("beforeunload", onBeforeUnload);
  viewportObserver?.disconnect();
  viewportObserver = null;
  thumbs.destroy();
  search.reset(); // 清防抖计时器（若挂载期间恰在防抖窗口内）
  dispose();
});

watch(
  () => [JSON.stringify(reportIds.value), JSON.stringify(props.params), effectiveFetcher.value] as const,
  async () => {
    if (props.autoLoad) {
      void reload();
      return;
    }
    if (!await discard.check("replace") || destroyed) return;
    // 手动加载模式也不能继续呈现已切换的 ID / 查询 / 数据源的旧结果。
    reloadSeq++;
    loadController?.abort();
    loadController = null;
    loading.value = false;
    errorMessage.value = "";
    lastError.value = null;
    exportNotice.value = null;
    invalidate();
  }
);

defineExpose({ ...controller, state });
</script>

<template>
  <div class="mach-report-preview" :class="{ 'mrp-wide-report': wideReport }" :style="shellStyle">
    <ReportParamPanel
      ref="paramPanelRef"
      v-if="effectiveShowParams && effectiveParamDefs.length > 0"
      :defs="effectiveParamDefs"
      :load-options="props.loadParamOptions ?? resolved.loadParamOptions"
      v-model="paramValues"
      :messages="resolvedMessages"
      :attempted="paramAttempted"
      :issues="queryParams.validation.value.issues"
      @query="onParamQuery"
      @reset="onParamReset"
    />
    <ReportToolbar
      ref="toolbarRef"
      :page-count="pageCount"
      :current-page="currentPage"
      :zoom-mode="zoomMode"
      :zoom="zoom"
      :show-export="effectiveShowExport"
      :show-print="toolState.print"
      :show-pdf-window="toolState.pdfWindow"
      :show-search="toolState.search"
      :show-thumbnails="toolState.thumbnails"
      :show-zoom="toolState.zoom"
      :export-formats="visibleExportFormats"
      :show-settings="effectiveShowSettings"
      :settings-open="settingsOpen"
      :messages="resolvedMessages"
      :search="{ visible: search.visible.value, query: search.query.value, matchIndex: search.matchIndex.value, matchCount: search.matchCount.value, searching: search.searching.value }"
      :thumbs-visible="showThumbs"
      :show-import="!!effectiveExcelImport"
      :busy="loading || importing || editing.saving.value"
      @goto="gotoPage"
      @zoom="setZoom"
      @export="(f) => exportAs(f)"
      @print="print"
      @pdf-window="openPdfWindow"
      @search-input="search.onInput"
      @search-nav="search.onNav"
      @search-toggle="search.toggle"
      @thumbs-toggle="showThumbs = !showThumbs"
      @import-excel="importInputRef?.click()"
      @settings-toggle="toggleSettings"
    >
      <template v-if="sections.length <= 1" #navigation>
        <ReportNavigation :plan="plan" compact v-if="pageCount > 0 && effectiveInteraction.navigation !== false" :sections="sections" :current-page="currentPage" :messages="resolvedMessages" :busy="loading || importing || editing.saving.value" @locate-target="locateTarget" @goto="gotoPage" @locate="locateField" />
      </template>
    </ReportToolbar>
    <ReportDiscardDialog v-if="discard.request.value" :messages="resolvedMessages" @answer="discard.settle" />
    <ReportTaskStatus :task="task.state.value" :messages="resolvedMessages" @cancel="cancelTask" />
    <ReportDiagnostics :entries="outputDiagnostics" :messages="resolvedMessages" @locate="locateDiagnostic" />
    <ReportDataExplanation :entries="dataExplanations" :messages="resolvedMessages" :busy="loading || importing || editing.saving.value" @locate="locateDataExplanation" />
    <ReportDrillActions :entries="drill.entries.value" :pending="drill.pending.value" :error="drill.error.value" :busy="loading || importing || editing.saving.value" :messages="resolvedMessages" @open="drill.open" />
    <ReportSettings v-if="settingsOpen && effectiveShowSettings" :available="availableTools" :enabled="toolState" :messages="resolvedMessages" :persisted-editing="persistedEditing" :interaction="effectiveInteraction" :section="settingsSection" :busy="loading || importing || editing.saving.value || !!exporting || printing" @section="settingsSection = $event" @interaction="sessionInteraction = { ...sessionInteraction, ...$event }" @change="onToolChange" @reset="resetTools" @close="settingsOpen = false">
      <slot name="settings" />
      <ReportPrintSettings v-if="toolState.print" :value="effectivePrintOptions.calibration ?? {}" :messages="resolvedMessages" :busy="printing || loading || importing || editing.saving.value" :can-test="canCalibratePrint" @change="localPrintCalibration = $event" @test="testPrintCalibration" />
      <template #advanced><ReportCalculationPanel :state="calculation" :messages="calculationMessages" /></template>
    </ReportSettings>
    <ReportNavigation :plan="plan" @locate-target="locateTarget" v-if="sections.length > 1 && pageCount > 0 && effectiveInteraction.navigation !== false" :sections="sections" :current-page="currentPage" :messages="resolvedMessages" :busy="loading || importing || editing.saving.value" @goto="gotoPage" @locate="locateField" />
    <ReportImportSummary v-if="importedResult" :result="importedResult" :messages="resolvedMessages" />
    <ReportEditBar v-if="effectiveEditable && pageCount > 0" :differences="editing.differences.value" :conflicts="editing.conflicts.value" :messages="resolvedMessages" :saving="editing.saving.value" :can-undo="editing.canUndo.value" :can-redo="editing.canRedo.value" :persisted="persistedEditing" :busy="!!exporting || printing" @undo="editing.undo" @redo="editing.redo" @restore="editing.restore" @locate="locateEdit" />
    <input v-if="effectiveExcelImport" ref="importInputRef" class="mrp-import-input" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden @change="onImportFile" />
    <div v-if="effectiveEditable && pageCount > 0" class="mrp-edit-hint" role="status">{{ editing.saving.value ? resolvedMessages.saving : resolvedMessages.editingHint }}</div>
    <div v-if="exportNotice" class="mrp-export-notice" :class="`mrp-export-${exportNotice.kind}`" role="alert">
      {{ exportNotice.message }}
    </div>
    <div v-if="pdfFont.status === 'error' && pdfToolsEnabled" class="mrp-export-notice mrp-export-warning" role="status">
      {{ resolvedMessages.pdfFontUnavailable }}
      <button type="button" @click="retryPdfFont">{{ resolvedMessages.retry }}</button>
    </div>
    <div class="mrp-main">
      <div
        ref="viewportRef"
        class="mrp-body"
        tabindex="0"
        @wheel="onWheel"
        @keydown="onKeydown"
        @dblclick="editing.onDoubleClick"
        @click="cells.onClick"
        @copy="cells.onCopy"
        @paste="cells.onPaste"
        @scroll.passive="onViewportScroll($event.target as HTMLElement); frozenPanes.schedule()"
      >
        <div v-if="loading" class="mrp-state">{{ resolvedMessages.loading }}</div>
        <div v-else-if="errorMessage" class="mrp-state mrp-error">
          {{ errorMessage }}
          <button class="mrp-retry" type="button" @click="reload">{{ resolvedMessages.retry }}</button>
        </div>
        <ReportEmpty v-else-if="!plan || pageCount === 0" :title="pendingRequired ? resolvedMessages.paramPrompt ?? resolvedMessages.paramsTitle : resolvedMessages.empty" :description="pendingRequired ? resolvedMessages.paramPromptDescription : emptyStateContent.description ?? resolvedMessages.emptyDescription" />
        <div
          v-else
          class="mrp-scale"
          :style="{ width: `${contentSize.w * zoom}px`, height: `${contentSize.h * zoom}px` }"
        >
          <div
            ref="containerRef"
            class="mrp-scale-inner"
            :style="{ transform: `scale(${zoom})`, transformOrigin: 'top left', width: `${contentSize.w}px` }"
          >
            <div
              v-if="windowRange.padTopPx > 0"
              class="mrp-spacer-top"
              :style="{ height: `${windowRange.padTopPx}px` }"
              aria-hidden="true"
            />
            <div
              v-for="item in visiblePages"
              :key="item.index"
              class="mrp-page-holder"
              :data-page="item.index + 1"
            />
            <div
              v-if="windowRange.padBottomPx > 0"
              class="mrp-spacer-bottom"
              :style="{ height: `${windowRange.padBottomPx}px` }"
              aria-hidden="true"
            />
          </div>
        </div>
        <ReportEmpty v-if="!loading && !errorMessage && plan && pageCount > 0 && emptyState" :title="emptyStateContent.title ?? resolvedMessages.empty" :description="emptyStateContent.description ?? resolvedMessages.emptyDescription" />
      </div>
      <aside v-if="toolState.thumbnails && showThumbs && pageCount > 0" ref="thumbsRef" class="mrp-thumbs" @scroll.passive="thumbs.onScroll">
        <div v-if="thumbs.windowRange.value.padTopPx > 0" class="mrp-thumb-spacer" :style="{ height: `${thumbs.windowRange.value.padTopPx}px` }" aria-hidden="true" />
        <button
          v-for="item in thumbs.visibleThumbs.value"
          :key="item.index"
          class="mrp-thumb"
          type="button"
          :aria-label="`${resolvedMessages.thumbnails} · ${resolvedMessages.pageInfo.replace('{cur}', String(item.index + 1)).replace('{total}', String(pageCount))}`"
          :aria-current="item.index + 1 === currentPage ? 'page' : undefined"
          :style="{ height: `${item.height + 20}px` }"
          :class="{ 'mrp-thumb-active': item.index + 1 === currentPage }"
          @click="gotoPage(item.index + 1)"
        >
          <span
            class="mrp-thumb-box"
            :data-thumb="item.index + 1"
            :style="{ height: `${item.height}px` }"
          />
          <span class="mrp-thumb-no">{{ item.index + 1 }}</span>
        </button>
        <div v-if="thumbs.windowRange.value.padBottomPx > 0" class="mrp-thumb-spacer" :style="{ height: `${thumbs.windowRange.value.padBottomPx}px` }" aria-hidden="true" />
      </aside>
    </div>
    <footer v-if="pageCount > 0" class="mrp-footer">
      <div class="mrp-footer-context">
        <ReportRecordNavigation v-if="effectiveInteraction.navigation !== false" :plan="plan" :current-page="currentPage" :messages="resolvedMessages" :busy="loading || importing || editing.saving.value" @goto="gotoPage" />
        <button v-if="calculationsEnabled && effectiveShowSettings" class="mrp-calculation-toggle" type="button" :aria-label="calculationMessages.calculationTitle" @click="openCalculations"><span aria-hidden="true">∑</span>{{ calculationMessages.calculationTitle }}<strong v-if="calculation.result.value">{{ calculation.result.value.formatted }}</strong></button>
      </div>
      <ReportPagination :page-count="pageCount" :current-page="currentPage" :messages="resolvedMessages" :busy="loading || importing || editing.saving.value" @goto="gotoPage" />
    </footer>
    <!-- 默认插槽（overlay 层）：自定义操作按钮/状态徽标 -->
    <div class="mrp-overlay">
      <slot />
    </div>
    <div v-if="debugStats" class="mrp-debug" aria-hidden="true">
      <div>mach-report debug</div>
      <div>pages: {{ debugStats.pages }} | window: [{{ debugStats.window }}]</div>
      <div>zoom: {{ debugStats.zoom }} | load: {{ debugStats.loadMs }}</div>
      <div>plan: {{ debugStats.planKB }}KB</div>
    </div>
  </div>
</template>

<style scoped src="./preview.css"></style>
