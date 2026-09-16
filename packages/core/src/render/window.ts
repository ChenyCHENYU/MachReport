export interface PageWindowInput {
  pageHeightsPx: number[];
  viewportHeightPx: number;
  scrollTopPx: number;
  overscan?: number;
}

export interface PageWindow {
  start: number;
  end: number;
  padTopPx: number;
  padBottomPx: number;
}

/**
 * 页级视口虚拟化：给定每页高度与滚动位置，返回需要真实渲染的页区间
 * 与上下占位高度（占位高度只累计页高，页间距由调用方的 CSS gap 统一处理）。
 * start/end 为闭区间索引。
 */
export function computePageWindow(input: PageWindowInput): PageWindow {
  const { pageHeightsPx, viewportHeightPx, scrollTopPx, overscan = 1 } = input;
  const n = pageHeightsPx.length;
  if (n === 0) {
    return { start: 0, end: -1, padTopPx: 0, padBottomPx: 0 };
  }
  const top = Math.max(0, scrollTopPx);
  let start = 0;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const h = pageHeightsPx[i] ?? 0;
    if (acc + h > top) {
      start = i;
      break;
    }
    acc += h;
    start = i + 1;
  }
  start = Math.max(0, Math.min(n - 1, start - overscan));

  let end = start;
  let visible = 0;
  for (let i = start; i < n; i++) {
    const h = pageHeightsPx[i] ?? 0;
    visible += h;
    end = i;
    if (visible >= viewportHeightPx) break;
  }
  end = Math.min(n - 1, end + overscan);

  let padTopPx = 0;
  for (let i = 0; i < start; i++) padTopPx += pageHeightsPx[i] ?? 0;

  let padBottomPx = 0;
  for (let i = end + 1; i < n; i++) padBottomPx += pageHeightsPx[i] ?? 0;

  return { start, end, padTopPx, padBottomPx };
}
