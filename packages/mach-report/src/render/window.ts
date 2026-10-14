import { createPageWindowIndex } from "./page-window-index";

export interface PageWindowInput {
  pageHeightsPx: number[];
  viewportHeightPx: number;
  scrollTopPx: number;
  overscan?: number;
  /** 页间距（px），默认 0；与每页 margin-bottom 使用同一口径。 */
  gapPx?: number;
}

export interface PageWindow {
  start: number;
  end: number;
  padTopPx: number;
  padBottomPx: number;
}

/** 页级视口虚拟化；单次计算入口保留兼容，预览内部复用已建立的几何索引。 */
export function computePageWindow(input: PageWindowInput): PageWindow {
  return createPageWindowIndex(input.pageHeightsPx, input.gapPx)
    .window(input.viewportHeightPx, input.scrollTopPx, input.overscan);
}
