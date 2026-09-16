import { describe, expect, it } from "vitest";
import { paginateTemplate, renderPlan, computePageWindow } from "../index";
import type { ReportTemplate } from "../index";

const tpl: ReportTemplate = {
  pages: [
    {
      widthMm: 210,
      heightMm: 297,
      marginTopMm: 12,
      marginBottomMm: 12,
      components: [
        {
          kind: "list",
          leftMm: 12,
          topMm: 20,
          widthMm: 186,
          dataset: "rows",
          fontSizePt: 10.5,
          columns: [
            { header: "序号", field: "no", widthMm: 30 },
            { header: "物料编码", field: "code", widthMm: 50 },
            { header: "物料名称", field: "name", widthMm: 70 },
            { header: "数量", field: "qty", widthMm: 36 }
          ]
        }
      ]
    }
  ]
};

function makeRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    no: String(i + 1),
    code: `WL-${1000 + i}`,
    name: `合金结构钢坯-${i + 1}`,
    qty: String(i * 7)
  }));
}

/**
 * 性能预算测试：防性能回归的硬门。
 * happy-dom 环境比真实浏览器慢，预算放宽；回归比例超过预算即失败。
 */
describe("性能预算", () => {
  it("分页 5000 行 < 600ms", () => {
    const rows = makeRows(5000);
    const t0 = performance.now();
    const { plan } = paginateTemplate(tpl, { rows });
    const cost = performance.now() - t0;
    expect(plan.pages.length).toBeGreaterThan(100);
    console.log(`[perf] paginate 5000 rows: ${cost.toFixed(1)}ms, ${plan.pages.length} pages`);
    expect(cost).toBeLessThan(600);
  });

  it("DOM 渲染单页耗时 < 50ms/页（happy-dom 上限口径）", () => {
    const { plan } = paginateTemplate(tpl, { rows: makeRows(1200) });
    const doc = document.implementation.createHTMLDocument("perf");
    const t0 = performance.now();
    const el = renderPlan(plan, doc);
    const cost = performance.now() - t0;
    const perPage = cost / plan.pages.length;
    console.log(`[perf] render ${plan.pages.length} pages: ${cost.toFixed(1)}ms (${perPage.toFixed(1)}ms/page), comps=${el.querySelectorAll(".mr-comp").length}`);
    expect(perPage).toBeLessThan(50);
  });

  it("窗口计算 1000 页 × 100 次 < 30ms", () => {
    const heights = Array.from({ length: 1000 }, () => 1122.5);
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) {
      computePageWindow({ pageHeightsPx: heights, viewportHeightPx: 800, scrollTopPx: i * 1122.5 });
    }
    const cost = performance.now() - t0;
    console.log(`[perf] computePageWindow 1000 pages x100: ${cost.toFixed(2)}ms`);
    expect(cost).toBeLessThan(30);
  });
});
