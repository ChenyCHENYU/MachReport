import { describe, expect, it } from "vitest";
import { createTemplate } from "../builder/template-builder";
import { paginateTemplate, renderPlan } from "../index";

describe("template builder DSL", () => {
  it("单页快路径：链式直接 build", () => {
    const template = createTemplate()
      .page(210, 297, { marginTopMm: 12 })
      .text("出库单", { leftMm: 70, topMm: 2, widthMm: 70 }, { fontSize: 16, bold: true, align: "center" })
      .list(
        "detail",
        { leftMm: 12, topMm: 20, widthMm: 186 },
        [
          { header: "序号", field: "no", widthMm: 30 },
          { header: "名称", field: "name", widthMm: 156 }
        ],
        { fontSizePt: 10 }
      )
      .build();
    expect(template.pages).toHaveLength(1);
    expect(template.pages[0]!.components).toHaveLength(2);
  });

  it("多页：done() 回到容器再 page()", () => {
    const t = createTemplate();
    t.page().text("第一页", { topMm: 5 });
    t.page().text("第二页", { topMm: 5 });
    const template = t.build();
    expect(template.pages).toHaveLength(2);
    expect((template.pages[1]!.components[0] as { text?: string }).text).toBe("第二页");
  });

  it("builder 产物直接进分页渲染管线", () => {
    const template = createTemplate()
      .page()
      .text("标题", { leftMm: 60, widthMm: 90 })
      .barcode("CODE-001", { leftMm: 10, topMm: 15, widthMm: 40, heightMm: 12 })
      .line(10, 30, 190)
      .list("d", { topMm: 35 }, [{ header: "N", field: "n", widthMm: 180 }])
      .build();
    const { plan } = paginateTemplate(template, {
      d: Array.from({ length: 50 }, (_, i) => ({ n: `行${i}` }))
    });
    expect(plan.pages.length).toBeGreaterThan(1);
    const doc = document.implementation.createHTMLDocument("b");
    const el = renderPlan(plan, doc);
    expect(el.textContent).toContain("标题");
    expect(el.textContent).toContain("行49");
  });

  it("空模板抛错", () => {
    expect(() => createTemplate().build()).toThrowError(/至少需要一页/);
  });

  it(".params() 声明进入模板（渲染面板据此生成查询条件）", () => {
    const t = createTemplate()
      .params([
        { field: "whCode", label: "仓库", type: "select", required: true, options: [{ label: "1号库", value: "W1" }] },
        { field: "date", label: "日期", type: "date", defaultValue: "2026-09-30" }
      ])
      .page("a4")
      .text("x", { topMm: 1 })
      .build();
    expect(t.params).toHaveLength(2);
    expect(t.params![0]!.required).toBe(true);
    expect(t.params![1]!.defaultValue).toBe("2026-09-30");
  });

  it("形状与条码快捷方法", () => {
    const template = createTemplate()
      .page()
      .rect({ leftMm: 0, topMm: 0, widthMm: 100, heightMm: 20 })
      .qrcode("https://x", 20, 5, 5)
      .build();
    const comps = template.pages[0]!.components;
    expect(comps.map((c) => c.kind)).toEqual(["rect", "qrcode"]);
  });
});
