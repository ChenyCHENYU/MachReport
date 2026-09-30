export interface PageWindowInput {
  pageHeightsPx: number[];
  viewportHeightPx: number;
  scrollTopPx: number;
  overscan?: number;
  /** 页间距（px）。占位高度按“每页高度+间距”累计，与 margin-bottom 布局一致；默认 0 */
  gapPx?: number;
}

export interface PageWindow {
  start: number;
  end: number;
  padTopPx: number;
  padBottomPx: number;
}

/**
 * 页级视口虚拟化：给定每页高度与滚动位置，返回需要真实渲染的页区间
 * 与上下占位高度。start/end 为闭区间索引。
 *
 * 布局模型：每页占据 height + gap（gap 为页间距，默认 0），
 * padTop/padBottom 同口径累计，保证 占位+渲染页+间距 还原总滚动高度。
 * 内部用前缀和 + 二分定位覆盖页与可见终点。
 */
export function computePageWindow(input: PageWindowInput): PageWindow {
  const { pageHeightsPx, viewportHeightPx, scrollTopPx, overscan = 1, gapPx = 0 } = input;
  const n = pageHeightsPx.length;
  if (n === 0) {
    return { start: 0, end: -1, padTopPx: 0, padBottomPx: 0 };
  }
  const gap = Math.max(0, gapPx);
  const offsets = new Array<number>(n + 1);
  offsets[0] = 0;
  for (let i = 0; i < n; i++) {
    offsets[i + 1] = offsets[i]! + Math.max(0, pageHeightsPx[i] ?? 0) + gap;
  }
  const total = offsets[n]!;

  const top = Math.max(0, scrollTopPx);
  // 覆盖页：最后一个 offsets[i] <= top 的页（滚动位置所在页）
  let cover = 0;
  let lo = 0;
  let hi = n - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid]! <= top) {
      cover = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const start = Math.max(0, Math.min(n - 1, cover - overscan));

  // 可见终点：从覆盖页页顶起累计一屏（+间距）的最后一页
  const target = offsets[cover]! + Math.max(0, viewportHeightPx);
  let visibleEnd = n - 1;
  lo = 0;
  hi = n - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid + 1]! < target) {
      lo = mid + 1;
    } else {
      visibleEnd = mid;
      hi = mid - 1;
    }
  }
  const end = Math.min(n - 1, visibleEnd + overscan);

  const padTopPx = offsets[start]!;
  const padBottomPx = Math.max(0, total - offsets[end + 1]!);

  return { start, end, padTopPx, padBottomPx };
}
