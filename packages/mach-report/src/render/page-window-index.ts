import type { PageWindow } from "./window";

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** 内部几何索引：页尺寸变化时建立一次，滚动及跳页只做二分/坐标读取。 */
export function createPageWindowIndex(pageHeightsPx: readonly number[], gapPx = 0) {
  const n = pageHeightsPx.length;
  const gap = nonNegative(gapPx);
  const offsets = new Array<number>(n + 1);
  offsets[0] = 0;
  for (let i = 0; i < n; i++) {
    offsets[i + 1] = offsets[i]! + nonNegative(pageHeightsPx[i] ?? 0) + gap;
  }
  const totalHeightPx = offsets[n]!;

  /** 最后一个页顶 <= 坐标的页，边界限定在实际页区间内。 */
  function pageAt(position: number): number {
    let lo = 0;
    let hi = n - 1;
    let page = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (offsets[mid]! <= position) {
        page = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return page;
  }

  function window(viewportHeightPx: number, scrollTopPx: number, overscan = 1): PageWindow {
    if (n === 0) return { start: 0, end: -1, padTopPx: 0, padBottomPx: 0 };
    const extra = Math.floor(nonNegative(overscan));
    const top = nonNegative(scrollTopPx);
    const cover = pageAt(top);
    const start = Math.max(0, cover - extra);
    // 视口终点以真实滚动位置为起点；页内滚动不能遗漏屏幕下半部分。
    const target = top + nonNegative(viewportHeightPx);
    let lo = cover;
    let hi = n - 1;
    let visibleEnd = n - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (offsets[mid + 1]! < target) lo = mid + 1;
      else {
        visibleEnd = mid;
        hi = mid - 1;
      }
    }
    const end = Math.min(n - 1, visibleEnd + extra);
    return {
      start, end,
      padTopPx: offsets[start]!,
      padBottomPx: Math.max(0, totalHeightPx - offsets[end + 1]!)
    };
  }

  return {
    totalHeightPx,
    pageAt,
    offsetAt: (index: number) => offsets[Math.max(0, Math.min(n, Math.floor(index)))] ?? 0,
    window
  };
}

