<script setup lang="ts">
/**
 * ReportPreview 契约组件（props/emits/expose 与 jh4j reportPreview 1:1）。
 *
 * 职责编排（实现在 composables，本文件保持薄壳）：
 * - usePageWindow：视口虚拟化（自然坐标系 + gap）
 * - useZoom：transform: scale 缩放（零重排；Ctrl+滚轮/键盘 ±/持久化记忆）
 * - usePrintExport：打印/导出/PDF 窗口（流式打印 + named pages）
 * - 搜索：计划全文索引 → 跳页导航 → 命中页高亮（mark）
 * - 缩略图侧栏：懒渲染小画布，点击导航
 * - 调试面板：?mrp-debug=1 或 debug prop 显示页窗/耗时/体积
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
import { normalizeTempIds, type PlanFetcher } from "./adapters";
import { usePageWindow } from "./composables/usePageWindow";
import { useZoom } from "./composables/useZoom";
import { usePrintExport } from "./composables/usePrintExport";
import { clearHighlights, highlightTextNodes } from "./composables/useHighlight";
import ReportToolbar from "./ReportToolbar.vue";
import {
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
import { MACH_REPORT_CONTROLLER_KEY } from "./injection-keys";
import type { MachReportController } from "./controller";

const props = defineProps({
  tempId: {
    type: [String, Array] as PropType<string | string[] | null>,
    default: null
  },
  furnitureTempId: { type: String, default: "" },
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
  fetcher: {
    type: Function as unknown as PropType<PlanFetcher | null>,
    default: null
  }
});

const emit = defineEmits<{
  (e: "loaded", pageCount: number): void;
  (e: "error", message: string, detail?: { code: string; cause?: unknown }): void;
}>();

const plan = shallowRef<RenderPlan | null>(null);
const loading = ref(false);
const errorMessage = ref("");
const currentPage = ref(1);
const containerRef = ref<HTMLElement | null>(null);
const viewportRef = ref<HTMLElement | null>(null);
const thumbsRef = ref<HTMLElement | null>(null);
const loadMs = ref(0);

const PAGE_GAP_PX = computed(() => Math.max(0, effectiveGapPx.value));
const PX_PER_MM = 96 / 25.4;
const UI_MEMORY_KEY = "mach-report:ui";

const injectedFetcher = inject(MACH_REPORT_FETCHER_KEY, null);
const injectedPdfExporter = inject(MACH_REPORT_PDF_EXPORTER_KEY, null);
/** 未装插件时兜底：懒加载默认导出器（bundle 延迟到首次导出） */
const fallbackPdfExporter: PdfExporter =
  injectedPdfExporter ?? createDefaultPdfExporter({ fontUrl: "/simhei.ttf" });

const tempIds = computed(() => normalizeTempIds(props.tempId));
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
  gapPx: effectiveGapPx.value
});
const { contentSize, windowRange, visiblePages, makeScrollHandler, refreshViewport } = pageWindow;
const onViewportScroll = makeScrollHandler(currentPage, pageCount);

/** 缩放原始值（Ctrl+滚轮/键盘 ± 用）：clamp 30%~300% */
function setZoomRaw(next: number): void {
  zoomMode.value = "raw";
  zoom.value = Math.min(3, Math.max(0.3, next));
}

function invalidate(): void {
  plan.value = null;
  currentPage.value = 1;
  searchQuery.value = "";
  matchIndex.value = 0;
}

/** 代际令牌：tempId 快速切换时，旧请求即使后返回也不得覆盖新数据 */
let reloadSeq = 0;

async function reload(): Promise<void> {
  const seq = ++reloadSeq;
  const fetcher = props.fetcher ?? injectedFetcher;
  if (tempIds.value.length === 0) {
    errorMessage.value = "缺少报表模板 ID";
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
  invalidate();
  const t0 = typeof performance !== "undefined" ? performance.now() : 0;
  try {
    const next = await fetcher({
      tempIds: tempIds.value,
      furnitureTempId: props.furnitureTempId || undefined,
      params: { ...props.params }
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
      console.warn("[mach-report] 渲染计划告警:", check.warnings);
    }
    plan.value = next;
    currentPage.value = 1;
    loadMs.value = t0 ? Math.round(performance.now() - t0) : 0;
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
  getPdfExporter: () => fallbackPdfExporter,
  onError: (message) => emit("error", message, { code: "print" })
});

/** 控制器注入：后代组件 useReportPreview() 免模板 ref 编程式访问（与 expose 同面） */
const controller: MachReportController = { reload, print, exportAs, openPdfWindow, gotoPage };
provide(MACH_REPORT_CONTROLLER_KEY, controller);

// ── 交互：Ctrl+滚轮缩放 / 键盘翻页与缩放 / Ctrl+F 搜索 ──
function onWheel(e: WheelEvent): void {
  if (!e.ctrlKey) return;
  e.preventDefault();
  setZoomRaw(zoom.value * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
}

function onKeydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
    e.preventDefault();
    searchVisible.value = true;
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

// ── 搜索：计划全文索引 → 跳页 → 命中页高亮 ──
const searchVisible = ref(false);
const searchQuery = ref("");
const matchIndex = ref(0);

function countOccurrences(text: string, q: string): number {
  let count = 0;
  let i = text.toLowerCase().indexOf(q);
  while (i >= 0) {
    count++;
    i = text.toLowerCase().indexOf(q, i + q.length);
  }
  return count;
}

/** 扁平命中表：每项为一次命中所在页索引 */
const searchMatches = computed<number[]>(() => {
  const q = searchQuery.value.trim().toLowerCase();
  const p = plan.value;
  if (!q || !p) return [];
  const out: number[] = [];
  p.pages.forEach((page, pageIndex) => {
    for (const comp of page.components) {
      if (comp.grid) {
        for (const row of comp.grid.cells ?? []) {
          for (const cell of row ?? []) {
            if (typeof cell?.text === "string") {
              for (let k = 0; k < countOccurrences(cell.text, q); k++) out.push(pageIndex);
            }
          }
        }
      } else if (comp.kind === "text" && typeof comp.text === "string") {
        for (let k = 0; k < countOccurrences(comp.text, q); k++) out.push(pageIndex);
      }
    }
  });
  return out;
});

function onSearchInput(query: string): void {
  searchQuery.value = query;
  matchIndex.value = 0;
  // 输入即定位到首个命中页（无命中不动）
  const first = searchMatches.value[0];
  if (first != null && first + 1 !== currentPage.value) {
    gotoPage(first + 1);
  }
}

function onSearchNav(dir: 1 | -1): void {
  const total = searchMatches.value.length;
  if (total === 0) return;
  matchIndex.value = (matchIndex.value + dir + total) % total;
  gotoPage(searchMatches.value[matchIndex.value]! + 1);
}

/** 窗口内页 → DOM（holder 首次出现时挂载，页面级懒渲染）+ 搜索高亮 */
watchEffect(() => {
  const current = plan.value;
  if (!current) return;
  const scaleEl = containerRef.value;
  if (!scaleEl) return;
  const q = searchQuery.value.trim();
  const holders = scaleEl.querySelectorAll<HTMLElement>(".mrp-page-holder");
  holders.forEach((holder) => {
    const index = Number(holder.dataset.page ?? 0) - 1;
    const page = current.pages[index];
    if (!page || holder.childElementCount > 0) {
      // 已挂载页：查询变化时同步高亮
      if (q && holder.firstElementChild) highlightTextNodes(holder.firstElementChild as HTMLElement, q);
      return;
    }
    holder.style.width = `${page.pageWidthMm * PX_PER_MM}px`;
    const pageEl = renderPageToDom(page, 96, {}, document);
    if (q) highlightTextNodes(pageEl, q);
    holder.appendChild(pageEl);
  });
}, { flush: "post" });

/** 查询清空时移除全部高亮标记 */
watch(searchQuery, (q) => {
  if (q) return;
  containerRef.value?.querySelectorAll(".mrp-page-holder").forEach((holder) => {
    clearHighlights(holder as HTMLElement);
  });
});

// ── 缩略图侧栏：懒渲染小画布 + 点击导航 ──
const showThumbs = ref(false);
const THUMB_W_PX = 116;
let thumbObserver: IntersectionObserver | null = null;

function renderThumb(box: HTMLElement, pageIndex: number): void {
  const p = plan.value;
  if (!p || box.childElementCount > 0) return;
  try {
    const { canvases } = renderPlanToCanvas(p, { start: pageIndex, end: pageIndex, dpr: 0.2 });
    const canvas = canvases[0]!;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    box.appendChild(canvas);
  } catch {
    // 无 2D 环境（SSR/测试）：保留占位样式
  }
}

watchEffect(() => {
  if (!showThumbs.value || !plan.value || !thumbsRef.value) return;
  if (typeof IntersectionObserver === "undefined") return;
  thumbObserver?.disconnect();
  thumbObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const box = entry.target as HTMLElement;
      renderThumb(box, Number(box.dataset.thumb ?? 1) - 1);
      thumbObserver?.unobserve(box);
    }
  }, { root: thumbsRef.value, rootMargin: "200px" });
  thumbsRef.value.querySelectorAll<HTMLElement>("[data-thumb]").forEach((el) => {
    thumbObserver!.observe(el);
  });
}, { flush: "post" });

// ── 调试面板：?mrp-debug=1 或 debug prop ──
const debugOn = computed(
  () =>
    props.debug ||
    (typeof location !== "undefined" &&
      new URLSearchParams(location.search).get("mrp-debug") === "1")
);
const debugStats = computed(() => {
  if (!debugOn.value || !plan.value) return null;
  return {
    pages: pageCount.value,
    window: `${windowRange.value.start}-${windowRange.value.end}`,
    zoom: `${Math.round(zoom.value * 100)}%`,
    loadMs: `${loadMs.value}ms`,
    planKB: Math.round(JSON.stringify(plan.value).length / 1024)
  };
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
  thumbObserver?.disconnect();
  thumbObserver = null;
  releasePrintFrame();
});

watch(
  () => [props.tempId, props.furnitureTempId, JSON.stringify(props.params)] as const,
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

defineExpose({ reload, print, exportAs, openPdfWindow, gotoPage });
</script>

<template>
  <div class="mach-report-preview" :style="shellStyle">
    <ReportToolbar
      :page-count="pageCount"
      :current-page="currentPage"
      :zoom-mode="zoomMode"
      :zoom="zoom"
      :show-export="effectiveShowExport"
      :show-print="effectiveShowPrint"
      :show-pdf-window="effectiveShowPdfWindow"
      :messages="resolvedMessages"
      :search="{ visible: searchVisible, query: searchQuery, matchIndex, matchCount: searchMatches.length }"
      :thumbs-visible="showThumbs"
      @goto="gotoPage"
      @zoom="setZoom"
      @export="(f) => exportAs(f)"
      @print="print"
      @pdf-window="openPdfWindow"
      @search-input="onSearchInput"
      @search-nav="onSearchNav"
      @search-toggle="searchVisible = !searchVisible"
      @thumbs-toggle="showThumbs = !showThumbs"
    />
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
            :style="{ height: `${Math.round((page.pageHeightMm / page.pageWidthMm) * THUMB_W_PX)}px` }"
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
