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
import type { RenderPlan, ReportCellEdit, AssetRenderOptions } from "@agile-team/mach-report";
import {
  renderPlanToCanvas
} from "@agile-team/mach-report";
import { normalizeReportIds, type PlanFetcher } from "./adapters";
import { usePageWindow } from "./composables/usePageWindow";
import { usePageRendering } from "./composables/usePageRendering";
import { useZoom } from "./composables/useZoom";
import { usePreviewOutput } from "./composables/usePreviewOutput";
import { clearHighlights, highlightTextNodes } from "./composables/useHighlight";
import {
  useDebugPanel,
  useReportSearch,
  useThumbs
} from "./composables/useReportSearch";
import ReportToolbar from "./ReportToolbar.vue";
import ReportDataTools from "./ReportDataTools.vue";
import ReportDataReviewDialog from "./ReportDataReviewDialog.vue";
import ReportPrefillPanel from "./ReportPrefillPanel.vue";
import ReportDataComparison from "./ReportDataComparison.vue";
import ReportValidationPanel from "./ReportValidationPanel.vue";
import { usePreviewDataReview } from "./composables/usePreviewDataReview";
import type { ReportPrefillReviewOptions, ReportDataComparisonReviewOptions } from "./data-review";
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
import type { ReportExportExecutionOptions } from "../worker/auto-types";
import type { ReportParamOptionsLoader } from "./param-options";
import ReportPrintSettings from "./ReportPrintSettings.vue";
import type { ReportPrintOptions } from "./print-options";
import type { ReportDataTarget } from "../source/data-explanation";
import { usePreviewFont } from "./composables/usePreviewFont";
import { usePreviewEditing } from "./composables/usePreviewEditing";
import { usePreviewTask } from "./composables/usePreviewTask";
import { usePreviewDiagnostics } from "./composables/usePreviewDiagnostics";
import type { ReportBeforeDiscard, ReportOutputOptions, ReportPreviewTask, ReportPreviewDiagnostic } from "./guards";
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

import { MachReportError, type MachReportErrorCode } from "./errors";
import type { MachReportController, MachReportState, MachReportStateError } from "./controller";
import type { ReportEditingOptions } from "./editing";
import type { ExcelImportOptions, ExcelImportResult } from "../xlsx/import-types";
import { cloneReportSnapshot } from "./snapshot";
import { usePreviewConfiguration } from "./composables/usePreviewConfiguration";
import { type ReportFieldTarget } from "./composables/useCellSelection";
import { useFrozenPanes } from "./composables/useFrozenPanes";
import { useReportParams } from "./composables/useReportParams";
import { usePreviewSession } from "./composables/usePreviewSession";
import { type MachReportToolbarOptions, type ReportEmptyState, type ReportPreviewPreferences, type ReportPreviewTool, type ReportInteractionOptions, type ReportPreferencesOptions, type ReportSection } from "./tools";

const props = defineProps({
  prefill: { type: [Boolean, Object] as PropType<ReportPrefillReviewOptions | false>, default: undefined },
  dataComparison: { type: [Boolean, Object] as PropType<ReportDataComparisonReviewOptions | false>, default: undefined },
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
  exportExecution: { type: Object as PropType<ReportExportExecutionOptions>, default: undefined },
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

const errorMessage = ref("");
const lastError = shallowRef<Readonly<MachReportStateError> | null>(null);

const exportNotice = ref<{ kind: "error" | "warning" | "progress"; message: string } | null>(null);
const currentPage = ref(1);
const containerRef = ref<HTMLElement | null>(null);
const viewportRef = ref<HTMLElement | null>(null);
const thumbsRef = ref<HTMLElement | null>(null);
const showThumbs = ref(false);
const settingsOpen = ref(false);
const settingsSection = ref<"general" | "tools" | "advanced">("general");
const importInputRef = ref<HTMLInputElement | null>(null);
const toolbarRef = ref<InstanceType<typeof ReportToolbar> | null>(null);
let viewportObserver: ResizeObserver | null = null;
let destroyed = false;
const task = usePreviewTask((value) => emit("task", value));
const diagnostics = usePreviewDiagnostics((value) => emit("diagnostic", value));
const dataExplanations = computed(() => diagnostics.entries.value.filter(entry => entry.valueState && entry.target));
const outputDiagnostics = computed(() => diagnostics.entries.value.filter(entry => !entry.valueState));

const session = usePreviewSession({
  source: { ids: () => reportIds.value, fetcher: () => effectiveFetcher.value, readParams: () => paramMetadata.value.error ? { error: paramMetadata.value.error, quiet: false } : queryParams.query(), invalidParams: () => { if (!paramMetadata.value.error) paramAttempted.value = true; } },
  policy: { guard: reason => effectiveGuardChanges.value && editing.pendingLocalChanges.value ? discard.check(reason) : true, assets: () => effectiveAssets.value, importOptions: () => effectiveExcelImport.value, importingMessage: () => resolvedMessages.value.importing },
  feedback: { errorMessage, lastError, notice: exportNotice, reportError }, task, diagnostics,
  view: {
    invalidate: () => { editing.reset(); cells.reset(); output.invalidate(); currentPage.value = 1; search.reset(); },
    beforeImport: () => { editing.cancel(); output.invalidatePending(); },
    accepted: kind => {
      currentPage.value = 1;
      if (viewportRef.value) { viewportRef.value.scrollTop = 0; viewportRef.value.scrollLeft = 0; }
      const nextMemoryKey = wideReport.value ? WIDE_UI_MEMORY_KEY : UI_MEMORY_KEY;
      if (kind === "import" || nextMemoryKey !== zoomMemoryKey) { zoomMemoryKey = nextMemoryKey; loadZoomMemory(); }
      if (kind === "query" && zoomMode.value === "fit") applyFitZoom();
    }
  },
  events: { warning: message => emit("warning", message), logWarning: message => resolved.value.logger.warn("[mach-report] 报表告警:", message), loaded: count => emit("loaded", count), imported: result => emit("template-import", result) }
});
const { plan, loading, importing, importedResult, loadedContext, timing, reload, importExcel } = session;

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
const pdfToolsEnabled = computed(() => toolState.value.pdf || toolState.value.pdfWindow);
const effectivePrefill = computed(() => props.prefill ?? resolved.value.prefill);
const effectiveDataComparison = computed(() => props.dataComparison ?? resolved.value.dataComparison);
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
const { editing, cells, discard, confirmDiscard } = usePreviewEditing({
  plan, root: containerRef, options: effectiveEditable,
  selectionEnabled: () => !!effectiveEditable.value || calculationsEnabled.value || !!effectiveDataComparison.value || !!(props.drill ?? resolved.value.drill),
  busy: () => loading.value || importing.value || exporting.value !== null || printing.value,
  messages: () => resolvedMessages.value, gotoPage, ensureVisible: address => pageRendering.reveal(address),
  guard: {
    reportIds: () => loadedContext.value?.reportIds ?? reportIds.value,
    hook: () => props.beforeDiscard ?? resolved.value.beforeDiscard,
    enabled: () => effectiveGuardChanges.value,
    error: cause => reportError(cause instanceof Error ? cause.message : "修改保护回调失败", "config", cause)
  },
  changed: edit => { lastError.value = null; exportNotice.value = null; emit("cell-edit", edit); },
  failed: (message, cause) => { exportNotice.value = { kind: "error", message }; reportError(message, "edit", cause); }
});
const output = usePreviewOutput({
  plan, editing, diagnostics, task,
  busy: () => loading.value || importing.value, wide: () => wideReport.value,
  defaultsPrint: () => resolved.value.printOptions, printOverrides: () => props.printOptions,
  messages: () => resolvedMessages.value, fidelity: () => effectiveOutput.value.fidelity,
  execution: () => props.exportExecution ?? resolved.value.exportExecution,
  getPdfExporter, getXlsxOptions: () => resolved.value.xlsx,
  feedback: { lastError, notice: exportNotice, reportError, warning: message => emit("warning", message) }
});
const { exporting, printing, localPrintCalibration, effectivePrintOptions, canCalibratePrint,
  testPrintCalibration, print, exportAs, openPdfWindow, getOutputDiagnostics } = output;

const dataReview = usePreviewDataReview({
  plan, prefill: effectivePrefill, comparison: effectiveDataComparison, editingOptions: effectiveEditable,
  issues: editing.validationIssues, messages: resolvedMessages,
  busy: () => loading.value || importing.value || editing.saving.value || !!exporting.value || printing.value,
  replacing: () => loading.value || importing.value,
  settle: editing.settle, apply: editing.apply, editError: () => editing.lastError.value,
  locate: address => { void cells.focusCell(address); },
  missing: () => { exportNotice.value = { kind: "warning", message: resolvedMessages.value.locateFieldMissing ?? "Field not found" }; },
  error: (message, cause) => reportError(message, "edit", cause)
});
const calculation = useSelectionCalculation({ plan, selection: cells.selection, enabled: () => calculationsEnabled.value });
function openCalculations(): void { void toggleSettings("advanced"); }
const drill = useReportDrill({
  plan, selection: cells.selection,
  options: () => props.drill ?? resolved.value.drill,
  params: () => ({ ...loadedContext.value?.params }),
  view: () => ({ zoom: zoom.value, scrollTop: containerRef.value?.scrollTop ?? 0, scrollLeft: containerRef.value?.scrollLeft ?? 0 }),
  messages: () => resolvedMessages.value,
  busy: () => loading.value || importing.value || editing.saving.value || !!exporting.value || printing.value,
  beforeOpen: () => confirmDiscard("leave")
});
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
  plan, root: containerRef, viewport: viewportRef, pages: () => visiblePages.value,
  windowing: () => !effectiveInteraction.value.freezeHeaders && !(effectiveInteraction.value.frozenColumns ?? 0),
  priority: () => search.activeMatch.value?.pageIndex ?? currentPage.value - 1,
  focusToken: () => search.activeMatch.value, editorToken: () => editing.active.value,
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
  pageRendering.refreshViewport();
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
  task.cancel();
  importing.value = false;
  cancelFontCheck();
  window.removeEventListener("resize", onResize);
  viewportObserver?.disconnect();
  viewportObserver = null;
  thumbs.destroy();
  search.reset(); // 清防抖计时器（若挂载期间恰在防抖窗口内）
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
    session.clear();
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
      <template #data-tools><ReportDataTools :prefill="dataReview.availablePrefill.value" :comparison="dataReview.availableComparison.value" :issue-count="editing.validationIssues.value.length" :messages="dataReview.messages.value" :busy="loading || importing || editing.saving.value || !!exporting || printing" @open="dataReview.open" /></template>
      <template v-if="sections.length <= 1" #navigation>
        <ReportNavigation :plan="plan" compact v-if="pageCount > 0 && effectiveInteraction.navigation !== false" :sections="sections" :current-page="currentPage" :messages="resolvedMessages" :busy="loading || importing || editing.saving.value" @locate-target="locateTarget" @goto="gotoPage" @locate="locateField" />
      </template>
    </ReportToolbar>
    <ReportDataReviewDialog v-if="dataReview.opened.value" :title="dataReview.title.value" :close-label="dataReview.messages.value.reviewClose" @close="dataReview.close">
      <ReportPrefillPanel v-if="dataReview.opened.value === 'prefill'" :state="dataReview.prefill" :messages="dataReview.messages.value" />
      <ReportDataComparison v-else-if="dataReview.opened.value === 'comparison'" :state="dataReview.comparison" :messages="dataReview.messages.value" />
      <ReportValidationPanel v-else :issues="editing.validationIssues.value" :messages="dataReview.validationMessages.value" @locate="dataReview.locateIssue" />
    </ReportDataReviewDialog>
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
        @scroll.passive="onViewportScroll($event.target as HTMLElement); pageRendering.refreshViewport(); frozenPanes.refresh()"
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
