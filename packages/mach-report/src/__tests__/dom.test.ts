import { describe, expect, it } from "vitest";
import { renderPlan, renderPage } from "../render/dom";
import { toRenderPlan } from "../schema/render-plan";
import { paginateTemplate } from "../layout/paginate";
import type { PlanPage } from "../schema/render-plan";

function dom(): Document {
  return document.implementation.createHTMLDocument("test");
}

describe("dom renderer", () => {
  it("toRenderPlan 解析 200 响应", () => {
    const plan = toRenderPlan({
      code: 200,
      data: { pages: [{ pageWidthMm: 210, pageHeightMm: 297, components: [] }] }
    });
    expect(plan.pages).toHaveLength(1);
    expect(plan.schemaVersion).toBe("1.0.0-mach");
  });

  it("非 200 抛错并带 message", () => {
    expect(() => toRenderPlan({ code: 500, message: "boom" })).toThrowError("boom");
  });

  it("缺 pages 容错为空数组", () => {
    expect(toRenderPlan({ code: 200, data: null }).pages).toEqual([]);
    expect(toRenderPlan({}).pages).toEqual([]);
  });

  it("渲染页面尺寸 mm→px 正确", () => {
    const doc = dom();
    const page: PlanPage = {
      pageWidthMm: 210,
      pageHeightMm: 297,
      components: []
    };
    const el = renderPage(page, 96, {}, doc);
    expect(el.style.width).toBe("793.7px");
    expect(el.style.height).toBe("1122.52px");
  });

  it("文本组件绝对定位与字号", () => {
    const doc = dom();
    const plan = toRenderPlan({
      code: 200,
      data: {
        pages: [
          {
            pageWidthMm: 210,
            pageHeightMm: 297,
            components: [
              {
                kind: "text",
                leftMm: 10,
                topMm: 20,
                widthMm: 50,
                heightMm: 8,
                text: "hello",
                style: { fontSize: 12, bold: true }
              }
            ]
          }
        ]
      }
    });
    const root = renderPlan(plan, doc);
    const comp = root.querySelector(".mr-comp") as HTMLElement;
    expect(comp).toBeTruthy();
    expect(comp.className).toContain("mr-kind-text");
    expect(comp.style.position).toBe("absolute");
    expect(comp.querySelector(".mr-text")!.textContent).toBe("hello");
  });

  it("lines 预折行渲染为多行", () => {
    const doc = dom();
    const plan = toRenderPlan({
      code: 200,
      data: {
        pages: [
          {
            pageWidthMm: 210,
            pageHeightMm: 297,
            components: [
              {
                kind: "text",
                leftMm: 0,
                topMm: 0,
                widthMm: 60,
                heightMm: 20,
                lines: ["第一行", "第二行"]
              }
            ]
          }
        ]
      }
    });
    const root = renderPlan(plan, doc);
    expect(root.querySelectorAll(".mr-line")).toHaveLength(2);
  });

  it("imageData 的 barcode 按图片渲染", () => {
    const doc = dom();
    const plan = toRenderPlan({
      code: 200,
      data: {
        pages: [
          {
            pageWidthMm: 210,
            pageHeightMm: 297,
            components: [
              {
                kind: "barcode",
                leftMm: 0,
                topMm: 0,
                widthMm: 40,
                heightMm: 12,
                imageData: "data:image/png;base64,xxx"
              }
            ]
          }
        ]
      }
    });
    const root = renderPlan(plan, doc);
    const img = root.querySelector(".mr-image") as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.src).toContain("data:image/png");
  });

  it("grid 单元格与表头渲染", () => {
    const doc = dom();
    const { plan } = paginateTemplate(
      {
        pages: [
          {
            widthMm: 210,
            heightMm: 297,
            marginTopMm: 10,
            components: [
              {
                kind: "list",
                leftMm: 10,
                topMm: 10,
                widthMm: 190,
                dataset: "d",
                columns: [
                  { header: "编码", field: "code", widthMm: 90 },
                  { header: "数量", field: "qty", widthMm: 100 }
                ]
              }
            ]
          }
        ]
      },
      { d: [{ code: "A1", qty: 3 }] }
    );
    const root = renderPlan(plan, doc);
    expect(root.querySelectorAll(".mr-page").length).toBe(1);
    expect(root.querySelectorAll(".mr-grid").length).toBeGreaterThanOrEqual(2);
    expect(root.textContent).toContain("编码");
    expect(root.textContent).toContain("A1");
  });

  it("rich 段落渲染", () => {
    const doc = dom();
    const plan = toRenderPlan({
      code: 200,
      data: {
        pages: [
          {
            pageWidthMm: 210,
            pageHeightMm: 297,
            components: [
              {
                kind: "text",
                leftMm: 0,
                topMm: 0,
                widthMm: 80,
                heightMm: 30,
                richParagraphs: [
                  {
                    segments: [
                      { kind: "text", text: "备注：" },
                      { kind: "text", text: "加急", style: { bold: true, color: "#c00" } }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    });
    const root = renderPlan(plan, doc);
    expect(root.querySelectorAll(".mr-paragraph")).toHaveLength(1);
    expect(root.querySelectorAll(".mr-segment")).toHaveLength(2);
    expect(root.textContent).toContain("备注：加急");
  });
});
