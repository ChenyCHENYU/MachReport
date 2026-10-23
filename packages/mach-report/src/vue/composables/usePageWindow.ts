import { computed, onScopeDispose, ref, unref, type Ref } from "vue";
import type { PlanPage, RenderPlan } from "@agile-team/mach-report";
import { createPageWindowIndex } from "../../render/page-window-index";

/** 页级虚拟化；页几何按计划引用缓存，滚动仅更新坐标，不遍历整个计划。 */
export function usePageWindow(
  plan: Ref<RenderPlan | null>,
  zoom: Ref<number>,
  options: { pxPerMm?: number; gapPx?: number | Ref<number>; overscan?: number | Ref<number> } = {}
) {
  const pxPerMm = options.pxPerMm ?? 96 / 25.4;
  const gapPx = computed(() => Math.max(0, unref(options.gapPx) ?? 18));
  const scrollTop = ref(0);
  const viewportHeight = ref(800);
  const geometry = computed(() => {
    const pages = plan.value?.pages ?? [];
    return createPageWindowIndex(pages.map((page) => page.pageHeightMm * pxPerMm), gapPx.value);
  });
  const contentSize = computed(() => {
    let width = 0;
    for (const page of plan.value?.pages ?? []) width = Math.max(width, page.pageWidthMm * pxPerMm);
    return { w: width, h: geometry.value.totalHeightPx };
  });
  const windowRange = computed(() => geometry.value.window(
    viewportHeight.value / zoom.value,
    scrollTop.value / zoom.value,
    unref(options.overscan) ?? 1
  ));
  const visiblePages = computed(() => {
    const p = plan.value;
    if (!p) return [] as { page: PlanPage; index: number }[];
    const { start, end } = windowRange.value;
    return p.pages.slice(start, end + 1).map((page, i) => ({ page, index: start + i }));
  });
  let scrollRaf = 0;
  let disposed = false;
  let navigation: { top: number; index: number; zoom: number; geometry: typeof geometry.value } | undefined;

  function refreshViewport(vp: HTMLElement | null): void {
    if (!vp) return;
    scrollTop.value = vp.scrollTop;
    viewportHeight.value = vp.clientHeight || 800;
  }

  function scrollToPage(vp: HTMLElement, index: number): void {
    vp.scrollTop = geometry.value.offsetAt(index) * zoom.value;
    // Short labels near the end cannot always align to the viewport's top.
    // Preserve the requested page at the browser-clamped offset until a real scroll.
    navigation = { top: vp.scrollTop, index, zoom: zoom.value, geometry: geometry.value };
    refreshViewport(vp);
  }

  /** rAF 节流并及时取消；当前页由缓存几何计算，避免读所有页 DOM 的布局。 */
  function makeScrollHandler(currentPage: Ref<number>, pageCount: Ref<number>) {
    return (vp: HTMLElement) => {
      if (scrollRaf || disposed) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        if (disposed) return;
        refreshViewport(vp);
        if (pageCount.value <= 0) return;
        if (navigation && navigation.top === vp.scrollTop && navigation.zoom === zoom.value && navigation.geometry === geometry.value) {
          currentPage.value = Math.min(pageCount.value, navigation.index + 1);
          return;
        }
        navigation = undefined;
        // body padding 为 24px；页码切换阈值保留距视口顶约 56px 的原有体验。
        const position = Math.max(0, vp.scrollTop + 32) / zoom.value;
        currentPage.value = Math.min(pageCount.value, geometry.value.pageAt(position) + 1);
      });
    };
  }

  function destroy(): void {
    disposed = true;
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
    scrollRaf = 0;
  }
  onScopeDispose(destroy);

  return {
    contentSize, windowRange, visiblePages, makeScrollHandler, refreshViewport,
    scrollToPage,
    pageOffsetPx: (index: number) => geometry.value.offsetAt(index),
    destroy
  };
}
