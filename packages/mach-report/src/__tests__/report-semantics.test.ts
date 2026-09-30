// @vitest-environment node
import { describe, expect, it } from "vitest";
import { paginateTemplate } from "../layout/paginate";
import type { ListComponent, ReportTemplate } from "../layout/paginate";
import { formatValue } from "../format";

function listWith(extras: Partial<ListComponent>): ListComponent {
  return {
    kind: "list",
    leftMm: 10,
    topMm: 10,
    widthMm: 190,
    dataset: "detail",
    columns: [
      { header: "物料", field: "name", widthMm: 90 },
      { header: "数量", field: "qty", widthMm: 50 },
      { header: "金额", field: "amount", widthMm: 50 }
    ],
    ...extras
  };
}

/** 构造单页模板（components 为页组件列表） */
const page = (
  components: Parameters<typeof paginateTemplate>[0]["pages"][number]["components"]
): ReportTemplate => ({
  pages: [{ widthMm: 210, heightMm: 297, components }]
});

describe("列格式化", () => {
  it("千分位 + 小数位", () => {
    expect(formatValue(1234567.891, { kind: "number", thousands: true, digits: 2 })).toBe("1,234,567.89");
    expect(formatValue(1234567, { kind: "number", thousands: true })).toBe("1,234,567");
    expect(formatValue("1234567.8", { kind: "number", thousands: true, digits: 2 })).toBe("1,234,567.80");
  });

  it("百分比与日期", () => {
    expect(formatValue(0.1234, { kind: "percent" })).toBe("12.34%");
    expect(formatValue(new Date("2026-09-30T08:09:05"), { kind: "date" })).toBe("2026-09-30");
    expect(formatValue(new Date("2026-09-30T08:09:05"), { kind: "date", pattern: "YYYY/MM/DD hh:mm" })).toBe("2026/09/30 08:09");
    expect(formatValue("2026-09-30", { kind: "date", pattern: "MM-DD" })).toBe("09-30");
  });

  it("非法值降级原样返回", () => {
    expect(formatValue("abc", { kind: "number", thousands: true })).toBe("abc");
    expect(formatValue(null, { kind: "percent" })).toBe("");
  });

  it("分页输出消费列格式化", () => {
    const { plan } = paginateTemplate(
      page([listWith({
        columns: [
          { header: "物料", field: "name", widthMm: 90 },
          { header: "金额", field: "amount", widthMm: 100, format: { kind: "number", thousands: true, digits: 2 } }
        ]
      })]),
      { detail: [{ name: "钢卷", amount: 1234567.5 }] }
    );
    const row = plan.pages[0]!.components.find((c) => c.nid?.startsWith("listr"))!;
    expect(row.grid?.cells[0]?.[1]?.text).toBe("1,234,567.50");
  });
});

describe("页码占位符", () => {
  it("{page}/{totalPages} 两遍回填", () => {
    const tpl: ReportTemplate = {
      pages: [
        {
          widthMm: 210,
          heightMm: 297,
          components: [
            { kind: "text", leftMm: 80, topMm: 280, widthMm: 50, heightMm: 6, text: "第 {page} 页 / 共 {totalPages} 页" },
            listWith({})
          ]
        }
      ]
    };
    const rows = Array.from({ length: 120 }, (_, i) => ({ name: `物料${i}`, qty: 1, amount: 2 }));
    const { plan } = paginateTemplate(tpl, { detail: rows });
    expect(plan.pages.length).toBeGreaterThan(3);
    const footers = plan.pages.map((p) =>
      p.components.find((c) => c.kind === "text" && c.text?.includes("第"))?.text
    );
    expect(footers[0]).toBe(`第 1 页 / 共 ${plan.pages.length} 页`);
    expect(footers[footers.length - 1]).toBe(`第 ${plan.pages.length} 页 / 共 ${plan.pages.length} 页`);
  });

  it("模板对象不被占位符污染（可复用分页）", () => {
    const comp = { kind: "text" as const, leftMm: 1, topMm: 1, widthMm: 50, heightMm: 6, text: "{page}" };
    const tpl = page([comp, listWith({})]);
    paginateTemplate(tpl, { detail: Array.from({ length: 80 }, () => ({ name: "x", qty: 1, amount: 1 })) });
    expect(comp.text).toBe("{page}");
  });
});

describe("分组小计与总合计", () => {
  const rows = [
    { name: "螺纹钢", wh: "1号库", qty: 10, amount: 100 },
    { name: "热轧卷", wh: "1号库", qty: 5, amount: 50 },
    { name: "冷轧板", wh: "2号库", qty: 8, amount: 80 }
  ];

  it("组头/组尾小计/总合计结构与数值", () => {
    const { plan } = paginateTemplate(
      page([
        listWith({
          groupBy: { field: "wh", headerTemplate: "仓库：{value}", subtotal: ["qty", "amount"] },
          grandTotal: true
        })
      ]),
      { detail: rows }
    );
    const texts: string[] = [];
    const collect = (cells: unknown): void => {
      if (!Array.isArray(cells)) return;
      for (const row of cells as { text?: string }[][]) {
        for (const cell of row ?? []) texts.push(String(cell?.text ?? ""));
      }
    };
    for (const c of plan.pages[0]!.components) {
      if (c.grid) collect(c.grid.cells);
    }
    expect(texts).toContain("仓库：1号库");
    expect(texts).toContain("仓库：2号库");
    expect(texts).toContain("小计");
    expect(texts).toContain("15");   // 1号库 qty 小计
    expect(texts).toContain("150");  // 1号库 amount 小计
    expect(texts).toContain("合计");
    expect(texts).toContain("23");   // 总 qty
    expect(texts).toContain("230");  // 总 amount
  });

  it("组头防孤行：组头+首行放不下时整体换页", () => {
    // 行高 ~8mm：塞 33 行贴近页底，使第 2 组组头落在页尾
    const many = Array.from({ length: 33 }, (_, i) => ({ name: `m${i}`, wh: "A", qty: 1, amount: 1 }));
    many.push({ name: "x", wh: "B", qty: 1, amount: 1 });
    const { plan } = paginateTemplate(
      page([listWith({ groupBy: { field: "wh", subtotal: ["qty"] } })]),
      { detail: many }
    );
    if (plan.pages.length > 1) {
      // 若发生换页，B 组组头必须在新页（不在旧页最后一行）
      const lastOfFirst = plan.pages[0]!.components.filter((c) => c.nid?.startsWith("list")).slice(-1)[0];
      expect(lastOfFirst?.nid?.startsWith("listg")).toBeFalsy();
    }
  });

  it("grandTotal 无字段时告警不报错", () => {
    const { warnings } = paginateTemplate(page([listWith({ grandTotal: true })]), { detail: rows });
    expect(warnings.some((w) => w.includes("grandTotal"))).toBe(true);
  });
});

describe("条件格式规则", () => {
  it("命中行合并样式，未命中保持驻留引用", () => {
    const { plan } = paginateTemplate(
      page([
        listWith({
          columns: [
            { header: "物料", field: "name", widthMm: 90 },
            {
              header: "数量", field: "qty", widthMm: 100,
              rules: [{ when: { field: "qty", op: "<", value: 0 }, style: { color: "#cc0000", bold: true } }]
            }
          ]
        })
      ]),
      { detail: [{ name: "正常", qty: 5 }, { name: "红字", qty: -3 }] }
    );
    const rowComps = plan.pages[0]!.components.filter((c) => c.nid?.startsWith("listr"));
    const normalStyle = rowComps[0]!.grid?.cells[0]?.[1]?.style;
    const hitStyle = rowComps[1]!.grid?.cells[0]?.[1]?.style;
    expect(hitStyle?.color).toBe("#cc0000");
    expect(hitStyle?.bold).toBe(true);
    expect(normalStyle?.color).toBeUndefined();
  });
});
