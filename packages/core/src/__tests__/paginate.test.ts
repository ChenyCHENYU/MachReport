// @vitest-environment node
import { describe, expect, it } from "vitest";
import { paginateTemplate } from "../layout/paginate";
import type { ListComponent, ReportTemplate } from "../layout/paginate";

const A4: ReportTemplate = {
  pages: [
    {
      widthMm: 210,
      heightMm: 297,
      marginTopMm: 15,
      marginBottomMm: 15,
      components: [
        {
          kind: "text",
          leftMm: 60,
          topMm: 5,
          widthMm: 90,
          heightMm: 10,
          text: "出库单",
          style: { fontSize: 14, bold: true, align: "center" }
        },
        {
          kind: "list",
          id: "detail",
          leftMm: 15,
          topMm: 20,
          widthMm: 180,
          dataset: "detail",
          fontSizePt: 10.5,
          columns: [
            { header: "序号", field: "no", widthMm: 20 },
            { header: "物料名称", field: "name", widthMm: 100 },
            { header: "数量", field: "qty", widthMm: 60 }
          ]
        }
      ]
    }
  ]
};

function makeRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    no: String(i + 1),
    name: `物料-${String(i + 1).padStart(4, "0")}`,
    qty: (i + 1) * 10
  }));
}

describe("paginateTemplate", () => {
  it("无数据时输出表头且告警", () => {
    const { plan, warnings } = paginateTemplate(A4, {});
    expect(plan.pages).toHaveLength(1);
    expect(warnings.some((w) => w.includes("detail"))).toBe(true);
    const comps = plan.pages[0]!.components;
    expect(comps.some((c) => c.nid?.startsWith("listh"))).toBe(true);
  });

  it("少量数据单页容纳", () => {
    const { plan } = paginateTemplate(A4, { detail: makeRows(5) });
    expect(plan.pages).toHaveLength(1);
    const rows = plan.pages[0]!.components.filter((c) => c.nid?.startsWith("listr"));
    expect(rows).toHaveLength(5);
  });

  it("超页自动分页且每页重复表头", () => {
    const { plan } = paginateTemplate(A4, { detail: makeRows(300) });
    expect(plan.pages.length).toBeGreaterThan(1);
    for (const page of plan.pages) {
      expect(page.components.some((c) => c.nid?.startsWith("listh"))).toBe(true);
    }
    const totalRows = plan.pages.reduce(
      (s, p) => s + p.components.filter((c) => c.nid?.startsWith("listr")).length,
      0
    );
    expect(totalRows).toBe(300);
  });

  it("headerEveryPage=false 时续页无表头", () => {
    const tpl: ReportTemplate = {
      pages: [
        {
          ...A4.pages[0]!,
          components: [
            A4.pages[0]!.components[0]!,
            { ...(A4.pages[0]!.components[1] as ListComponent), headerEveryPage: false }
          ]
        }
      ]
    };
    const { plan } = paginateTemplate(tpl, { detail: makeRows(300) });
    expect(plan.pages.length).toBeGreaterThan(1);
    const page2 = plan.pages[1]!;
    expect(page2.components.some((c) => c.nid?.startsWith("listh"))).toBe(false);
  });

  it("所有组件都不越出页底", () => {
    const { plan } = paginateTemplate(A4, { detail: makeRows(120) });
    for (const page of plan.pages) {
      const bottom = page.pageHeightMm - (page.marginBottomMm ?? 0);
      for (const comp of page.components) {
        expect(comp.topMm + comp.heightMm).toBeLessThanOrEqual(bottom + 0.01);
      }
    }
  });

  it("列宽超总宽自动缩放", () => {
    const tpl: ReportTemplate = {
      pages: [
        {
          ...A4.pages[0]!,
          components: [
            {
              ...(A4.pages[0]!.components[1] as ListComponent),
              widthMm: 100,
              columns: [
                { header: "A", field: "a", widthMm: 80 },
                { header: "B", field: "b", widthMm: 80 }
              ]
            }
          ]
        }
      ]
    };
    const { plan } = paginateTemplate(tpl, { detail: makeRows(3) });
    const gridComp = plan.pages[0]!.components.find((c) => c.nid?.startsWith("listr"));
    expect(gridComp).toBeTruthy();
    expect(gridComp!.widthMm).toBe(100);
  });

  it("多行内容行高增大", () => {
    const longName = "超长物料名称".repeat(20);
    const rows = [{ no: "1", name: longName, qty: 1 }];
    const { plan } = paginateTemplate(A4, { detail: rows });
    const rowComp = plan.pages[0]!.components.find((c) => c.nid?.startsWith("listr"))!;
    expect(rowComp.heightMm).toBeGreaterThan(8);
  });

  it("左右边距透传到 RenderPlan", () => {
    const tpl: ReportTemplate = {
      pages: [{ ...A4.pages[0]!, marginLeftMm: 8, marginRightMm: 9, components: [] }]
    };
    const { plan } = paginateTemplate(tpl, {});
    expect(plan.pages[0]!.marginLeftMm).toBe(8);
    expect(plan.pages[0]!.marginRightMm).toBe(9);
  });

  it("options 对象签名（mmPerRow/measurer）+ 旧数字签名兼容", () => {
    const r1 = paginateTemplate(A4, { detail: makeRows(5) }, { mmPerRow: 0.5 });
    const r2 = paginateTemplate(A4, { detail: makeRows(5) }, 0.5);
    expect(r1.plan.pages).toEqual(r2.plan.pages);
    expect(r1.plan.pages[0]!.components.filter((c) => c.nid?.startsWith("listr"))).toHaveLength(5);
  });

  it("border:false 时行/表头样式四边全关（下游 resolveBoxBorders 不画线）", () => {
    const tpl: ReportTemplate = {
      pages: [
        {
          ...A4.pages[0]!,
          components: [
            { ...(A4.pages[0]!.components[1] as ListComponent), border: false }
          ]
        }
      ]
    };
    const { plan } = paginateTemplate(tpl, { detail: makeRows(2) });
    const row = plan.pages[0]!.components.find((c) => c.nid?.startsWith("listr"))!;
    expect(row.style?.borderTop).toBe(false);
    expect(row.style?.borderBottom).toBe(false);
  });

  it("热路径样式驻留：同一列的行共享同一 style 对象引用", () => {
    const { plan } = paginateTemplate(A4, { detail: makeRows(10) });
    const rows = plan.pages.flatMap((p) => p.components.filter((c) => c.nid?.startsWith("listr")));
    const styleOf = (r: (typeof rows)[number]) => r.grid?.cells[0]?.[0]?.style;
    expect(styleOf(rows[0]!)).toBe(styleOf(rows[5]!));
  });
});
