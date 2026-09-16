import { bench, describe } from "vitest";
import { Window } from "happy-dom";
import { paginateTemplate, renderPlan, computePageWindow } from "../index";
import type { ReportTemplate } from "../index";

const window_ = new Window();
const document = window_.document;

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

describe("engine benchmark", () => {
  bench("paginate 1,000 rows", () => {
    paginateTemplate(tpl, { rows: makeRows(1000) });
  });

  bench("paginate 5,000 rows", () => {
    paginateTemplate(tpl, { rows: makeRows(5000) });
  });

  bench("render 50 pages to DOM", () => {
    const { plan } = paginateTemplate(tpl, { rows: makeRows(1200) });
    renderPlan(plan, document.implementation.createHTMLDocument("b"));
  });

  bench("computePageWindow 1,000 pages", () => {
    const heights = Array.from({ length: 1000 }, () => 1122.5);
    for (let i = 0; i < 100; i++) {
      computePageWindow({
        pageHeightsPx: heights,
        viewportHeightPx: 800,
        scrollTopPx: i * 1122.5
      });
    }
  });
});
