import { computed, ref, type Ref } from "vue";
import type { PlanPage, RenderPlan } from "@agile-team/core";
import { computePageWindow } from "@agile-team/core";

/**
 * 页级视口虚拟化（DOM 后端）。
 *
 * 坐标口径（与 transform: scale 缩放配合）：
 * - 页高/间距/占位均在"自然坐标系"（未缩放 px）维护
 * - 视口滚动量与视口高换算回自然系（除以 zoom）后再进 computePageWindow
 */
export function usePageWindow(
  plan: Ref<RenderPlan | null>,
  zoom: Ref<number>,
  options: { pxPerMm?: number; gapPx?: number } = {}
) {
  const pxPerMm = options.pxPerMm ?? 96 / 25.4;
  const gapPx = options.gapPx ?? 18;
  const scrollTop = ref(0);
  const viewportHeight = ref(800);

  const pageHeightsPx = computed(() =>
    (plan.value?.pages ?? []).map((p) => p.pageHeightMm * pxPerMm)
  );
  /** 自然坐标系内容尺寸：每页高度 + 页间距（transform 外层占位依据） */
  const contentSize = computed(() => {
    const pages = plan.value?.pages ?? [];
    let h = 0;
    let w = 0;
    for (const p of pages) {
      h += p.pageHeightMm * pxPerMm + gapPx;
      w = Math.max(w, p.pageWidthMm * pxPerMm);
    }
    return { w, h };
  });
  const windowRange = computed(() =>
    computePageWindow({
      pageHeightsPx: pageHeightsPx.value,
      viewportHeightPx: viewportHeight.value / zoom.value,
      scrollTopPx: scrollTop.value / zoom.value,
      overscan: 1,
      gapPx
    })
  );
  const visiblePages = computed(() => {
    const p = plan.value;
    if (!p) return [] as { page: PlanPage; index: number }[];
    const { start, end } = windowRange.value;
    if (end < start) return [];
    return p.pages.slice(start, end + 1).map((page, i) => ({ page, index: start + i }));
  });

  /** 滚动处理器：rAF 节流 + 自然系换算 + 当前页码同步 */
  function makeScrollHandler(currentPage: Ref<number>, pageCount: Ref<number>) {
    let scrollRaf = 0;
    return (vp: HTMLElement) => {
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        scrollTop.value = vp.scrollTop;
        viewportHeight.value = vp.clientHeight || 800;
        // 按可视几何同步页码（getBoundingClientRect 为视觉坐标系，天然含缩放）
        if (pageCount.value <= 0) return;
        const pageEls = vp.querySelectorAll<HTMLElement>(".mrp-page-holder");
        if (!pageEls.length) return;
        const threshold = vp.getBoundingClientRect().top + 56;
        let next = 1;
        pageEls.forEach((el) => {
          if (el.getBoundingClientRect().top <= threshold) next = Number(el.dataset.page ?? 1);
        });
        currentPage.value = Math.max(1, Math.min(pageCount.value, next));
      });
    };
  }

  return {
    pageHeightsPx,
    contentSize,
    windowRange,
    visiblePages,
    scrollTop,
    viewportHeight,
    makeScrollHandler,
    refreshViewport(vp: HTMLElement | null): void {
      if (vp) viewportHeight.value = vp.clientHeight || 800;
    }
  };
}
