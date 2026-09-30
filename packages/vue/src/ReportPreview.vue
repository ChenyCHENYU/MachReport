<script setup lang="ts">
/**
 * ReportPreview 契约组件（props/emits/expose 与 jh4j reportPreview 1:1）。
 *
 * 职责编排（实现在 composables，本文件保持薄壳）：
 * - usePageWindow：视口虚拟化（自然坐标系 + gap）
 * - useZoom：transform: scale 缩放（零重排）
 * - usePrintExport：打印/导出/PDF 窗口（流式打印 + named pages）
 * - 配置优先级：props > provideMachReportConfig 叠加 > preset > 插件 config.defaults > 内置缺省
 * - 数据面优先级：props.fetcher > 插件注入（machReportPlugin，零配置同源可用）
 */
import {
  computed,
  inject,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  watch,
  watchEffect
} from "vue";
import type { PropType } from "vue";
import type { RenderPlan } from "@agile-team/mach-report";
import { renderPage as renderPageToDom, validateRenderPlan } from "@agile-team/mach-report";
import { normalizeTempIds, type PlanFetcher } from "./adapters";
import { usePageWindow } from "./composables/usePageWindow";
import { useZoom } from "./composables/useZoom";
import { usePrintExport } from "./composables/usePrintExport";
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
  fetcher: {
    type: Function as unknown as PropType<PlanFetcher | null>,
    default: null
  }
});

const emit = defineEmits<{
  (e: "loaded", pageCount: number): void;
  (e: "error", message: string): void;
}>();

const plan = shallowRef<RenderPlan | null>(null);
const loading = ref(false);
const errorMessage = ref("");
const currentPage = ref(1);
const containerRef = ref<HTMLElement | null>(null);
const viewportRef = ref<HTMLElement | null>(null);

const PAGE_GAP_PX = computed(() => Math.max(0, effectiveGapPx.value));
const PX_PER_MM = 96 / 25.4;

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
  gapPx: PAGE_GAP_PX.value
});
const { contentSize, windowRange, visiblePages, makeScrollHandler, refreshViewport } = pageWindow;
const onViewportScroll = makeScrollHandler(currentPage, pageCount);

function invalidate(): void {
  plan.value = null;
  currentPage.value = 1;
}

/** 代际令牌：tempId 快速切换时，旧请求即使后返回也不得覆盖新数据 */
let reloadSeq = 0;

async function reload(): Promise<void> {
  const seq = ++reloadSeq;
  const fetcher = props.fetcher ?? injectedFetcher;
  if (tempIds.value.length === 0) {
    errorMessage.value = "缺少报表模板 ID";
    invalidate();
    emit("error", errorMessage.value);
    return;
  }
  if (!fetcher) {
    errorMessage.value = "未提供渲染数据源 fetcher";
    invalidate();
    emit("error", errorMessage.value);
    return;
  }
  loading.value = true;
  errorMessage.value = "";
  invalidate();
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
      throw new Error(`渲染计划校验失败(${check.errors.length} 处): ${head}`);
    }
    if (check.warnings.length > 0) {
      console.warn("[mach-report] 渲染计划告警:", check.warnings);
    }
    plan.value = next;
    currentPage.value = 1;
    if (viewportRef.value) viewportRef.value.scrollTop = 0;
    applyFitZoom();
    emit("loaded", next.pages.length);
  } catch (error) {
    if (seq !== reloadSeq) return;
    errorMessage.value = error instanceof Error ? error.message : "预览加载失败";
    emit("error", errorMessage.value);
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
  onError: (message) => emit("error", message)
});

/** 窗口内页 → DOM（holder 首次出现时挂载，页面级懒渲染） */
watchEffect(() => {
  const current = plan.value;
  if (!current) return;
  const scaleEl = containerRef.value;
  if (!scaleEl) return;
  const holders = scaleEl.querySelectorAll<HTMLElement>(".mrp-page-holder");
  holders.forEach((holder) => {
    const index = Number(holder.dataset.page ?? 0) - 1;
    const page = current.pages[index];
    if (!page || holder.childElementCount > 0) return;
    holder.style.width = `${page.pageWidthMm * PX_PER_MM}px`;
    holder.appendChild(renderPageToDom(page, 96, {}, document));
  });
}, { flush: "post" });

function onResize(): void {
  refreshViewport(viewportRef.value);
  applyFitZoom();
}

onMounted(() => {
  window.addEventListener("resize", onResize);
  refreshViewport(viewportRef.value);
  if (props.autoLoad) void reload();
});

onUnmounted(() => {
  window.removeEventListener("resize", onResize);
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
      @goto="gotoPage"
      @zoom="setZoom"
      @export="(f) => exportAs(f)"
      @print="print"
      @pdf-window="openPdfWindow"
    />
    <div ref="viewportRef" class="mrp-body" @scroll.passive="onViewportScroll($event.target as HTMLElement)">
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

  display: flex;
  flex-direction: column;
  background: var(--mrp-shell-bg);
  color: var(--mrp-shell-fg);
  overflow: hidden;
}
.mrp-body { flex: 1; overflow: auto; padding: 24px; }
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
</style>
