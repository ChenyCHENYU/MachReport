import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import ReportPreview from "../ReportPreview.vue";
import type { PlanFetcher } from "../adapters";

describe("坏数据防御", () => {
  it("fetcher 返回坏计划时给出行级校验错误", async () => {
    const badFetcher = (async () => ({
      schemaVersion: "x",
      pages: [{ pageWidthMm: -1, pageHeightMm: "abc" as unknown as number, components: "oops" as unknown as [] }]
    })) as unknown as PlanFetcher;
    const onError = vi.fn();
    const wrapper = mount(ReportPreview, {
      props: { reportId: "X", fetcher: badFetcher, onError }
    });
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    const msg = String(onError.mock.calls[0]![0]);
    expect(msg).toContain("渲染计划校验失败");
    expect(msg).toContain("$.pages.0");
    expect(wrapper.text()).toContain("校验失败");
  });

  it("未知 kind 走 warning 不阻断渲染", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetcher = (async () => ({
      schemaVersion: "x",
      pages: [
        {
          pageWidthMm: 210,
          pageHeightMm: 297,
          components: [
            { kind: "mystery", leftMm: 0, topMm: 0, widthMm: 40, heightMm: 10, fallbackText: "兜底" }
          ]
        }
      ]
    })) as unknown as PlanFetcher;
    const onLoaded = vi.fn();
    const wrapper = mount(ReportPreview, {
      props: { reportId: "X", fetcher, onLoaded }
    });
    await vi.waitFor(() => expect(onLoaded).toHaveBeenCalled());
    expect(wrapper.text()).toContain("兜底");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
