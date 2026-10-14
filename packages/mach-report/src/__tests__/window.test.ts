// @vitest-environment node
import { describe, expect, it } from "vitest";
import { computePageWindow } from "../render/window";
import { createPageWindowIndex } from "../render/page-window-index";

const H = [1000, 1000, 1000, 1000, 1000];

describe("computePageWindow", () => {
  it("空页数组", () => {
    const w = computePageWindow({ pageHeightsPx: [], viewportHeightPx: 800, scrollTopPx: 0 });
    expect(w).toEqual({ start: 0, end: -1, padTopPx: 0, padBottomPx: 0 });
  });

  it("顶部视口：首屏渲染第 0~2 页（含 overscan）", () => {
    const w = computePageWindow({ pageHeightsPx: H, viewportHeightPx: 800, scrollTopPx: 0, overscan: 1 });
    expect(w.start).toBe(0);
    expect(w.end).toBeGreaterThanOrEqual(1);
    expect(w.padTopPx).toBe(0);
    expect(w.padBottomPx).toBeGreaterThan(0);
  });

  it("滚动到中部只渲染中间窗口", () => {
    const w = computePageWindow({ pageHeightsPx: H, viewportHeightPx: 400, scrollTopPx: 2500, overscan: 1 });
    expect(w.start).toBeGreaterThanOrEqual(1);
    expect(w.end).toBeLessThanOrEqual(4);
    expect(w.padTopPx).toBeGreaterThan(0);
    expect(w.padBottomPx).toBeGreaterThan(0);
  });

  it("滚动到底部渲染末页且无下占位", () => {
    const w = computePageWindow({ pageHeightsPx: H, viewportHeightPx: 800, scrollTopPx: 4200, overscan: 1 });
    expect(w.end).toBe(4);
    expect(w.padBottomPx).toBe(0);
    expect(w.padTopPx).toBeGreaterThan(0);
  });

  it("占位高度总和 + 渲染页高度 = 总高度", () => {
    for (const scrollTop of [0, 700, 1500, 2600, 3999, 5000]) {
      const w = computePageWindow({ pageHeightsPx: H, viewportHeightPx: 800, scrollTopPx: scrollTop });
      const rendered = H.slice(w.start, w.end + 1).reduce((s, h) => s + h, 0);
      expect(w.padTopPx + rendered + w.padBottomPx).toBeCloseTo(H.reduce((s, h) => s + h, 0), 5);
    }
  });

  it("overscan=0 时仅渲染可见页", () => {
    const w = computePageWindow({ pageHeightsPx: H, viewportHeightPx: 800, scrollTopPx: 0, overscan: 0 });
    expect(w.start).toBe(0);
    expect(w.end).toBe(0);
  });

  it("gapPx 计入占位：padTop = Σ(页高+间距)", () => {
    const w = computePageWindow({
      pageHeightsPx: H,
      viewportHeightPx: 800,
      scrollTopPx: 2500,
      overscan: 1,
      gapPx: 18
    });
    const gap = 18;
    expect(w.padTopPx).toBeCloseTo(w.start * gap + H.slice(0, w.start).reduce((s, h) => s + h, 0), 5);
    const total = H.reduce((s, h) => s + h, 0) + H.length * gap;
    const rendered = H.slice(w.start, w.end + 1).reduce((s, h) => s + h, 0) +
      (w.end - w.start + 1) * gap;
    expect(w.padTopPx + rendered + w.padBottomPx).toBeCloseTo(total, 5);
  });

  it("gapPx 下滚到底无下占位", () => {
    const w = computePageWindow({
      pageHeightsPx: H,
      viewportHeightPx: 800,
      scrollTopPx: 6000,
      overscan: 1,
      gapPx: 18
    });
    expect(w.end).toBe(4);
    expect(w.padBottomPx).toBe(0);
  });

  it("页内滚动时覆盖真实视口终点，overscan=0 也不遗漏下一页", () => {
    const w = computePageWindow({ pageHeightsPx: [1000, 1000], viewportHeightPx: 800, scrollTopPx: 900, overscan: 0 });
    expect(w).toEqual({ start: 0, end: 1, padTopPx: 0, padBottomPx: 0 });
  });

  it("缓存索引支持混合页高、跳页、零视口与异常输入的有界窗口", () => {
    const index = createPageWindowIndex([300, 1000, 400], 20);
    expect(index.offsetAt(2)).toBe(1340);
    expect(index.totalHeightPx).toBe(1760);
    expect(index.window(600, 1100, 0)).toMatchObject({ start: 1, end: 2 });
    expect(index.window(0, 320, 0)).toMatchObject({ start: 1, end: 1 });
    expect(index.window(Number.NaN, Number.NaN, -1)).toMatchObject({ start: 0, end: 0 });
  });
});
