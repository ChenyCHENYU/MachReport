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
import type { RenderPlan, PlanPage, ReportCellEdit, AssetRenderOptions } from "@agile-team/mach-report";
import {
  renderPage as renderPageToDom,
  renderPlanToCanvas,
  paginateTemplate,
  ReportCellEditError,
  validateRenderPlan
} from "@agile-team/mach-report";
import { normalizeReportIds, type PlanFetcher } from "./adapters";
import { usePageWindow } from "./composables/usePageWindow";
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
import ReportSettings from "./ReportSettings.vue";
import ReportEmpty from "./ReportEmpty.vue";
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
  resolveConfig,
  themeToCssVars,
  useMachReportConfig,
  type MachReportMessages
} from "./config";
import { createDefaultPdfExporter, type PdfExporter, type PdfFontCheckResult } from "./pdf-exporter";
import { MachReportError, normalizeReportLoadError, toErrorDetail, type MachReportErrorCode } from "./errors";
import type { MachReportController, MachReportState, MachReportStateError } from "./controller";
import type { ReportEditingOptions } from "./editing";
import type { ExcelImportOptions, ExcelImportResult } from "../xlsx/import-types";
import { useCellEditing } from "./composables/useCellEditing";
import { cloneReportSnapshot } from "./snapshot";
import { usePreviewTools } from "./composables/usePreviewTools";
import { useCellSelection } from "./composables/useCellSelection";
import { useFrozenPanes } from "./composables/useFrozenPanes";
import { useReportParams } from "./composables/useReportParams";
import { prepareReportAssets } from "./assets";
import { REPORT_EXPORT_FORMATS, type MachReportToolbarOptions, type ReportEmptyState, type ReportPreviewPreferences, type ReportPreviewTool, type ReportInteractionOptions, type ReportPreferencesOptions, type ReportSection } from "./tools";

const props = defineProps({
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
  assets: { type: Object as PropType<AssetRenderOptions>, default: undefined },
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
const pdfFont = shallowRef<Readonly<PdfFontCheckResult>>(Object.freeze({ status: "unchecked", fontUrl: "" }));
const exportNotice = ref<{ kind: "error" | "warning" | "progress"; message: string } | null>(null);
const currentPage = ref(1);
const containerRef = ref<HTMLElement | null>(null);
const viewportRef = ref<HTMLElement | null>(null);
const thumbsRef = ref<HTMLElement | null>(null);
const showThumbs = ref(false);
const importing = ref(false);
const settingsOpen = ref(false);
const importedResult = shallowRef<Pick<ExcelImportResult, "sheets" | "warnings"> | null>(null);
const sessionInteraction = ref<ReportInteractionOptions>({});
const importInputRef = ref<HTMLInputElement | null>(null);
const toolbarRef = ref<InstanceType<typeof ReportToolbar> | null>(null);
const timing = useLoadTiming();

const wideReport = computed(() => !!plan.value?.pages.length && plan.value.pages.every((page) => page.layout === "wide"));
const PAGE_GAP_PX = computed(() => Math.max(0, effectiveGapPx.value));
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
  canUndo: editing.canUndo.value,
  canRedo: editing.canRedo.value,
  changeCount: editing.differences.value.length,
  selection: cells.selection.value ? cloneReportSnapshot(cells.selection.value) : null
}));

function reportError(message: string, code: MachReportErrorCode, cause?: unknown): void {
  lastError.value = Object.freeze({ message, code, cause });
  emit("error", message, { code, cause });
}

/** 配置解析：preset > 应用级 defaults；未配置时全部落到内置缺省 */
const configRef = useMachReportConfig();
const resolved = computed(() => resolveConfig(configRef.value, props.preset));
const resolvedMessages = computed<MachReportMessages>(() => ({
  ...resolved.value.messages,
  ...props.messages
}));
/** 组件 props 拥有最高优先级（对齐 mach-table 配置中心的优先级约定） */
const effectiveShowExport = computed(() => props.showExport ?? resolved.value.showExport);
const effectiveShowPrint = computed(() => props.showPrint ?? resolved.value.showPrint);
const effectiveShowPdfWindow = computed(() => props.showPdfWindow ?? resolved.value.showPdfWindow);
const effectiveShowSettings = computed(() => props.showSettings ?? resolved.value.showSettings);
const toolbarOptions = computed(() => ({ ...resolved.value.toolbar, ...props.toolbar }));
const effectiveInteraction = computed(() => ({ ...resolved.value.interaction, ...props.interaction, ...sessionInteraction.value }));
const effectivePreferences = computed(() => props.preferences ?? resolved.value.preferences);
const effectiveAssets = computed(() => props.assets ?? resolved.value.assets);
const effectiveGapPx = computed(() => props.gapPx ?? (wideReport.value ? 0 : resolved.value.gapPx));
const effectiveShowParams = computed(() => props.showParams ?? resolved.value.showParams);
const availableEditable = computed(() => props.editable ?? resolved.value.editable);
const availableExcelImport = computed(() => props.excelImport ?? resolved.value.excelImport);
const availableTools = computed<ReportPreviewPreferences>(() => ({
  search: toolbarOptions.value.search !== false,
  thumbnails: toolbarOptions.value.thumbnails !== false,
  zoom: toolbarOptions.value.zoom !== false,
  ...Object.fromEntries(REPORT_EXPORT_FORMATS.map((format) => [format,
    effectiveShowExport.value && (toolbarOptions.value.exportFormats?.includes(format) ?? true)
  ])) as Record<typeof REPORT_EXPORT_FORMATS[number], boolean>,
  print: effectiveShowPrint.value,
  pdfWindow: effectiveShowPdfWindow.value,
  editing: !!availableEditable.value,
  import: !!availableExcelImport.value
}));
const tools = usePreviewTools(availableTools, computed(() => ({
  editing: toolbarOptions.value.editing,
  import: toolbarOptions.value.excelImport
})), effectivePreferences, () => emit("warning", resolvedMessages.value.preferencesError ?? "Preferences storage unavailable"));
const toolState = tools.enabled;
const visibleExportFormats = computed(() => REPORT_EXPORT_FORMATS.filter((format) => toolState.value[format]));
const effectiveEditable = computed(() => toolState.value.editing ? availableEditable.value : false);
const effectiveExcelImport = computed(() => toolState.value.import ? availableExcelImport.value : false);
const persistedEditing = computed(() => typeof availableEditable.value === "object" && (typeof availableEditable.value.save === "function" || typeof availableEditable.value.saveBatch === "function"));
const emptyStateContent = computed(() => typeof props.emptyState === "object" ? props.emptyState : {});

async function onToolChange(key: ReportPreviewTool, enabled: boolean): Promise<void> {
  // 不因隐藏编辑工具丢弃输入；验证或保存失败时保留编辑能力和原值。
  if (key === "editing" && !enabled && !await editing.commit()) return;
  tools.setEnabled(key, enabled);
  emit("preferences-change", Object.freeze({ ...toolState.value }));
}

async function resetTools(): Promise<void> {
  if (!await editing.commit()) return;
  tools.reset();
  sessionInteraction.value = {};
  emit("preferences-change", Object.freeze({ ...toolState.value }));
}
async function toggleSettings(): Promise<void> {
  if (settingsOpen.value) { settingsOpen.value = false; return; }
  // Wait for the active editor before moving focus into an aria-modal dialog.
  // A rejected save must keep both the input and its focus available for correction.
  if (!await editing.commit() || destroyed || !effectiveShowSettings.value) return;
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
  blocked: () => loading.value || importing.value || exporting.value !== null || printing.value,
  label: () => resolvedMessages.value.editCell ?? "编辑单元格",
  errorMessage: editErrorMessage,
  onChange: (edit) => { lastError.value = null; exportNotice.value = null; emit("cell-edit", edit); },
  onError: (message, cause) => {
    exportNotice.value = { kind: "error", message };
    reportError(message, "edit", cause);
  },
  onNavigate: (address, key, backwards) => cells.navigate(address, key, backwards)
});
const cells = useCellSelection({
  plan, root: containerRef,
  enabled: () => !!effectiveEditable.value,
  busy: () => loading.value || importing.value || editing.saving.value || !!exporting.value || printing.value,
  differences: () => editing.differences.value,
  gotoPage, edit: editing.editCell, apply: editing.apply, undo: editing.undo, redo: editing.redo,
  error: (cause) => { const message = editErrorMessage(cause); exportNotice.value = { kind: "error", message }; reportError(message, "edit", cause); }
});
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
let cachedPdfFontUrl: string | null = null;
let cachedPdfExporter: PdfExporter | null = null;
function getPdfExporter(): PdfExporter {
  if (injectedPdfExporter) return injectedPdfExporter;
  const fontUrl = resolved.value.pdfFontUrl;
  if (!cachedPdfExporter || cachedPdfFontUrl !== fontUrl) {
    cachedPdfFontUrl = fontUrl;
    cachedPdfExporter = createDefaultPdfExporter({ fontUrl });
  }
  return cachedPdfExporter;
}

let fontCheckSeq = 0;
let fontCheckController: AbortController | null = null;
let viewportObserver: ResizeObserver | null = null;
let destroyed = false;

function cancelFontCheck(): void {
  fontCheckSeq++;
  fontCheckController?.abort();
  fontCheckController = null;
}

/** 检查失败只影响 PDF 诊断，不阻塞预览或其它输出。 */
async function checkPdfFont(): Promise<PdfFontCheckResult> {
  if (destroyed) throw new MachReportError("config", "报表预览已卸载");
  cancelFontCheck();
  const seq = fontCheckSeq;
  const controller = new AbortController();
  fontCheckController = controller;
  const fontUrl = resolved.value.pdfFontUrl;
  pdfFont.value = Object.freeze({ status: "checking", fontUrl });
  try {
    const exporter = getPdfExporter();
    const result: PdfFontCheckResult = exporter.checkFont
      ? await exporter.checkFont(controller.signal)
      : { status: "unverified", fontUrl: "", message: "自定义 PDF 导出器未提供字体预检查；字体由宿主确认" };
    if (!destroyed && seq === fontCheckSeq && !controller.signal.aborted) pdfFont.value = Object.freeze({ ...result });
    return result;
  } catch (cause) {
    if (controller.signal.aborted) throw cause;
    const result: PdfFontCheckResult = {
      status: "error", fontUrl,
      message: cause instanceof Error ? cause.message : "PDF 字体检查失败", cause
    };
    if (!destroyed && seq === fontCheckSeq) pdfFont.value = Object.freeze(result);
    return result;
  } finally {
    if (fontCheckController === controller) fontCheckController = null;
  }
}

function retryPdfFont(): void {
  void checkPdfFont().catch(() => { /* 切换或卸载的取消由生命周期处理。 */ });
}

watch(
  [plan, () => resolved.value.pdfFontUrl, effectiveShowExport, effectiveShowPdfWindow],
  () => {
    const sameUrl = pdfFont.value.fontUrl === resolved.value.pdfFontUrl;
    if (sameUrl && pdfFont.value.status === "available") return;
    cancelFontCheck();
    if (!sameUrl || pdfFont.value.status === "checking") {
      pdfFont.value = Object.freeze({ status: "unchecked", fontUrl: resolved.value.pdfFontUrl });
    }
    if (!destroyed && pageCount.value > 0 && (effectiveShowExport.value || effectiveShowPdfWindow.value)) {
      void checkPdfFont().catch(() => { /* 取消时不报告过期诊断。 */ });
    }
  },
  { immediate: true }
);

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
  importing.value = false;
  editing.reset();
  cells.reset();
  importedResult.value = null;
  releasePrintFrame();
  plan.value = null;
  currentPage.value = 1;
  search.reset();
}

/** 代际令牌：报表 ID 快速切换时，旧请求即使后返回也不得覆盖新数据 */
let reloadSeq = 0;
let loadController: AbortController | null = null;

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
  const reportedWarnings = new Set<string>();
  function reportWarning(message: string): void {
    if (seq !== reloadSeq || controller.signal.aborted || reportedWarnings.has(message)) return;
    reportedWarnings.add(message);
    resolved.value.logger.warn("[mach-report] 报表告警:", message);
    emit("warning", message);
  }
  try {
    let next = await fetcher({
      reportIds: reportIds.value,
      params,
      signal: controller.signal,
      onWarning: reportWarning
    });
    if (seq !== reloadSeq) return;
    const check = validateRenderPlan(next);
    if (!check.ok) {
      const head = check.errors
        .slice(0, 3)
        .map((e) => `${e.path}: ${e.message}`)
        .join("; ");
      throw new MachReportError(
        "validate",
        `渲染计划校验失败(${check.errors.length} 处): ${head}`
      );
    }
    check.warnings.forEach((warning) => reportWarning(`${warning.path}: ${warning.message}`));
    // warning 处理器可能同步发起下一次查询；回到本次调用时必须重新核对代际。
    if (seq !== reloadSeq || controller.signal.aborted) return;
    next = await prepareReportAssets(next, effectiveAssets.value, controller.signal, reportWarning);
    if (seq !== reloadSeq || controller.signal.aborted) return;
    plan.value = next;
    currentPage.value = 1;
    timing.end(t0);
    if (viewportRef.value) {
      viewportRef.value.scrollTop = 0;
      viewportRef.value.scrollLeft = 0;
    }
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
  vp.scrollTop = pageWindow.pageOffsetPx(target - 1) * zoom.value;
  // 程序化翻页即刻更新窗口；无需等待浏览器异步 scroll 事件才挂载目标页。
  refreshViewport(vp);
}

const exportApi = usePrintExport(plan, {
  getPdfExporter,
  getXlsxOptions: () => resolved.value.xlsx,
  onError: (message, code) => {
    exportNotice.value = { kind: "error", message };
    reportError(message, (code ?? "print") as MachReportErrorCode);
  },
  onWarning: (message) => {
    exportNotice.value = { kind: "warning", message };
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
async function print(): Promise<void> {
  if (loading.value || importing.value) return;
  if (editing.active.value && !await editing.commit()) return;
  lastError.value = null;
  await exportApi.print();
}
async function exportAs(format: string): Promise<void> {
  if (loading.value || importing.value) return;
  if (editing.active.value && !await editing.commit()) return;
  lastError.value = null;
  await exportApi.exportAs(format);
}
function openPdfWindow(): void {
  if (loading.value || importing.value || editing.active.value) {
    exportNotice.value = { kind: "warning", message: resolvedMessages.value.editingHint ?? "请先确认单元格修改" };
    return;
  }
  lastError.value = null;
  exportApi.openPdfWindow();
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

/** Import is an explicit local replacement; business mapping/storage remains in the host. */
async function importExcel(input: ArrayBuffer | Uint8Array | Blob, options?: ExcelImportOptions): Promise<ExcelImportResult | null> {
  if (destroyed) throw new MachReportError("config", "报表预览已卸载");
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
  try {
    const { importExcelTemplate } = await import("@agile-team/mach-report/xlsx");
    if (seq !== reloadSeq) return null;
    const result = await importExcelTemplate(input, mergeExcelImportOptions(options));
    if (seq !== reloadSeq) return null;
    let next = paginateTemplate(cloneReportSnapshot(result.template), {}).plan;
    const check = validateRenderPlan(next);
    if (!check.ok) throw new Error(check.errors.map((error) => error.message).slice(0, 3).join("; "));
    next = await prepareReportAssets(next, effectiveAssets.value, controller.signal, (message) => { if (seq === reloadSeq) emit("warning", message); });
    for (const message of result.warnings) {
      if (seq !== reloadSeq) return null;
      emit("warning", message);
    }
    if (seq !== reloadSeq) return null;
    editing.reset();
    cells.reset();
    releasePrintFrame();
    search.reset();
    plan.value = next;
    importedResult.value = { sheets: cloneReportSnapshot(result.sheets), warnings: [...result.warnings] };
    currentPage.value = 1;
    errorMessage.value = "";
    exportNotice.value = result.warnings.length ? { kind: "warning", message: result.warnings.join("；") } : null;
    if (viewportRef.value) { viewportRef.value.scrollTop = 0; viewportRef.value.scrollLeft = 0; }
    zoomMemoryKey = wideReport.value ? WIDE_UI_MEMORY_KEY : UI_MEMORY_KEY;
    loadZoomMemory();
    emit("template-import", result);
    if (seq === reloadSeq) emit("loaded", next.pages.length);
    return result;
  } catch (cause) {
    if (seq !== reloadSeq) return null;
    const error = new MachReportError("import", cause instanceof Error ? cause.message : "Excel 模板导入失败", cause);
    exportNotice.value = { kind: "error", message: error.message };
    reportError(error.message, "import", cause);
    throw error;
  } finally {
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
const renderedPages = new WeakMap<HTMLElement, PlanPage>();
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
watch([plan, () => search.activeMatch.value, () => search.matchIndex.value, () => search.query.value, visiblePages, containerRef], () => {
  const current = plan.value;
  if (!current) return;
  const activeMatch = search.activeMatch.value;
  void search.matchIndex.value;
  if (!activeMatch) lastFocusedMatch = "";
  // 跟踪窗口本身；DOM 查询不会收集依赖，滚动新增 holder 也必须实际渲染。
  void visiblePages.value;
  const scaleEl = containerRef.value;
  if (!scaleEl) return;
  const holders = scaleEl.querySelectorAll<HTMLElement>(".mrp-page-holder");
  holders.forEach((holder) => {
    const index = Number(holder.dataset.page ?? 0) - 1;
    const page = current.pages[index];
    if (!page || (holder.childElementCount > 0 && renderedPages.get(holder) === page)) {
      // 已挂载页：查询变化时先清旧高亮再套新查询（避免"钢"→"钢板"嵌套残留）
      if (holder.firstElementChild) {
        const el = holder.firstElementChild as HTMLElement;
        search.clear(el);
        search.apply(el);
      }
      return;
    }
    holder.style.width = `${page.pageWidthMm * PX_PER_MM}px`;
    const pageEl = renderPageToDom(page, 96, {}, document);
    search.apply(pageEl);
    holder.replaceChildren(pageEl);
    renderedPages.set(holder, page);
  });
  revealSearchMatch();
  cells.refresh();
  frozenPanes.refresh();
}, { flush: "post", immediate: true });

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
  editing.reset();
  importing.value = false;
  cancelFontCheck();
  reloadSeq++; // 卸载后未完成请求的成功/失败回调均失效
  loadController?.abort();
  loadController = null;
  window.removeEventListener("resize", onResize);
  viewportObserver?.disconnect();
  viewportObserver = null;
  thumbs.destroy();
  search.reset(); // 清防抖计时器（若挂载期间恰在防抖窗口内）
  dispose();
});

watch(
  () => [JSON.stringify(reportIds.value), JSON.stringify(props.params), effectiveFetcher.value] as const,
  () => {
    if (props.autoLoad) {
      void reload();
      return;
    }
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
    />
    <ReportSettings v-if="settingsOpen && effectiveShowSettings" :available="availableTools" :enabled="toolState" :messages="resolvedMessages" :persisted-editing="persistedEditing" :interaction="effectiveInteraction" :busy="loading || importing || editing.saving.value || !!exporting || printing" @interaction="sessionInteraction = { ...sessionInteraction, ...$event }" @change="onToolChange" @reset="resetTools" @close="settingsOpen = false">
      <slot name="settings" />
    </ReportSettings>
    <ReportNavigation v-if="pageCount > 0 && effectiveInteraction.navigation !== false" :sections="sections" :current-page="currentPage" :messages="resolvedMessages" :busy="loading || importing || editing.saving.value" @goto="gotoPage" @locate="locateField" />
    <ReportImportSummary v-if="importedResult" :result="importedResult" :messages="resolvedMessages" />
    <ReportEditBar v-if="effectiveEditable && pageCount > 0" :differences="editing.differences.value" :conflicts="editing.conflicts.value" :messages="resolvedMessages" :saving="editing.saving.value" :can-undo="editing.canUndo.value" :can-redo="editing.canRedo.value" :persisted="persistedEditing" :busy="!!exporting || printing" @undo="editing.undo" @redo="editing.redo" @restore="editing.restore" @locate="cells.focusCell($event.address)" />
    <input v-if="effectiveExcelImport" ref="importInputRef" class="mrp-import-input" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden @change="onImportFile" />
    <div v-if="effectiveEditable && pageCount > 0" class="mrp-edit-hint" role="status">{{ editing.saving.value ? resolvedMessages.saving : resolvedMessages.editingHint }}</div>
    <div v-if="exportNotice" class="mrp-export-notice" :class="`mrp-export-${exportNotice.kind}`" role="alert">
      {{ exportNotice.message }}
    </div>
    <div v-if="pdfFont.status === 'error' && (effectiveShowExport || effectiveShowPdfWindow)" class="mrp-export-notice mrp-export-warning" role="status">
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

<style scoped>
.mach-report-preview {
  /* 主题变量默认值：配置中心 theme / 宿主 CSS 覆写均可接管 */
  --mrp-shell-bg: #525659;
  --mrp-shell-fg: #e8e8e8;
  --mrp-toolbar-bg: #323639;
  --mrp-toolbar-border: #22252a;
  --mrp-toolbar-fg: #e8e8e8;
  --mrp-btn-fg: #cfcfcf;
  --mrp-btn-border: #4a4d52;
  --mrp-btn-hover-bg: #414549;
  --mrp-btn-hover-fg: #ffffff;
  --mrp-btn-active-bg: #2d5fb8;

  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--mrp-shell-bg);
  color: var(--mrp-shell-fg);
  overflow: hidden;
}
.mrp-main { display: flex; flex: 1; min-height: 0; }
.mrp-body {
  flex: 1;
  min-width: 0;
  overflow: auto;
  padding: 24px;
  outline: none; /* 键盘交互容器聚焦不带轮廓 */
}
/* 缩放容器：外层按缩放后尺寸占位，内层 transform 缩放（零重排） */
.mrp-scale { position: relative; margin: 0 auto; }
.mrp-scale-inner { position: absolute; left: 0; top: 0; display: flex; flex-direction: column; align-items: center; }
.mrp-page-holder {
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  margin-bottom: v-bind("PAGE_GAP_PX + 'px'");
  flex: none;
}
/* 宽表的纵向分段只是渲染窗口，不再用纸张阴影和页间留白打断表格。 */
.mrp-wide-report .mrp-page-holder { box-shadow: none; }
.mrp-state {
  padding: 40px;
  text-align: center;
  color: #bfbfbf;
  font-size: 13px;
}
.mrp-error { color: #ff9d9d; }
.mrp-edit-hint { padding: 5px 12px; font-size: 12px; color: var(--mrp-shell-fg); }
.mrp-body :deep(.mrp-cell-selected) { background-image: linear-gradient(#2563eb12, #2563eb12); }
.mrp-body :deep(.mrp-cell-focus) { outline: 2px solid #2563eb; outline-offset: -2px; z-index: 8 !important; }
.mrp-body :deep(.mrp-cell-modified)::after { content: ""; position: absolute; right: 0; top: 0; border-top: 6px solid #d58916; border-left: 6px solid transparent; }
.mrp-body :deep(.mrp-cell-frozen) { background-color: #fff; box-shadow: 1px 0 0 #aeb8c6, 0 1px 0 #aeb8c6; }
.mrp-export-notice { padding: 7px 12px; font-size: 12px; background: #fff0c2; color: #613c00; }
.mrp-export-error { background: #ffe0df; color: #8e1f1f; }
.mrp-export-progress { background: #e7f0ff; color: #1a4d86; }
.mrp-retry {
  margin-left: 12px;
  background: transparent;
  color: #8fb7ff;
  border: 1px solid #5a7fbf;
  border-radius: 4px;
  padding: 1px 10px;
  cursor: pointer;
}
/* overlay 插槽层：默认穿透点击；放入交互元素时自开 pointer-events:auto */
.mrp-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
/* 搜索命中高亮 */
.mrp-page-holder :deep(mark.mrp-hit) {
  background: #ffe066;
  color: #7a5c00;
  border-radius: 2px;
  padding: 0 1px;
  scroll-margin: 8px;
}
/* 缩略图侧栏 */
.mrp-thumbs {
  width: 140px;
  flex: none;
  overflow-y: auto;
  border-left: 1px solid var(--mrp-toolbar-border);
  background: var(--mrp-toolbar-bg);
  padding: 8px;
  display: flex;
  flex-direction: column;
}
.mrp-thumb { cursor: pointer; text-align: center; flex: none; margin: 0 0 8px; padding: 0; border: 0; background: transparent; font: inherit; }
.mrp-thumb:focus-visible { outline: 2px solid var(--mrp-btn-active-bg); outline-offset: 2px; }
.mrp-thumb-spacer { flex: none; }
.mrp-thumb-box {
  display: block;
  box-sizing: border-box;
  width: 116px;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
  overflow: hidden;
  border: 2px solid transparent;
}
.mrp-thumb-active .mrp-thumb-box { border-color: var(--mrp-btn-active-bg); }
.mrp-thumb-no { display: block; margin-top: 4px; line-height: 16px; font-size: 11px; color: var(--mrp-toolbar-fg); }
/* 调试面板 */
.mrp-debug {
  position: absolute;
  right: 8px;
  bottom: 8px;
  background: rgba(0, 0, 0, 0.78);
  color: #7ee787;
  font: 11px/1.6 ui-monospace, monospace;
  padding: 6px 10px;
  border-radius: 6px;
  pointer-events: none;
  white-space: pre;
}
</style>
