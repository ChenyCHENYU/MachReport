import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, provide } from "vue";
import ReportPreview from "../reportPreview.vue";
import ReportHtmlPreview from "../reportHtmlPreview.vue";
import FilePreview from "../filePreview.vue";
import { MACH_REPORT_FETCHER_KEY, createLocalFetcher } from "@agile-team/mach-report/vue";
import type { ReportTemplate } from "@agile-team/mach-report";

const tpl: ReportTemplate = {
  pages: [
    {
      widthMm: 210,
      heightMm: 297,
      components: [
        { kind: "text", leftMm: 10, topMm: 10, widthMm: 100, heightMm: 10, text: "联邦契约渲染" }
      ]
    }
  ]
};

const Host = defineComponent({
  setup(_, { slots }) {
    provide(MACH_REPORT_FETCHER_KEY, createLocalFetcher({
      F1: { tempId: "F1", template: tpl }
    }));
    return () => h("div", slots.default?.());
  }
});

describe("federation 入口", () => {
  it("reportPreview 通过 provide 注入 fetcher 渲染并 emit loaded", async () => {
    const onLoaded = vi.fn();
    const wrapper = mount(Host, {
      slots: { default: () => h(ReportPreview, { tempId: "F1", onLoaded }) }
    });
    await vi.waitFor(() => expect(onLoaded).toHaveBeenCalledWith(1));
    expect(wrapper.text()).toContain("报表预览");
  });

  it("未注入 fetcher 时 emit error（不崩溃）", async () => {
    const onError = vi.fn();
    mount(ReportPreview, { props: { tempId: "X", onError } });
    await vi.waitFor(() => expect(onError).toHaveBeenCalled(), { timeout: 4000 });
  });

  it("reportHtmlPreview 直接渲染 DOM", async () => {
    const onLoaded = vi.fn();
    const wrapper = mount(Host, {
      slots: { default: () => h(ReportHtmlPreview, { tempId: "F1", onLoaded }) }
    });
    await vi.waitFor(() => expect(onLoaded).toHaveBeenCalled());
    expect(wrapper.element.querySelectorAll(".mr-page").length).toBe(1);
    expect(wrapper.text()).toContain("联邦契约渲染");
  });

  it("filePreview 按扩展名分流", () => {
    const pdf = mount(FilePreview, { props: { src: "https://x/a.pdf" } });
    expect(pdf.element.querySelector("iframe")).toBeTruthy();
    const img = mount(FilePreview, { props: { src: "https://x/a.png" } });
    expect(img.element.querySelector("img")).toBeTruthy();
    const unknown = mount(FilePreview, { props: { src: "https://x/a.zip" } });
    expect(unknown.text()).toContain("暂不支持");
  });
});
