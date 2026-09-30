 
// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import ReportPreview from "../ReportPreview.vue";
import { createLocalFetcher } from "../local-adapter";
import { printPlans, buildPrintDocument } from "../composables/usePrintExport";
import { highlightTextNodes, clearHighlights } from "../composables/useHighlight";
import type { ReportTemplate } from "@agile-team/mach-report";

/** 两页计划：第 1 页含"合金结构钢"，第 2 页含"冷轧薄板" */
function twoPageTemplate(): ReportTemplate {
  return {
    pages: [
      {
        widthMm: 210,
        heightMm: 100,
        components: [
          { kind: "text", leftMm: 10, topMm: 10, widthMm: 100, heightMm: 8, text: "物料：合金结构钢" }
        ]
      },
      {
        widthMm: 210,
        heightMm: 100,
        components: [
          { kind: "text", leftMm: 10, topMm: 10, widthMm: 100, heightMm: 8, text: "物料：冷轧薄板" }
        ]
      }
    ]
  };
}

const localFetcher = () =>
  createLocalFetcher({ T1: { tempId: "T1", template: twoPageTemplate(), datasets: {} } });

async function mounted() {
  const wrapper = mount(ReportPreview, {
    props: { tempId: "T1", autoLoad: true, fetcher: localFetcher(), height: "400px" },
    attachTo: document.body
  });
  await vi.waitFor(() => {
    expect(wrapper.element.querySelectorAll(".mr-page").length).toBeGreaterThan(0);
  });
  return wrapper;
}

describe("交互：键盘翻页与缩放", () => {
  it("PageDown/PageUp/Home/End 翻页", async () => {
    const wrapper = await mounted();
    const vp = wrapper.element.querySelector(".mrp-body") as HTMLElement;
    vp.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", bubbles: true }));
    await vi.waitFor(() => expect(wrapper.text()).toMatch(/2 \/ 2/));
    vp.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    await vi.waitFor(() => expect(wrapper.text()).toMatch(/1 \/ 2/));
    wrapper.unmount();
  });

  it("+/- 键缩放（transform 数值变化且模式切 raw）", async () => {
    const wrapper = await mounted();
    const vp = wrapper.element.querySelector(".mrp-body") as HTMLElement;
    const before = (wrapper.element.querySelector(".mrp-scale-inner") as HTMLElement).style.transform;
    vp.dispatchEvent(new KeyboardEvent("keydown", { key: "+", bubbles: true }));
    await vi.waitFor(() => {
      const inner = wrapper.element.querySelector(".mrp-scale-inner") as HTMLElement;
      expect(inner.style.transform).not.toBe(before);
      expect(inner.style.transform).toMatch(/scale\(/);
    });
    wrapper.unmount();
  });

  it("缩放模式持久化到 localStorage 并恢复", async () => {
    localStorage.setItem("mach-report:ui", JSON.stringify({ zoomMode: 150 }));
    const wrapper = await mounted();
    await vi.waitFor(() => {
      const inner = wrapper.element.querySelector(".mrp-scale-inner") as HTMLElement;
      expect(inner.style.transform).toContain("1.5");
    });
    wrapper.unmount();
    localStorage.removeItem("mach-report:ui");
  });
});

describe("交互：搜索", () => {
  it("输入关键字 → 命中计数/跳页/高亮 mark", async () => {
    const wrapper = await mounted();
    // 打开搜索并输入
    const toggle = wrapper.findAll("button").find((b) => b.text().includes("🔍"))!;
    await toggle.trigger("click");
    const input = wrapper.element.querySelector(".mrp-search-input") as HTMLInputElement;
    input.value = "冷轧薄板";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => {
      expect(wrapper.text()).toMatch(/1\/1/);
    });
    // 跳到命中页（第 2 页）并出现高亮
    await vi.waitFor(() => {
      expect(wrapper.text()).toMatch(/2 \/ 2/);
      expect(wrapper.element.querySelectorAll("mark.mrp-hit").length).toBeGreaterThan(0);
    });
    wrapper.unmount();
  });

  it("清空关键字清除高亮", async () => {
    const wrapper = await mounted();
    const toggle = wrapper.findAll("button").find((b) => b.text().includes("🔍"))!;
    await toggle.trigger("click");
    const input = wrapper.element.querySelector(".mrp-search-input") as HTMLInputElement;
    input.value = "合金";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(wrapper.element.querySelectorAll("mark.mrp-hit").length).toBe(1));
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(wrapper.element.querySelectorAll("mark.mrp-hit").length).toBe(0));
    wrapper.unmount();
  });
});

describe("useHighlight", () => {
  it("多次命中包裹多个 mark，clear 还原文本", () => {
    const el = document.createElement("div");
    el.textContent = "钢钢钢";
    expect(highlightTextNodes(el, "钢")).toBe(3);
    expect(el.querySelectorAll("mark.mrp-hit")).toHaveLength(3);
    clearHighlights(el);
    expect(el.textContent).toBe("钢钢钢");
    expect(el.querySelectorAll("mark")).toHaveLength(0);
  });
});

describe("printPlans 批量打印（合并文档）", () => {
  it("多计划合并为一个打印文档（页数相加，纸张规则分组）", () => {
    const planA = {
      schemaVersion: "t",
      pages: [
        { pageWidthMm: 210, pageHeightMm: 297, components: [] },
        { pageWidthMm: 210, pageHeightMm: 297, components: [] }
      ]
    };
    const planB = {
      schemaVersion: "t",
      pages: [{ pageWidthMm: 297, pageHeightMm: 210, components: [] }]
    };
    const merged = { schemaVersion: "batch", pages: [...planA.pages, ...planB.pages] };
    const { head, pageChunks } = buildPrintDocument(merged as never);
    expect(pageChunks).toHaveLength(3);
    expect(head).toContain("p210x297");
    expect(head).toContain("p297x210");
    expect(typeof printPlans).toBe("function");
  });
});

describe("缩略图侧栏", () => {
  it("开关打开渲染页槽（占位即可，无 2D 环境时保留占位框）", async () => {
    const wrapper = await mounted();
    const thumbsBtn = wrapper.findAll("button").find((b) => b.text().includes("缩略图"))!;
    await thumbsBtn.trigger("click");
    await vi.waitFor(() => {
      const boxes = wrapper.element.querySelectorAll("[data-thumb]");
      expect(boxes.length).toBe(2);
    });
    wrapper.unmount();
  });
});
