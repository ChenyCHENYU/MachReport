// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTableTemplate, paginateTemplate, validateRenderPlan, wrapText } from "../index";
import type { ReportTemplate } from "../index";
import { resolveFontSize } from "../render/style";

function grouped(keepWithNext = true): ReportTemplate {
  return { pages: [{ widthMm: 100, heightMm: 45, components: [{
    kind: "list", leftMm: 0, topMm: 0, widthMm: 100, dataset: "detail", fontSizePt: 12,
    columns: [{ header: "内容", field: "text", widthMm: 100 }],
    groupBy: { field: "group", keepWithNext }
  }] }] };
}
const groupedRows = [{ group: "A", text: "短行" }, { group: "B", text: "一\n二\n三" }];

describe("分页与跨后端测量的一致性", () => {
  it("组头保留真实多行首行，而非按空行估算", () => {
    const { plan, warnings } = paginateTemplate(grouped(), { detail: groupedRows });
    expect(warnings).toEqual([]);
    expect(plan.pages).toHaveLength(2);
    const groupPage = plan.pages.findIndex((page) => page.components.some((component) => component.table?.role === "group-header" && component.grid?.cells[0]?.[0]?.text === "B"));
    const bodyPage = plan.pages.findIndex((page) => page.components.some((component) => component.table?.role === "body" && component.grid?.cells[0]?.[0]?.text === "一\n二\n三"));
    expect(groupPage).toBe(1);
    expect(bodyPage).toBe(groupPage);
  });

  it("关闭keepWithNext仍保留原有逐行流式分页选择", () => {
    const { plan } = paginateTemplate(grouped(false), { detail: groupedRows });
    expect(plan.pages[0]!.components.some((component) => component.table?.role === "group-header" && component.grid?.cells[0]?.[0]?.text === "B")).toBe(true);
    expect(plan.pages[1]!.components.some((component) => component.table?.role === "body")).toBe(true);
  });

  it("首行本身超过整页时不因防孤行额外插入空白表头页", () => {
    const { plan, warnings } = paginateTemplate(grouped(), { detail: [{ group: "A", text: "行\n".repeat(20) }] });
    expect(plan.pages.map((page) => page.components.map((component) => component.table?.role))).toEqual([
      ["header", "group-header"], ["header", "body"]
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("超出单页可用高度");
  });

  it("列表后声明的页码锚点仍出现在每页，复用模板不会污染占位符", () => {
    const template = createTableTemplate({ title: "页码回归", columns: [{ header: "名称", field: "name" }] });
    template.pages[0]!.heightMm = 65;
    template.pages[0]!.components.push({ kind: "text", leftMm: 10, topMm: 60, widthMm: 100, heightMm: 4, text: "{page}/{totalPages}" });
    const detail = Array.from({ length: 20 }, (_, index) => ({ name: `行${index}` }));
    const { plan } = paginateTemplate(template, { detail });
    expect(plan.pages.length).toBeGreaterThan(2);
    plan.pages.forEach((page, index) => expect(page.components.some((component) => component.text === `${index + 1}/${plan.pages.length}`)).toBe(true));
    expect(paginateTemplate(template, { detail }).plan.pages.length).toBe(plan.pages.length);
    const sourceComponents = template.pages[0]!.components;
    expect(sourceComponents[sourceComponents.length - 1]).toMatchObject({ text: "{page}/{totalPages}" });
  });

  it("所有列表角色传递实际内距，零内距也不被默认值覆盖", () => {
    for (const paddingMm of [0, 3]) {
      const template = createTableTemplate({ columns: [{ header: "名称", field: "name" }, { header: "数量", field: "qty" }], listOptions: { paddingMm, groupBy: { field: "name", subtotal: ["qty"] }, grandTotal: true } });
      const { plan } = paginateTemplate(template, { detail: [{ name: "A", qty: 3 }] });
      const fragments = plan.pages.flatMap((page) => page.components).filter((component) => component.table);
      expect(fragments).toHaveLength(5);
      expect(fragments.every((component) => component.grid?.paddingMm === paddingMm)).toBe(true);
      expect(validateRenderPlan(plan).ok).toBe(true);
      fragments[0]!.grid!.paddingMm = -1;
      expect(validateRenderPlan(plan).errors.some((error) => error.path.endsWith(".grid.paddingMm"))).toBe(true);
    }
  });

  it("点字号在表头、规则与汇总中覆盖父像素字号，测量使用最终样式", () => {
    const template = createTableTemplate({ columns: [
      { header: "名称", field: "name" },
      { header: "数量", field: "qty", style: { fontSizePx: 24 }, headerStyle: { fontSize: 10 }, rules: [{ when: { field: "qty", op: ">", value: 0 }, style: { fontSize: 12 } }] }
    ], listOptions: { grandTotal: { fields: ["qty"], style: { fontSize: 11 } } } });
    const components = paginateTemplate(template, { detail: [{ name: "A", qty: 2 }] }).plan.pages.flatMap((page) => page.components);
    const size = (role: string) => resolveFontSize(components.find((component) => component.table?.role === role)!.grid!.cells[0]![1]!.style).fontSizePt;
    expect(size("header")).toBe(10);
    expect(size("body")).toBe(12);
    expect(size("grand-total")).toBe(11);
  });

  it("CRLF与CR各占一个换行，不引入幽灵空行", () => {
    expect(wrapText("first\r\nsecond\rthird", 100, { fontSizePt: 10 })).toEqual(["first", "second", "third"]);
    expect(wrapText("\r\n\r", 100, { fontSizePt: 10 })).toEqual(["", "", ""]);
  });
});
