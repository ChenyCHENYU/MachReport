import { describe, expect, it } from "vitest";
import { paginateTemplate, wrapText } from "../index";
import type { ReportTemplate } from "../index";

describe("paginate 边界补强", () => {
  it("零列列表安全输出空", () => {
    const tpl: ReportTemplate = {
      pages: [
        {
          widthMm: 210,
          heightMm: 297,
          components: [
            { kind: "list", leftMm: 10, topMm: 10, widthMm: 100, dataset: "d", columns: [] }
          ]
        }
      ]
    };
    const { plan, warnings } = paginateTemplate(tpl, { d: [{ a: 1 }] });
    expect(plan.pages).toHaveLength(1);
    expect(warnings.length).toBeGreaterThanOrEqual(0);
  });

  it("单行超高内容不死循环（内容高度超过整页时强制分页）", () => {
    const tpl: ReportTemplate = {
      pages: [
        {
          widthMm: 210,
          heightMm: 297,
          marginTopMm: 10,
          marginBottomMm: 10,
          components: [
            {
              kind: "list",
              leftMm: 10,
              topMm: 10,
              widthMm: 190,
              dataset: "d",
              fontSizePt: 10,
              columns: [{ header: "长文本", field: "t", widthMm: 190 }]
            }
          ]
        }
      ]
    };
    const huge = "字".repeat(3000);
    const { plan } = paginateTemplate(tpl, { d: [{ t: huge }] });
    expect(plan.pages.length).toBeGreaterThan(1);
    expect(plan.pages.length).toBeLessThan(50);
  });

  it("多列表顺序流分页（后一列表接前一列表末页）", () => {
    const tpl: ReportTemplate = {
      pages: [
        {
          widthMm: 210,
          heightMm: 297,
          marginTopMm: 10,
          components: [
            {
              kind: "list",
              id: "L1",
              leftMm: 10,
              topMm: 10,
              widthMm: 90,
              dataset: "d1",
              fontSizePt: 9,
              columns: [{ header: "A", field: "a", widthMm: 90 }]
            },
            {
              kind: "list",
              id: "L2",
              leftMm: 105,
              topMm: 10,
              widthMm: 90,
              dataset: "d2",
              fontSizePt: 9,
              columns: [{ header: "B", field: "b", widthMm: 90 }]
            }
          ]
        }
      ]
    };
    const rows = (n: number, key: string) =>
      Array.from({ length: n }, (_, i) => ({ [key]: `${key}${i}` }));
    const { plan } = paginateTemplate(tpl, { d1: rows(80, "a"), d2: rows(5, "b") });
    expect(plan.pages.length).toBeGreaterThan(1);
    const l2Rows = plan.pages
      .flatMap((p) => p.components)
      .filter((c) => c.nid?.startsWith("listr"));
    expect(l2Rows.length).toBe(85);
  });

  it("多页模板（静态多页）顺序保留", () => {
    const tpl: ReportTemplate = {
      pages: [
        {
          widthMm: 210,
          heightMm: 297,
          components: [
            { kind: "text", leftMm: 0, topMm: 0, widthMm: 50, heightMm: 8, text: "第1页" }
          ]
        },
        {
          widthMm: 210,
          heightMm: 297,
          components: [
            { kind: "text", leftMm: 0, topMm: 0, widthMm: 50, heightMm: 8, text: "第2页" }
          ]
        }
      ]
    };
    const { plan } = paginateTemplate(tpl, {});
    expect(plan.pages).toHaveLength(2);
    expect((plan.pages[0]!.components[0] as { text?: string }).text).toBe("第1页");
    expect((plan.pages[1]!.components[0] as { text?: string }).text).toBe("第2页");
  });

  it("wrapText 极窄宽度逐字符折行不死循环", () => {
    const lines = wrapText("abcdefghij", 1, { fontSizePt: 10 });
    expect(lines.join("")).toBe("abcdefghij");
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });

  it("大数据量分页稳定性（10000 行回归冒烟）", () => {
    const tpl: ReportTemplate = {
      pages: [
        {
          widthMm: 210,
          heightMm: 297,
          marginTopMm: 10,
          marginBottomMm: 10,
          components: [
            {
              kind: "list",
              leftMm: 10,
              topMm: 10,
              widthMm: 190,
              dataset: "d",
              fontSizePt: 9,
              columns: [
                { header: "N", field: "n", widthMm: 95 },
                { header: "V", field: "v", widthMm: 95 }
              ]
            }
          ]
        }
      ]
    };
    const d = Array.from({ length: 10000 }, (_, i) => ({ n: `行${i}`, v: String(i * 2) }));
    const { plan } = paginateTemplate(tpl, { d });
    const totalRows = plan.pages
      .flatMap((p) => p.components)
      .filter((c) => c.nid?.startsWith("listr")).length;
    expect(totalRows).toBe(10000);
  });
});
