import { describe, expect, it } from "vitest";
import { renderPlan, renderPage } from "../render/dom";
import { paginateTemplate } from "../layout/paginate";
import { RENDER_PLAN_SCHEMA_VERSION, type PlanPage, type RenderPlan } from "../schema/render-plan";

function dom(): Document {
  return document.implementation.createHTMLDocument("test");
}

function makePlan(pages: PlanPage[]): RenderPlan {
  return { schemaVersion: RENDER_PLAN_SCHEMA_VERSION, pages };
}

describe("dom renderer", () => {
  it("渲染页面尺寸 mm→px 正确", () => {
    const page: PlanPage = { pageWidthMm: 210, pageHeightMm: 297, components: [] };
    const el = renderPage(page, 96, {}, dom());
    expect(el.style.width).toBe("793.7px");
    expect(el.style.height).toBe("1122.52px");
  });

  it("文本组件绝对定位与字号", () => {
    const plan = makePlan([{
      pageWidthMm: 210, pageHeightMm: 297,
      components: [{
        kind: "text", leftMm: 10, topMm: 20, widthMm: 50, heightMm: 8,
        text: "hello", style: { fontSize: 12, bold: true }
      }]
    }]);
    const comp = renderPlan(plan, dom()).querySelector(".mr-comp") as HTMLElement;
    expect(comp).toBeTruthy();
    expect(comp.className).toContain("mr-kind-text");
    expect(comp.style.position).toBe("absolute");
    expect(comp.querySelector(".mr-text")!.textContent).toBe("hello");
  });

  it("lines 预折行渲染为多行", () => {
    const plan = makePlan([{
      pageWidthMm: 210, pageHeightMm: 297,
      components: [{
        kind: "text", leftMm: 0, topMm: 0, widthMm: 60, heightMm: 20,
        lines: ["第一行", "第二行"]
      }]
    }]);
    expect(renderPlan(plan, dom()).querySelectorAll(".mr-line")).toHaveLength(2);
  });

  it("imageData 的 barcode 按图片渲染", () => {
    const plan = makePlan([{
      pageWidthMm: 210, pageHeightMm: 297,
      components: [{
        kind: "barcode", leftMm: 0, topMm: 0, widthMm: 40, heightMm: 12,
        imageData: "data:image/png;base64,xxx"
      }]
    }]);
    const img = renderPlan(plan, dom()).querySelector(".mr-image") as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.src).toContain("data:image/png");
  });

  it("grid 单元格与表头渲染", () => {
    const { plan } = paginateTemplate(
      { pages: [{
        widthMm: 210, heightMm: 297, marginTopMm: 10,
        components: [{
          kind: "list", leftMm: 10, topMm: 10, widthMm: 190, dataset: "d",
          columns: [
            { header: "编码", field: "code", widthMm: 90 },
            { header: "数量", field: "qty", widthMm: 100 }
          ]
        }]
      }] },
      { d: [{ code: "A1", qty: 3 }] }
    );
    const root = renderPlan(plan, dom());
    expect(root.querySelectorAll(".mr-page").length).toBe(1);
    expect(root.querySelectorAll(".mr-grid").length).toBeGreaterThanOrEqual(2);
    expect(root.textContent).toContain("编码");
    expect(root.textContent).toContain("A1");
  });

  it("rich 段落渲染", () => {
    const plan = makePlan([{
      pageWidthMm: 210, pageHeightMm: 297,
      components: [{
        kind: "text", leftMm: 0, topMm: 0, widthMm: 80, heightMm: 30,
        richParagraphs: [{ segments: [
          { kind: "text", text: "备注：" },
          { kind: "text", text: "加急", style: { bold: true, color: "#c00" } }
        ] }]
      }]
    }]);
    const root = renderPlan(plan, dom());
    expect(root.querySelectorAll(".mr-paragraph")).toHaveLength(1);
    expect(root.querySelectorAll(".mr-segment")).toHaveLength(2);
    expect(root.textContent).toContain("备注：加急");
  });
});
