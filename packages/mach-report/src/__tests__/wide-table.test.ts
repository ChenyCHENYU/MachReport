// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  createReportSource,
  createTableTemplate,
  DEFAULT_FONT_PT,
  defineReportTemplate,
  paginateTemplate,
  parseReportTemplate,
  serializeReportTemplate,
  validateRenderPlan,
  validateReportTemplate,
  type ListComponent,
  type TableTemplateOptions
} from "../index";

function listOf(options: TableTemplateOptions): ListComponent {
  return createTableTemplate(options).pages[0]!.components.find((component) => component.kind === "list") as ListComponent;
}

describe("完整宽表模板", () => {
  it("82 列保留自然列宽、字体与全部字段，不压进 A4 可用宽度", () => {
    const columns = Array.from({ length: 82 }, (_, index) => ({ header: `指标${index + 1}`, field: `f${index}` }));
    const template = createTableTemplate({ layout: "wide", columns });
    const data = Array.from({ length: 60 }, (_, row) => Object.fromEntries(columns.map((column, index) => [column.field, row * 100 + index])));
    const before = structuredClone({ template, data });
    const { plan, warnings } = paginateTemplate(template, { detail: data });
    expect(warnings).toEqual([]);
    expect(plan.pages.length).toBeGreaterThan(1);
    expect(plan.pages.every((page) => page.layout === "wide" && page.pageWidthMm === 2480 && page.pageHeightMm <= 307)).toBe(true);
    const headers = plan.pages.flatMap((page) => page.components.filter((component) => component.table?.role === "header"));
    expect(headers).toHaveLength(plan.pages.length);
    expect(headers.every((header) => header.table?.rowIndex === -1 && header.grid?.colWidthsMm?.every((width) => width === 30))).toBe(true);
    const rows = plan.pages.flatMap((page) => page.components.filter((component) => component.table?.role === "body"));
    expect(rows).toHaveLength(60);
    expect(rows.map((row) => row.table?.rowIndex)).toEqual(data.map((_, index) => index));
    expect(rows[59]!.grid?.cells[0]).toHaveLength(82);
    expect(rows[59]!.grid?.cells[0]?.[81]).toMatchObject({ text: "5981", value: 5981, style: { fontSize: DEFAULT_FONT_PT } });
    expect(new Set([...headers, ...rows].map((component) => component.table?.id)).size).toBe(1);
    expect({ template, data }).toEqual(before);
    expect(validateRenderPlan(plan).ok).toBe(true);
    for (const [index, page] of plan.pages.entries()) {
      const lastBottom = Math.max(...page.components.map((component) => component.topMm + component.heightMm));
      expect(page.pageHeightMm).toBeCloseTo(lastBottom + (index === plan.pages.length - 1 ? 10 : 0));
      if (index > 0) expect(page.components[0]!.topMm).toBe(0);
    }
  });

  it("固定列宽优先，统一基准与 flex 只改变宽表自动列宽", () => {
    const list = listOf({
      layout: "wide", columnWidthMm: 25,
      margins: { marginLeftMm: 2, marginRightMm: 3 },
      columns: [
        { header: "编号", field: "id", widthMm: 40, flex: 99 },
        { header: "名称", field: "name" },
        { header: "说明", field: "note", flex: 2 }
      ]
    });
    expect(list.columns.map((column) => column.widthMm)).toEqual([40, 25, 50]);
    expect(list.widthMm).toBe(115);
    expect(list.layout).toBe("wide");
  });

  it("200 列超过旧 3000mm 限制，模板导入和统一数据源仍完整保留", async () => {
    const columns = Array.from({ length: 200 }, (_, index) => ({ header: `列${index}`, field: `f${index}` }));
    const template = createTableTemplate({ title: "全列明细", layout: "wide", columns });
    expect(template.pages[0]!.widthMm).toBe(6020);
    expect(validateReportTemplate(template).ok).toBe(true);
    const document = defineReportTemplate({ id: "wide", name: "宽表", template });
    const imported = parseReportTemplate(serializeReportTemplate(document));
    expect(imported.template).toEqual(template);
    const source = createReportSource({ wide: { template: async () => imported.template, datasets: { detail: [{ f0: "001", f199: 0 }] } } });
    const plan = await source({ reportIds: ["wide"], params: {} });
    expect(validateRenderPlan(plan).ok).toBe(true);
    const row = plan.pages[0]!.components.find((component) => component.table?.role === "body")!;
    expect(row.grid?.cells[0]?.[0]?.value).toBe("001");
    expect(row.grid?.cells[0]?.[199]?.value).toBe(0);
    expect(row.table).toMatchObject({ title: "全列明细", layout: "wide", columnKeys: columns.map((column) => column.field) });
  });

  it("不同报告与重复报告实例拥有独立表身份，不会被连续 Excel 误合并", async () => {
    const template = createTableTemplate({ layout: "wide", columns: [{ header: "值", field: "value" }] });
    const definition = { template, datasets: { detail: [{ value: 1 }] } };
    const source = createReportSource({ first: definition, second: definition });
    const plan = await source({ reportIds: ["first", "second", "first"], params: {} });
    const ids = plan.pages.map((page) => page.components.find((component) => component.table)?.table?.id);
    expect(new Set(ids).size).toBe(3);
    for (const page of plan.pages) expect(new Set(page.components.filter((component) => component.table).map((component) => component.table?.id)).size).toBe(1);
    expect(template.pages[0]!.components.every((component) => !("table" in component))).toBe(true);
    expect((await source({ reportIds: ["first", "second", "first"], params: {} })).pages.map((page) => page.components.find((component) => component.table)?.table?.id)).toEqual(ids);
  });

  it("分组、小计与总计使用同一有序逻辑行索引，表头另行标记", () => {
    const template = createTableTemplate({
      layout: "wide",
      columns: [{ header: "名称", field: "name" }, { header: "数量", field: "qty" }],
      listOptions: { groupBy: { field: "group", subtotal: ["qty"] }, grandTotal: { fields: ["qty"] } }
    });
    const { plan } = paginateTemplate(template, { detail: [{ group: "A", name: "物料", qty: 2 }] });
    const fragments = plan.pages.flatMap((page) => page.components.filter((component) => component.table).map((component) => component.table!));
    expect(fragments.map((fragment) => fragment.role)).toEqual(["header", "group-header", "body", "subtotal", "grand-total"]);
    expect(fragments.map((fragment) => fragment.rowIndex)).toEqual([-1, 0, 1, 2, 3]);
  });

  it.each(["a3", "a4"])("标准 %s 仍可选择，宽表与纸型没有隐式混用", (paper) => {
    const template = createTableTemplate({ layout: "page", paper, landscape: true, columns: [{ header: "值", field: "value" }] });
    expect(template.pages[0]!.widthMm).toBe(paper === "a3" ? 420 : 297);
    expect(template.pages[0]!.heightMm).toBe(paper === "a3" ? 297 : 210);
    expect(() => createTableTemplate({ layout: "wide", paper, columns: [{ header: "值", field: "value" }] })).toThrow(/不能同时指定/);
  });

  it.each([
    { options: { layout: "unknown" }, error: /layout 必须/ },
    { options: { layout: "wide", landscape: false }, error: /不能同时指定/ },
    { options: { layout: "page", columnWidthMm: 20 }, error: /仅适用于/ },
    { options: { layout: "wide", columnWidthMm: 0 }, error: /columnWidthMm/ },
    { options: { layout: "wide", columnWidthMm: Infinity }, error: /columnWidthMm/ },
    { options: { layout: "wide", columnWidthMm: NaN }, error: /columnWidthMm/ },
    { options: { layout: "wide", columnWidthMm: Number.MAX_VALUE, columns: [{ header: "值", field: "a", flex: 2 }] }, error: /分配后的 widthMm/ },
    { options: { layout: "wide", columns: [{ header: "值", field: "a", widthMm: Number.MAX_VALUE }, { header: "值", field: "b", widthMm: Number.MAX_VALUE }] }, error: /宽表总列宽/ }
  ])("非法或溢出的宽表配置明确拒绝 %#", ({ options, error }) => {
    expect(() => createTableTemplate({ columns: [{ header: "值", field: "value" }], ...options } as TableTemplateOptions)).toThrow(error);
  });

  it.each([0, -1, Infinity, NaN])("渲染计划仍拒绝非正或非有限宽度 %s", (pageWidthMm) => {
    expect(validateRenderPlan({ pages: [{ pageWidthMm, pageHeightMm: 297, components: [] }] }).ok).toBe(false);
  });

  it("导入阶段拒绝未知布局而允许自然宽度", () => {
    const template = createTableTemplate({ layout: "wide", columns: [{ header: "值", field: "value" }] });
    (template.pages[0] as unknown as { layout: string }).layout = "unknown";
    (template.pages[0]!.components[0] as unknown as { layout: string }).layout = "unknown";
    expect(validateReportTemplate(template).errors.map((error) => error.path)).toEqual(["$.pages.0.layout", "$.pages.0.components.0.layout"]);
    expect(validateRenderPlan({ pages: [{ pageWidthMm: 6020, pageHeightMm: 297, layout: "unknown", components: [] }] }).errors[0]?.path).toBe("$.pages.0.layout");
  });

  it("逻辑表来源必须明确有效，避免错误元数据造成跨页误拼", () => {
    const template = createTableTemplate({ layout: "wide", columns: [{ header: "值", field: "value" }] });
    const { plan } = paginateTemplate(template, { detail: [{ value: 1 }] });
    const invalid = structuredClone(plan) as unknown as { pages: { components: { table?: unknown }[] }[] };
    invalid.pages[0]!.components[0]!.table = { id: "", role: "unknown", rowIndex: -2, columnKeys: [1], layout: "unknown", title: 1 };
    expect(validateRenderPlan(invalid).errors.map((error) => error.path)).toEqual([
      "$.pages.0.components.0.table.id", "$.pages.0.components.0.table.role",
      "$.pages.0.components.0.table.rowIndex", "$.pages.0.components.0.table.columnKeys",
      "$.pages.0.components.0.table.layout", "$.pages.0.components.0.table.title"
    ]);
  });
});
