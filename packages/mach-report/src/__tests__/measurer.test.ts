// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  createCanvasMeasurer,
  createHeuristicMeasurer,
  heuristicMeasurer,
  measureTextMm,
  wrapText
} from "../layout/textwrap";
import { paginateTemplate } from "../layout/paginate";
import type { ReportTemplate } from "../layout/paginate";

describe("TextMeasurer 注入", () => {
  it("默认启发式与 createHeuristicMeasurer 等价", () => {
    const a = measureTextMm("合金钢Q355B", { fontSizePt: 10.5 });
    const b = createHeuristicMeasurer().measureMm("合金钢Q355B", { fontSizePt: 10.5 });
    expect(a).toBeCloseTo(b, 10);
  });

  it("自定义测量器改变折行结果（宽表测量→更少行）", () => {
    const text = "steel billet specification";
    const opts = { fontSizePt: 10.5 };
    const narrow = wrapText(text, 20, opts, {
      measureMm: (t) => measureTextMm(t, opts) * 2
    });
    const normal = wrapText(text, 20, opts);
    expect(narrow.length).toBeGreaterThanOrEqual(normal.length);
  });

  it("createCanvasMeasurer 无 2D 环境时回退启发式（Node 安全）", () => {
    const m = createCanvasMeasurer(() => null);
    expect(m.measureMm("中A1", { fontSizePt: 10.5 })).toBeCloseTo(
      heuristicMeasurer.measureMm("中A1", { fontSizePt: 10.5 }),
      10
    );
  });

  it("分页引擎接受注入测量器", () => {
    const tpl: ReportTemplate = {
      pages: [
        {
          widthMm: 210,
          heightMm: 297,
          components: [
            {
              kind: "list",
              leftMm: 10,
              topMm: 10,
              widthMm: 190,
              dataset: "rows",
              columns: [{ header: "名称", field: "name", widthMm: 40 }]
            }
          ]
        }
      ]
    };
    const rows = { rows: [{ name: "很长很长的物料名称需要折行" }] };
    const double = paginateTemplate(tpl, rows, {
      measurer: { measureMm: (t, o) => measureTextMm(t, o) * 2 }
    });
    const normal = paginateTemplate(tpl, rows);
    const heightOf = (r: ReturnType<typeof paginateTemplate>) =>
      r.plan.pages[0]!.components.find((c) => c.nid?.startsWith("listr"))!.heightMm;
    expect(heightOf(double)).toBeGreaterThan(heightOf(normal));
  });
});
