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

  it("白纸正文不继承宿主浅色文字，显式单元格色仍有效", () => {
    const host = document.createElement("div");
    host.style.color = "#e8e8e8";
    const page = renderPage({
      pageWidthMm: 210, pageHeightMm: 40,
      components: [{
        kind: "rect", leftMm: 10, topMm: 10, widthMm: 100, heightMm: 10,
        grid: { cells: [[{ text: "默认正文" }, { text: "业务强调", style: { color: "#123456" } }]] }
      }]
    }, 96, {}, document);
    host.append(page);
    document.body.append(host);
    try {
      const cells = page.querySelectorAll("td");
      expect(["#000000", "rgb(0, 0, 0)"]).toContain(getComputedStyle(cells[0]!).color);
      expect(["#123456", "rgb(18, 52, 86)"]).toContain(getComputedStyle(cells[1]!).color);
    } finally {
      host.remove();
    }
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
  it("使用共享几何固定合并格、显式padding和单次边线，HTML回读不改变结构", () => {
    const el = renderPage({ pageWidthMm: 100, pageHeightMm: 100, components: [{
      kind: "rect", leftMm: 10, topMm: 10, widthMm: 60, heightMm: 20,
      style: { borderLeft: false, borderBottom: false },
      grid: { colWidthsMm: [20, 40], rowHeightsMm: [10, 10], paddingMm: 2, cells: [
        [{ text: "跨行", rowSpan: 2 }, { text: "右上" }], [{ text: "右下" }]
      ] }
    }] }, 96, {}, dom());
    const cells = el.querySelectorAll<HTMLTableCellElement>("td");
    expect(cells).toHaveLength(3);
    expect(cells[0]!.rowSpan).toBe(2);
    expect(cells[0]!.style.height).toBe("75.59px");
    expect(cells[2]!.style.left).toBe("75.59px");
    expect(cells[2]!.style.top).toBe("37.8px");
    expect(cells[0]!.querySelector<HTMLElement>(".mr-cell-content")!.style.left).toBe("7.56px");
    // One inner vertical, one span-aware horizontal, top and right outer edges.
    expect(el.querySelectorAll(".mr-grid-edge")).toHaveLength(4);
    const parsed = new DOMParser().parseFromString(el.outerHTML, "text/html");
    expect(parsed.querySelectorAll("table > tbody > tr > td")).toHaveLength(3);
    expect(parsed.querySelector("table .mr-grid-edge")).toBeNull();
    expect(parsed.querySelectorAll(".mr-grid-edge")).toHaveLength(4);
  });

  it("单元格继承组件字形，显式pt/px与false声明可分别覆盖", () => {
    const el = renderPage({ pageWidthMm: 100, pageHeightMm: 100, components: [{
      kind: "rect", leftMm: 0, topMm: 0, widthMm: 60, heightMm: 20,
      style: { fontSizePx: 24, bold: true, italic: true, lineHeight: 1.8 },
      grid: { cells: [[{ text: "继承", style: { color: "#123456" } }, {
        text: "覆盖", style: { fontSize: 12, bold: false, italic: false }
      }]] }
    }] }, 96, {}, dom());
    const cells = el.querySelectorAll<HTMLTableCellElement>("td");
    expect(cells[0]!.style.fontSize).toBe("24px");
    expect(cells[0]!.style.fontWeight).toBe("700");
    expect(cells[0]!.style.lineHeight).toBe("1.8");
    expect(cells[1]!.style.fontSize).toBe("16px");
    expect(cells[1]!.style.fontWeight).toBe("400");
    expect(cells[1]!.style.fontStyle).toBe("normal");
  });

  it("文本填满已定位组件，变换/透明度仅应用一次，富文本色彩不重置字号", () => {
    const el = renderPage({ pageWidthMm: 100, pageHeightMm: 100, components: [{
      kind: "text", leftMm: 0, topMm: 0, widthMm: 60, heightMm: 20,
      style: { fontSize: 18, verticalAlign: "middle", opacity: 0.5, rotateDeg: 15 },
      richParagraphs: [{ segments: [{ text: "强调", style: { color: "#c00" } }] }]
    }] }, 96, {}, dom());
    const comp = el.querySelector<HTMLElement>(".mr-comp")!;
    const text = el.querySelector<HTMLElement>(".mr-text")!;
    expect(comp.style.opacity).toBe("0.5");
    expect(comp.style.transform).toBe("rotate(15deg)");
    expect(text.style.opacity).toBe("");
    expect(text.style.transform).toBe("");
    expect(text.style.width).toBe("100%");
    expect(text.style.height).toBe("100%");
    expect(text.style.justifyContent).toBe("center");
    expect(el.querySelector<HTMLElement>(".mr-segment")!.style.fontSize).toBe("");
  });

});
