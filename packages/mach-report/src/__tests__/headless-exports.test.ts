// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { renderPlanToImages } from "../render/canvas";
import { loadFontWithCache } from "../pdf/font-loader";
import { renderPlanToPdf } from "../pdf/render-pdf";
import type { RenderPlan } from "../schema/render-plan";

const plan: RenderPlan = {
  schemaVersion: "t",
  pages: [{ pageWidthMm: 210, pageHeightMm: 297, components: [] }]
};

describe("renderPlanToImages（图片导出）", () => {
  it("Node/SSR 环境给出清晰守卫错误（不静默产出空数据）", async () => {
    await expect(renderPlanToImages(plan)).rejects.toThrowError(/需要浏览器环境/);
  });
});

describe("font-loader 双环境（Node 无头通道）", () => {
  it("无 IndexedDB 环境不抛错：fetch 失败返回 null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net down")));
    try {
      await expect(loadFontWithCache("/simhei.ttf")).resolves.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("Node 环境字体加载成功后进内存缓存（二次零 fetch）", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => bytes.buffer
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const first = await loadFontWithCache("/f.ttf");
      expect(first).toEqual(bytes);
      const second = await loadFontWithCache("/f.ttf");
      expect(second).toEqual(bytes);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("Node 无头 PDF 通道（同引擎两端执行）", () => {
  it("renderPlanToPdf 在纯 Node 环境产出合法 PDF", async () => {
    const { bytes } = await renderPlanToPdf({
      schemaVersion: "t",
      pages: [
        {
          pageWidthMm: 210,
          pageHeightMm: 297,
          components: [
            { kind: "text", leftMm: 10, topMm: 10, widthMm: 80, heightMm: 8, text: "HEADLESS OK" }
          ]
        }
      ]
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });
});
