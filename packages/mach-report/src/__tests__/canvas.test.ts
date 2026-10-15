import { describe, expect, it, vi } from "vitest";
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


describe("Canvas 网格样式与内容区域", () => {
  it("继承组件字形和行高，cell显式字号单位/false覆盖，padding四边同源", () => {
    const calls: { text: string; font: string; color: string; x: number; y: number }[] = [];
    const context = {
      font: "", fillStyle: "", textAlign: "", textBaseline: "",
      scale: vi.fn(), fillRect: vi.fn(),
      fillText(text: string, x: number, y: number) {
        calls.push({ text, font: this.font, color: this.fillStyle, x, y });
      }
    };
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(context as unknown as CanvasRenderingContext2D);
    try {
      renderPlanToCanvas({ schemaVersion: "t", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [{
        kind: "rect", leftMm: 10, topMm: 10, widthMm: 60, heightMm: 20,
        style: { fontSizePx: 24, bold: true, italic: true, fontFamily: "serif", lineHeight: 2,
          color: "#123456", verticalAlign: "top", borderTop: false, borderRight: false, borderBottom: false, borderLeft: false },
        grid: { paddingMm: 1.5, cells: [[{ text: "ALPHA\nBETA" }, {
          text: "OVERRIDE", style: { fontSize: 12, bold: false, italic: false, color: "#f00" }
        }]] }
      }] }] }, { dpr: 1 });
      expect(calls[0]).toMatchObject({ text: "ALPHA", font: "italic bold 24px serif", color: "#123456" });
      expect(calls[1]!.y - calls[0]!.y).toBeCloseTo(48);
      expect(calls[0]!.x).toBeCloseTo(11.5 * 96 / 25.4);
      expect(calls[0]!.y).toBeCloseTo(11.5 * 96 / 25.4 + 24 * 0.8);
      expect(calls.find((call) => call.text === "OVERRIDE")).toMatchObject({ font: "16px serif", color: "#f00" });
    } finally {
      getContext.mockRestore();
    }
  });
});
