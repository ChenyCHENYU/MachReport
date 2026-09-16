<script setup lang="ts">
import {
  computed,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  watch,
  watchEffect
} from "vue";
import type { PropType } from "vue";
import type { RenderPlan } from "@mach-report/core";
import { renderPage as renderPageToDom, renderPlan as renderPlanToDom } from "@mach-report/core";
import { computePageWindow } from "@mach-report/core";
import { normalizeTempIds, type PlanFetcher } from "./adapters";

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
  showExport: { type: Boolean, default: true },
  showPrint: { type: Boolean, default: true },
  showPdfWindow: { type: Boolean, default: true },
  fetcher: {
    type: Function as PropType<PlanFetcher | null>,
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
const zoom = ref(1);
const zoomMode = ref<"fit" | "raw">("fit");
const currentPage = ref(1);
const containerRef = ref<HTMLElement | null>(null);
const viewportRef = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewportHeight = ref(800);
const PAGE_GAP_PX = 18;
const PX_PER_MM = 96 / 25.4;

const tempIds = computed(() => normalizeTempIds(props.tempId));
const pageCount = computed(() => plan.value?.pages.length ?? 0);
const pageHeightsPx = computed(() =>
  (plan.value?.pages ?? []).map((p) => p.pageHeightMm * PX_PER_MM)
);
const windowRange = computed(() =>
  computePageWindow({
    pageHeightsPx: pageHeightsPx.value,
    viewportHeightPx: viewportHeight.value,
    scrollTopPx: scrollTop.value,
    gapPx: PAGE_GAP_PX,
    overscan: 1
  })
);
const visiblePages = computed(() => {
  const p = plan.value;
  if (!p) return [];
  const { start, end } = windowRange.value;
  if (end < start) return [];
  return p.pages.slice(start, end + 1).map((page, i) => ({ page, index: start + i }));
});

function invalidate(): void {
  plan.value = null;
  currentPage.value = 1;
}

async function reload(): Promise<void> {
  if (tempIds.value.length === 0) {
    errorMessage.value = "缺少报表模板 ID";
    invalidate();
    emit("error", errorMessage.value);
    return;
  }
  if (!props.fetcher) {
    errorMessage.value = "未提供渲染数据源 fetcher";
    invalidate();
    return;
  }
  loading.value = true;
  errorMessage.value = "";
  invalidate();
  try {
    const next = await props.fetcher({
      tempIds: tempIds.value,
      furnitureTempId: props.furnitureTempId || undefined,
      params: { ...props.params }
    });
    plan.value = next;
    currentPage.value = 1;
    applyFitZoom();
    emit("loaded", next.pages.length);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "预览加载失败";
    emit("error", errorMessage.value);
  } finally {
    loading.value = false;
  }
}

function buildPrintHtml(): string {
  const p = plan.value;
  if (!p || p.pages.length === 0) return "";
  const pagesHtml = p.pages
    .map((page) => {
      const el = renderPlanToDom({ schemaVersion: p.schemaVersion, pages: [page] }, document);
      const pageEl = el.firstElementChild as HTMLElement | null;
      if (!pageEl) return "";
      const style = pageEl.getAttribute("style") ?? "";
      return `<div class="mr-page" style="${style.replace(/position:absolute;/, "position:relative;;")}">${pageEl.innerHTML}</div>`;
    })
    .join("");
  const first = p.pages[0]!;
  const css = `.mr-page{margin:0 auto;page-break-after:always;}
@page{size:${Math.round(first.pageWidthMm)}mm ${Math.round(first.pageHeightMm)}mm;margin:0;}
body{margin:0;background:#fff;}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${pagesHtml}</body></html>`;
}

let printFrame: HTMLIFrameElement | null = null;

async function print(): Promise<void> {
  if (!plan.value || pageCount.value === 0) return;
  releasePrintFrame();
  const html = buildPrintHtml();
  printFrame = document.createElement("iframe");
  printFrame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(printFrame);
  await new Promise<void>((resolve) => {
    const frame = printFrame!;
    frame.onload = () => resolve();
    frame.srcdoc = html;
    setTimeout(resolve, 3000);
  });
  try {
    printFrame.contentWindow?.focus();
    printFrame.contentWindow?.print();
  } catch {
    emit("error", "调用打印失败，请改用导出 PDF");
  }
}

function releasePrintFrame(): void {
  printFrame?.remove();
  printFrame = null;
}

function exportAs(format: string): void {
  const p = plan.value;
  if (!p || p.pages.length === 0) return;
  const html = buildPrintHtml();
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `mach-report.${format === "html" ? "html" : format}`;
  a.click();
  URL.revokeObjectURL(url);
}

function openPdfWindow(): void {
  const html = buildPrintHtml();
  const w = window.open("", "_blank");
  if (w) {
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 400);
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
    offset += pageHeightsPx.value[i]! + PAGE_GAP_PX;
  }
  vp.scrollTop = offset * zoom.value;
}

function applyFitZoom(): void {
  requestAnimationFrame(() => {
    const viewport = viewportRef.value;
    const first = plan.value?.pages[0];
    if (!viewport || !first) return;
    const pxPerMm = 96 / 25.4;
    const pageW = first.pageWidthMm * pxPerMm;
    zoom.value = Math.min(1, Math.max(0.3, (viewport.clientWidth - 48) / pageW));
  });
}

function setZoom(mode: "fit" | number): void {
  if (mode === "fit") {
    zoomMode.value = "fit";
    applyFitZoom();
  } else {
    zoomMode.value = "raw";
    zoom.value = mode / 100;
  }
}

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

let scrollRaf = 0;

function onViewportScroll(): void {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    const vp = viewportRef.value;
    if (!vp) return;
    scrollTop.value = vp.scrollTop;
    viewportHeight.value = vp.clientHeight || 800;
    syncCurrentPageFromScroll(vp);
  });
}

function syncCurrentPageFromScroll(vp: HTMLElement): void {
  if (pageCount.value <= 0) return;
  const pageEls = vp.querySelectorAll<HTMLElement>(".mrp-page-holder");
  if (!pageEls.length) return;
  const threshold = vp.getBoundingClientRect().top + 56;
  let next = 1;
  pageEls.forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.top <= threshold) next = Number(el.dataset.page ?? 1);
  });
  currentPage.value = Math.max(1, Math.min(pageCount.value, next));
}

onMounted(() => {
  window.addEventListener("resize", applyFitZoom);
  const vp = viewportRef.value;
  if (vp) viewportHeight.value = vp.clientHeight || 800;
  if (props.autoLoad) void reload();
});

onUnmounted(() => {
  window.removeEventListener("resize", applyFitZoom);
  if (scrollRaf) cancelAnimationFrame(scrollRaf);
  releasePrintFrame();
});

watch(
  () => [props.tempId, props.furnitureTempId, JSON.stringify(props.params)] as const,
  () => {
    if (props.autoLoad) void reload();
  }
);

watch(
  () => props.fetcher,
  () => {
    if (props.autoLoad) void reload();
  }
);

defineExpose({ reload, print, exportAs, openPdfWindow, gotoPage });
</script>

<template>
  <div class="mach-report-preview" :style="{ height }">
    <div class="mrp-toolbar">
      <span class="mrp-title">报表预览</span>
      <template v-if="pageCount > 0">
        <button class="mrp-nav" type="button" :disabled="currentPage <= 1" @click="gotoPage(currentPage - 1)">‹ 上一页</button>
        <span class="mrp-pageinfo">{{ currentPage }} / {{ pageCount }}</span>
        <button class="mrp-nav" type="button" :disabled="currentPage >= pageCount" @click="gotoPage(currentPage + 1)">下一页 ›</button>
      </template>
      <span class="mrp-spacer" />
      <button class="mrp-nav" :class="{ 'mrp-active': zoomMode === 'fit' }" type="button" @click="setZoom('fit')">适宽</button>
      <button class="mrp-nav" :class="{ 'mrp-active': zoomMode === 'raw' && Math.round(zoom * 100) === 100 }" type="button" @click="setZoom(100)">100%</button>
      <button class="mrp-nav" :class="{ 'mrp-active': zoomMode === 'raw' && Math.round(zoom * 100) === 150 }" type="button" @click="setZoom(150)">150%</button>
      <button v-if="showExport" class="mrp-nav" type="button" @click="exportAs('html')">导出 ▾</button>
      <button v-if="showPrint" class="mrp-nav" type="button" @click="print">打印</button>
      <button v-if="showPdfWindow" class="mrp-nav" type="button" @click="openPdfWindow">PDF 窗口</button>
    </div>
    <div ref="viewportRef" class="mrp-body" @scroll.passive="onViewportScroll">
      <div v-if="loading" class="mrp-state">报表渲染中…</div>
      <div v-else-if="errorMessage" class="mrp-state mrp-error">
        {{ errorMessage }}
        <button class="mrp-retry" type="button" @click="reload">重试</button>
      </div>
      <div v-else-if="!plan || pageCount === 0" class="mrp-state">暂无预览数据</div>
      <div v-else ref="containerRef" class="mrp-scale" :style="{ zoom: zoom }">
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
</template>

<style scoped>
.mach-report-preview {
  display: flex;
  flex-direction: column;
  background: #525659;
  color: #e8e8e8;
  overflow: hidden;
}
.mrp-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: #323639;
  border-bottom: 1px solid #22252a;
  flex: none;
}
.mrp-title { font-size: 13px; font-weight: 600; margin-right: 8px; }
.mrp-nav {
  background: transparent;
  color: #cfcfcf;
  border: 1px solid #4a4d52;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 12px;
  cursor: pointer;
}
.mrp-nav:hover:not(:disabled) { background: #414549; color: #fff; }
.mrp-nav:disabled { opacity: 0.4; cursor: not-allowed; }
.mrp-active { background: #2d5fb8; border-color: #2d5fb8; color: #fff; }
.mrp-pageinfo { font-size: 12px; min-width: 56px; text-align: center; }
.mrp-spacer { flex: 1; }
.mrp-body { flex: 1; overflow: auto; padding: 24px; }
.mrp-scale { display: flex; flex-direction: column; gap: 18px; align-items: center; }
.mrp-page-holder { background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.35); }
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
