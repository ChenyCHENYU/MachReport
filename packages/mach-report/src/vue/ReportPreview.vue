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
  onMounted,
  onUnmounted,
  provide,
  ref,
  shallowRef,
  watch,
  watchEffect
} from "vue";
import type { PropType } from "vue";
import type { RenderPlan } from "@agile-team/mach-report";
import {
  renderPage as renderPageToDom,
  renderPlanToCanvas,
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
import ReportParamPanel from "./ReportParamPanel.vue";
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
import { createDefaultPdfExporter, type PdfExporter } from "./pdf-exporter";
import { MachReportError, toErrorDetail } from "./errors";
import type { MachReportController } from "./controller";

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
  fetcher: {
    type: Function as unknown as PropType<PlanFetcher | null>,
    default: null
  }
});

const emit = defineEmits<{
  (e: "loaded", pageCount: number): void;
  (e: "error", message: string, detail?: { code: string; cause?: unknown }): void;
  (e: "warning", message: string): void;
}>();

const plan = shallowRef<RenderPlan | null>(null);
const loading = ref(false);
const errorMessage = ref("");
const exportNotice = ref<{ kind: "error" | "warning" | "progress"; message: string } | null>(null);
const currentPage = ref(1);
const containerRef = ref<HTMLElement | null>(null);
const viewportRef = ref<HTMLElement | null>(null);
const thumbsRef = ref<HTMLElement | null>(null);
const showThumbs = ref(false);
const timing = useLoadTiming();

const PAGE_GAP_PX = computed(() => Math.max(0, effectiveGapPx.value));
const PX_PER_MM = 96 / 25.4;
const UI_MEMORY_KEY = "mach-report:ui";

const injectedFetcher = inject(MACH_REPORT_FETCHER_KEY, null);
const injectedPdfExporter = inject(MACH_REPORT_PDF_EXPORTER_KEY, null);

const reportIds = computed(() => normalizeReportIds(props.reportId));
const pageCount = computed(() => plan.value?.pages.length ?? 0);

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
const effectiveGapPx = computed(() => props.gapPx ?? resolved.value.gapPx);
const effectiveShowParams = computed(() => props.showParams ?? resolved.value.showParams);
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

// ── 参数面板：定义优先级 prop > 模板 params；值合并优先级 面板值 > props.params ──
/** 本地模式：createLocalFetcher 无法把模板递给组件，宿主可用 template.params 直读；此处兜底从模板无门获取，走 prop */
const effectiveParamDefs = computed<ReportParamDef[]>(() => props.paramDefs ?? []);
const paramValues = ref<Record<string, string>>({});
const paramAttempted = ref(false);

function initParamValues(defs: ReportParamDef[]): void {
  const next: Record<string, string> = {};
  for (const def of defs) {
    next[def.field] = props.params[def.field] ?? def.defaultValue ?? "";
  }
  paramValues.value = next;
  paramAttempted.value = false;
}
initParamValues(effectiveParamDefs.value);
watch(effectiveParamDefs, (defs) => initParamValues(defs));
watch(() => JSON.stringify(props.params), () => initParamValues(effectiveParamDefs.value));

/** 生效参数：面板值覆盖宿主传入值（面板是"用户当前意图"） */
const effectiveParams = computed<Record<string, string>>(() => {
  const next = { ...props.params };
  for (const [field, value] of Object.entries(paramValues.value)) {
    if (value === "") delete next[field];
    else next[field] = value;
  }
  return next;
});

function missingRequired(): ReportParamDef[] {
  return effectiveParamDefs.value.filter(
    (d) => d.required === true && !(paramValues.value[d.field] ?? "").trim()
  );
}

function onParamQuery(): void {
  paramAttempted.value = true;
  const missing = missingRequired();
  if (missing.length > 0) {
    const label = missing[0]!.label ?? missing[0]!.field;
    const message = resolvedMessages.value.paramRequired.replace("{label}", label);
    errorMessage.value = message;
    emit("error", message, { code: "param" });
    return;
  }
  void reload();
}

function onParamReset(): void {
  initParamValues(effectiveParamDefs.value);
}

const shellStyle = computed(() => ({
  height: props.height,
  ...themeToCssVars(resolved.value.theme)
}));

const { zoom, zoomMode, applyFitZoom, setZoom } = useZoom(() => ({
  viewport: viewportRef.value,
  pageWidthPx: (plan.value?.pages[0]?.pageWidthMm ?? 210) * PX_PER_MM
}));

const pageWindow = usePageWindow(plan, zoom, {
  pxPerMm: PX_PER_MM,
  gapPx: effectiveGapPx
});
const { contentSize, windowRange, visiblePages, makeScrollHandler, refreshViewport } = pageWindow;
const onViewportScroll = makeScrollHandler(currentPage, pageCount);

/** 缩放原始值（Ctrl+滚轮/键盘 ± 用）：clamp 30%~300% */
function setZoomRaw(next: number): void {
  zoomMode.value = "raw";
  zoom.value = Math.min(3, Math.max(0.3, next));
}

function invalidate(): void {
  releasePrintFrame();
  plan.value = null;
  currentPage.value = 1;
  search.reset();
}

/** 代际令牌：报表 ID 快速切换时，旧请求即使后返回也不得覆盖新数据 */
let reloadSeq = 0;

async function reload(): Promise<void> {
  const seq = ++reloadSeq;
  const fetcher = props.fetcher ?? injectedFetcher;
  if (reportIds.value.length === 0) {
    errorMessage.value = "缺少报表 ID";
    invalidate();
    emit("error", errorMessage.value, { code: "param" });
    return;
  }
  if (!fetcher) {
    errorMessage.value = "未提供渲染数据源 fetcher";
    invalidate();
    emit("error", errorMessage.value, { code: "config" });
    return;
  }
  loading.value = true;
  errorMessage.value = "";
  exportNotice.value = null;
  invalidate();
  const t0 = timing.start();
  try {
    const next = await fetcher({
      reportIds: reportIds.value,
      params: { ...effectiveParams.value }
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
    if (check.warnings.length > 0) {
      resolved.value.logger.warn("[mach-report] 渲染计划告警:", check.warnings);
    }
    plan.value = next;
    currentPage.value = 1;
    timing.end(t0);
    if (viewportRef.value) viewportRef.value.scrollTop = 0;
    if (zoomMode.value === "fit") applyFitZoom();
    emit("loaded", next.pages.length);
  } catch (error) {
    if (seq !== reloadSeq) return;
    const normalized =
      error instanceof MachReportError
        ? error
        : new MachReportError(
            "fetch",
            error instanceof Error ? error.message : "预览加载失败",
            error
          );
    errorMessage.value = normalized.message;
    emit("error", normalized.message, toErrorDetail(normalized));
  } finally {
    if (seq === reloadSeq) loading.value = false;
  }
}

function gotoPage(n: number): void {
  if (pageCount.value <= 0) return;
  const target = Math.max(1, Math.min(pageCount.value, n));
  currentPage.value = target;
  const vp = viewportRef.value;
  if (!vp) return;
  let offset = 0;
  for (let i = 0; i < target - 1; i++) {
    offset += (plan.value?.pages[i]?.pageHeightMm ?? 0) * PX_PER_MM + PAGE_GAP_PX.value;
  }
  vp.scrollTop = offset * zoom.value;
}

const { print, exportAs, openPdfWindow, releasePrintFrame } = usePrintExport(plan, {
  getPdfExporter,
  onError: (message, code) => {
    exportNotice.value = { kind: "error", message };
    emit("error", message, { code: code ?? "print" });
  },
  onWarning: (message) => {
    exportNotice.value = { kind: "warning", message };
    emit("warning", message);
  },
  onBusy: (format) => {
    if (format) {
      exportNotice.value = {
        kind: "progress",
        message: resolvedMessages.value.exporting.replace("{format}", format)
      };
    } else if (exportNotice.value?.kind === "progress") {
      exportNotice.value = null;
    }
  }
});

/** 控制器注入：后代组件 useReportPreview() 免模板 ref 编程式访问（与 expose 同面） */
/** 编程式设参查询：合并进面板值（面板本地字典经 v-model 同步），可选立即重载 */
function setParams(values: Record<string, string>, opts: { reload?: boolean } = {}): void {
  paramValues.value = { ...paramValues.value, ...values };
  if (opts.reload !== false) void reload();
}

const controller: MachReportController = { reload, print, exportAs, openPdfWindow, gotoPage, setParams };
provide(MACH_REPORT_CONTROLLER_KEY, controller);

// ── 交互：Ctrl+滚轮缩放 / 键盘翻页与缩放 / Ctrl+F 搜索 ──
const search = useReportSearch({
  plan,
  gotoPage,
  highlight: highlightTextNodes,
  clearHighlights
});

function onWheel(e: WheelEvent): void {
  if (!e.ctrlKey) return;
  e.preventDefault();
  setZoomRaw(zoom.value * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
}

function onKeydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
    e.preventDefault();
    if (!search.visible.value) search.toggle();
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
      setZoomRaw(zoom.value * 1.1);
      break;
    case "-":
      e.preventDefault();
      setZoomRaw(zoom.value / 1.1);
      break;
  }
}

/** 缩放模式持久化（mach-table persistence 同思路；隐私模式/SSR 静默降级） */
function persistZoom(): void {
  try {
    localStorage.setItem(
      UI_MEMORY_KEY,
      JSON.stringify({ zoomMode: zoomMode.value === "fit" ? "fit" : Math.round(zoom.value * 100) })
    );
  } catch {
    /* localStorage 不可用时忽略 */
  }
}
watch([zoomMode, zoom], persistZoom);

/** 窗口内页 → DOM（holder 首次出现时挂载，页面级懒渲染）+ 搜索高亮 */
watchEffect(() => {
  const current = plan.value;
  if (!current) return;
  const scaleEl = containerRef.value;
  if (!scaleEl) return;
  const holders = scaleEl.querySelectorAll<HTMLElement>(".mrp-page-holder");
  holders.forEach((holder) => {
    const index = Number(holder.dataset.page ?? 0) - 1;
    const page = current.pages[index];
    if (!page || holder.childElementCount > 0) {
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
    holder.appendChild(pageEl);
  });
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
      const { canvases } = renderPlanToCanvas(plan.value!, { start: pageIndex, end: pageIndex, dpr: 0.2 });
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
  if (zoomMode.value === "fit") applyFitZoom();
}

function loadZoomMemory(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(UI_MEMORY_KEY) ?? "{}") as {
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
  refreshViewport(viewportRef.value);
  loadZoomMemory();
  if (props.autoLoad) void reload();
});

onUnmounted(() => {
  window.removeEventListener("resize", onResize);
  thumbs.destroy();
  search.reset(); // 清防抖计时器（若挂载期间恰在防抖窗口内）
  releasePrintFrame();
});

watch(
  () => [props.reportId, JSON.stringify(props.params)] as const,
  () => {
    if (props.autoLoad) void reload();
  }
);

watch(
  () => props.fetcher ?? injectedFetcher,
  () => {
    if (props.autoLoad) void reload();
  }
);

defineExpose({ reload, print, exportAs, openPdfWindow, gotoPage, setParams });
</script>

<template>
  <div class="mach-report-preview" :style="shellStyle">
    <ReportParamPanel
      v-if="effectiveShowParams && effectiveParamDefs.length > 0"
      :defs="effectiveParamDefs"
      v-model="paramValues"
      :messages="resolvedMessages"
      :attempted="paramAttempted"
      @query="onParamQuery"
      @reset="onParamReset"
    />
    <ReportToolbar
      :page-count="pageCount"
      :current-page="currentPage"
      :zoom-mode="zoomMode"
      :zoom="zoom"
      :show-export="effectiveShowExport"
      :show-print="effectiveShowPrint"
      :show-pdf-window="effectiveShowPdfWindow"
      :messages="resolvedMessages"
      :search="{ visible: search.visible.value, query: search.query.value, matchIndex: search.matchIndex.value, matchCount: search.matchCount.value }"
      :thumbs-visible="showThumbs"
      @goto="gotoPage"
      @zoom="setZoom"
      @export="(f) => exportAs(f)"
      @print="print"
      @pdf-window="openPdfWindow"
      @search-input="search.onInput"
      @search-nav="search.onNav"
      @search-toggle="search.toggle"
      @thumbs-toggle="showThumbs = !showThumbs"
    />
    <div v-if="exportNotice" class="mrp-export-notice" :class="`mrp-export-${exportNotice.kind}`" role="alert">
      {{ exportNotice.message }}
    </div>
    <div class="mrp-main">
      <div
        ref="viewportRef"
        class="mrp-body"
        tabindex="0"
        @wheel="onWheel"
        @keydown="onKeydown"
        @scroll.passive="onViewportScroll($event.target as HTMLElement)"
      >
        <div v-if="loading" class="mrp-state">{{ resolvedMessages.loading }}</div>
        <div v-else-if="errorMessage" class="mrp-state mrp-error">
          {{ errorMessage }}
          <button class="mrp-retry" type="button" @click="reload">{{ resolvedMessages.retry }}</button>
        </div>
        <div v-else-if="!plan || pageCount === 0" class="mrp-state">{{ resolvedMessages.empty }}</div>
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
      </div>
      <aside v-if="showThumbs && pageCount > 0" ref="thumbsRef" class="mrp-thumbs">
        <div
          v-for="(page, i) in plan?.pages ?? []"
          :key="i"
          class="mrp-thumb"
          :class="{ 'mrp-thumb-active': i + 1 === currentPage }"
          @click="gotoPage(i + 1)"
        >
          <div
            class="mrp-thumb-box"
            :data-thumb="i + 1"
            :style="{ height: `${Math.round((page.pageHeightMm / page.pageWidthMm) * 116)}px` }"
          />
          <span class="mrp-thumb-no">{{ i + 1 }}</span>
        </div>
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
  overflow: auto;
  padding: 24px;
  outline: none; /* 键盘交互容器聚焦不带轮廓 */
}
/* 缩放容器：外层按缩放后尺寸占位，内层 transform 缩放（零重排） */
.mrp-scale { margin: 0 auto; }
.mrp-scale-inner { display: flex; flex-direction: column; align-items: center; }
.mrp-page-holder {
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  margin-bottom: v-bind("PAGE_GAP_PX + 'px'");
  flex: none;
}
.mrp-state {
  padding: 40px;
  text-align: center;
  color: #bfbfbf;
  font-size: 13px;
}
.mrp-error { color: #ff9d9d; }
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
  gap: 8px;
}
.mrp-thumb { cursor: pointer; text-align: center; }
.mrp-thumb-box {
  width: 116px;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
  overflow: hidden;
  border: 2px solid transparent;
}
.mrp-thumb-active .mrp-thumb-box { border-color: var(--mrp-btn-active-bg); }
.mrp-thumb-no { font-size: 11px; color: var(--mrp-toolbar-fg); }
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
