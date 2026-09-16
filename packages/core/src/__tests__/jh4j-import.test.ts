import { describe, expect, it } from "vitest";
import { importJh4jTemplateContent } from "../compat/jh4j-template";
import { paginateTemplate, renderPlan } from "../index";
import type { PlanComponent } from "../schema/render-plan";

const jh4jContent = {
  nid: "root_x",
  uitype: "tempContent",
  GlobalConfig: {
    paperSizeMode: "preset",
    paperPreset: "A4",
    paperWidthMm: 210,
    paperHeightMm: 297,
    marginTop: 12,
    marginBottom: 12,
    marginLeft: 10,
    marginRight: 10,
    watermarkEnabled: true
  },
  children: [
    {
      nid: "page_1",
      uitype: "page",
      Unit: "mm",
      width: 210,
      DesignHeight: 297,
      MarginTop: 12,
      MarginBottom: 12,
      MarginLeft: 10,
      MarginRight: 10,
      children: [
        {
          nid: "t1",
          uitype: "text",
          left: 60,
          top: 3,
          width: 90,
          height: 12,
          FontSize: "16",
          FontWeight: "bold",
          HorAlignment: "Center",
          FontColor: "#111",
          Text: "jh4j 导入标题"
        },
        {
          nid: "g1",
          uitype: "table",
          left: 10,
          top: 20,
          width: 190,
          height: 60,
          Cells: [
            [{ Text: "列1" }, { Text: "列2" }],
            [{ Text: "值1" }, { Text: "值2" }]
          ]
        },
        {
          nid: "h1",
          uitype: "hline",
          left: 10,
          top: 85,
          width: 190,
          height: 0.5
        },
        {
          nid: "bc1",
          uitype: "barcode",
          left: 10,
          top: 90,
          width: 40,
          height: 12
        },
        {
          nid: "sub1",
          uitype: "subreport",
          left: 0,
          top: 0,
          width: 10,
          height: 10
        }
      ]
    }
  ]
};

describe("importJh4jTemplateContent", () => {
  it("完整转换：文本样式/表格/线条", () => {
    const { template, warnings } = importJh4jTemplateContent(jh4jContent);
    expect(template.pages).toHaveLength(1);
    const page = template.pages[0]!;
    expect(page.widthMm).toBe(210);
    expect(page.heightMm).toBe(297);
    expect(page.components).toHaveLength(4);

    const title = page.components[0] as PlanComponent;
    expect(title.kind).toBe("text");
    expect(title.text).toBe("jh4j 导入标题");
    expect(title.style!.fontSize).toBe(16);
    expect(title.style!.bold).toBe(true);
    expect(title.style!.align).toBe("center");

    const table = page.components[1] as PlanComponent;
    expect(table.kind).toBe("rect");
    expect(table.grid!.cells).toHaveLength(2);
    expect(table.grid!.cells[0]![0]!.text).toBe("列1");

    const line = page.components[2] as PlanComponent;
    expect(line.kind).toBe("line");

    const barcode = page.components[3] as PlanComponent;
    expect(barcode.kind).toBe("barcode");

    expect(warnings.some((w) => w.includes("子报表"))).toBe(true);
    expect(warnings.some((w) => w.includes("imageData"))).toBe(true);
  });

  it("字符串 content 等价", () => {
    const a = importJh4jTemplateContent(jh4jContent);
    const b = importJh4jTemplateContent(JSON.stringify(jh4jContent));
    expect(b.template).toEqual(a.template);
  });

  it("坏 JSON / 空内容不抛错", () => {
    expect(importJh4jTemplateContent("not json").warnings[0]).toContain("JSON");
    expect(importJh4jTemplateContent(null as never).warnings[0]).toContain("空");
    expect(importJh4jTemplateContent({}).template.pages).toHaveLength(1);
  });

  it("转换结果可直接进入分页渲染管线", () => {
    const { template } = importJh4jTemplateContent(jh4jContent);
    const { plan } = paginateTemplate(template, {});
    expect(plan.pages).toHaveLength(1);
    const doc = document.implementation.createHTMLDocument("t");
    const el = renderPlan(plan, doc);
    expect(el.textContent).toContain("jh4j 导入标题");
    expect(el.textContent).toContain("值2");
  });

  it("未知 uitype 降级告警不阻断", () => {
    const r = importJh4jTemplateContent({
      children: [
        {
          uitype: "page",
          width: 210,
          DesignHeight: 297,
          children: [
            { uitype: "ufo", left: 0, top: 0, width: 10, height: 10 }
          ]
        }
      ]
    });
    expect(r.template.pages[0]!.components).toHaveLength(0);
    expect(r.warnings.some((w) => w.includes("ufo"))).toBe(true);
  });
});
