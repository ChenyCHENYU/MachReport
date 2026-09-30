import { describe, expect, it } from "vitest";
import { measurePageSizePx, renderPlanToCanvas } from "../render/canvas";
import type { RenderPlan } from "../schema/render-plan";

const plan: RenderPlan = {
  schemaVersion: "t",
  pages: [
    {
      pageWidthMm: 210,
      pageHeightMm: 297,
      components: [
        {
          kind: "text",
          leftMm: 10,
          topMm: 10,
          widthMm: 100,
          heightMm: 10,
          text: "Canvas 后端",
          style: { fontSize: 14, bold: true }
        }
      ]
    }
  ]
};

describe("measurePageSizePx（纯计算）", () => {
  it("A4@96dpi = 794x1123", () => {
    const { widthPx, heightPx } = measurePageSizePx({ pageWidthMm: 210, pageHeightMm: 297 });
    expect(widthPx).toBe(794);
    expect(heightPx).toBe(1123);
  });

  it("dpi 缩放线性", () => {
    const a = measurePageSizePx({ pageWidthMm: 100, pageHeightMm: 100 }, 96);
    const b = measurePageSizePx({ pageWidthMm: 100, pageHeightMm: 100 }, 192);
    expect(b.widthPx).toBe(a.widthPx * 2);
  });

  it("非法尺寸兜底最小 1px", () => {
    expect(measurePageSizePx({ pageWidthMm: 0, pageHeightMm: -5 }).widthPx).toBe(1);
  });
});

describe("renderPlanToCanvas", () => {
  it("无 2D 环境抛明确错误（happy-dom），真浏览器由 E2E 覆盖", () => {
    const canvas = document.createElement("canvas");
    const supported = canvas.getContext != null && canvas.getContext("2d") != null;
    if (!supported) {
      expect(() => renderPlanToCanvas(plan)).toThrowError(/不支持 Canvas 2D/);
      return;
    }
    const { canvases } = renderPlanToCanvas(plan, { dpr: 2 });
    expect(canvases).toHaveLength(1);
    const { widthPx } = measurePageSizePx({ pageWidthMm: 210, pageHeightMm: 297 });
    expect(canvases[0]!.width).toBe(widthPx * 2);
  });
});
