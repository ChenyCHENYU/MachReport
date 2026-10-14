// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  createTableTemplate,
  createTemplate,
  paginateTemplate,
  type ListComponent,
  type ReportTemplate,
  type TableTemplateColumn,
  type TableTemplateOptions
} from "../index";

const basicColumns: TableTemplateColumn[] = [
  { header: "名称", field: "name" },
  { header: "数量", field: "qty" }
];

function listOf(template: ReportTemplate): ListComponent {
  return template.pages[0]!.components.find((component) => component.kind === "list") as ListComponent;
}

describe("createTableTemplate", () => {
  it("默认 A4、detail 与等宽自动列，无标题时从上边距开始", () => {
    const template = createTableTemplate({ columns: basicColumns });
    expect(template.pages[0]).toMatchObject({
      widthMm: 210,
      heightMm: 297,
      marginTopMm: 10,
      marginBottomMm: 10,
      marginLeftMm: 10,
      marginRightMm: 10
    });
    expect(template.pages[0]!.components).toHaveLength(1);
    expect(listOf(template)).toMatchObject({ dataset: "detail", leftMm: 10, topMm: 10, widthMm: 190 });
    expect(listOf(template).columns.map((column) => column.widthMm)).toEqual([95, 95]);
    const { plan, warnings } = paginateTemplate(template, { detail: [{ name: "物料", qty: 2 }] });
    expect(warnings).toEqual([]);
    expect(plan.pages[0]!.components.map((component) => component.grid?.colWidthsMm)).toEqual([[95, 95], [95, 95]]);
    expect(plan.pages[0]!.components[1]!.grid?.cells[0]?.[1]?.text).toBe("2");
  });

  it.each([
    { landscape: false, pageWidth: 210, pageHeight: 297, columnWidths: [30, 40, 120] },
    { landscape: true, pageWidth: 297, pageHeight: 210, columnWidths: [30, 61.75, 185.25] }
  ])("纵横向纸张按余量和 flex 分配，固定宽优先 ($landscape)", ({ landscape, pageWidth, pageHeight, columnWidths }) => {
    const template = createTableTemplate({
      landscape,
      columns: [
        { header: "编号", field: "no", widthMm: 30, flex: 100 },
        { header: "名称", field: "name" },
        { header: "说明", field: "description", flex: 3 }
      ]
    });
    const { plan, warnings } = paginateTemplate(template, { detail: [{ no: 1, name: "A", description: "B" }] });
    expect(warnings).toEqual([]);
    expect(plan.pages[0]).toMatchObject({ pageWidthMm: pageWidth, pageHeightMm: pageHeight });
    expect(plan.pages[0]!.components[0]!.grid?.colWidthsMm).toEqual(columnWidths);
    expect(plan.pages[0]!.components[0]!.widthMm).toBe(pageWidth - 20);
  });

  it("自定义纸张、边距和标题尺寸控制几何，标题与列表不重叠", () => {
    const params = [{ field: "warehouse", label: "仓库", required: true }];
    const template = createTableTemplate({
      title: "出库明细",
      titleHeightMm: 8,
      titleGapMm: 3,
      titleStyle: { align: "left", color: "#123456" },
      paper: { widthMm: 250, heightMm: 180 },
      landscape: true,
      margins: { marginTopMm: 7, marginBottomMm: 9, marginLeftMm: 20, marginRightMm: 30 },
      dataset: "lines",
      columns: basicColumns,
      params,
      listOptions: { rowHeightMm: 8 }
    });
    const { plan, warnings } = paginateTemplate(template, {
      lines: Array.from({ length: 60 }, (_, i) => ({ name: `A${i}`, qty: i }))
    });
    expect(warnings).toEqual([]);
    expect(template.params).toEqual(params);
    expect(plan.pages.length).toBeGreaterThan(1);
    expect(plan.pages[0]).toMatchObject({
      pageWidthMm: 180,
      pageHeightMm: 250,
      marginTopMm: 7,
      marginBottomMm: 9,
      marginLeftMm: 20,
      marginRightMm: 30
    });
    const title = plan.pages[0]!.components[0]!;
    const header = plan.pages[0]!.components[1]!;
    expect(title).toMatchObject({ text: "出库明细", leftMm: 20, topMm: 7, widthMm: 130, heightMm: 8 });
    expect(title.style).toMatchObject({ align: "left", color: "#123456", bold: true });
    expect(header).toMatchObject({ leftMm: 20, topMm: 18, widthMm: 130 });
    expect(header.topMm).toBe(title.topMm + title.heightMm + 3);
    for (const page of plan.pages) {
      for (const component of page.components) {
        expect(component.leftMm + component.widthMm).toBeLessThanOrEqual(page.pageWidthMm - 30);
        expect(component.topMm + component.heightMm).toBeLessThanOrEqual(page.pageHeightMm - 9);
      }
    }
  });

  it("全部固定列保持总宽，显式毫米 DSL 继续使用原有几何", () => {
    const columns = [
      { header: "名称", field: "name", widthMm: 80 },
      { header: "数量", field: "qty", widthMm: 20 }
    ];
    const template = createTableTemplate({ columns });
    const { plan } = paginateTemplate(template, { detail: [{ name: "A", qty: 1 }] });
    expect(listOf(template).widthMm).toBe(100);
    expect(plan.pages[0]!.components[0]!.grid?.colWidthsMm).toEqual([80, 20]);
    expect(plan.pages[0]!.components[0]!.widthMm).toBe(100);
    const explicit = createTemplate().page().list("detail", { leftMm: 12, topMm: 35, widthMm: 100 }, columns).build();
    expect(listOf(explicit)).toMatchObject({ leftMm: 12, topMm: 35, widthMm: 100, columns });
    expect(paginateTemplate(explicit, { detail: [{ name: "A", qty: 1 }] }).plan.pages[0]!.components[0]).toMatchObject({ leftMm: 12, topMm: 35, widthMm: 100 });
  });

  it("分组、小计、总计、列格式与样式透传到真实分页产物", () => {
    const template = createTableTemplate({
      title: "分组明细",
      columns: [
        { header: "名称", field: "name", flex: 2 },
        {
          header: "数量",
          field: "qty",
          format: { kind: "number", digits: 2 },
          style: { align: "right" },
          rules: [{ when: { field: "qty", op: "<", value: 0 }, style: { color: "red" } }]
        }
      ],
      listOptions: {
        id: "detail-table",
        fontSizePt: 11,
        rowHeightMm: 9,
        paddingMm: 1.5,
        border: false,
        headerBackgroundColor: "#eeeeee",
        groupBy: {
          field: "group",
          headerTemplate: "分类：{value}",
          headerStyle: { backgroundColor: "#dddddd" },
          subtotal: ["qty"],
          subtotalLabel: "本组",
          subtotalStyle: { color: "blue" }
        },
        grandTotal: { label: "总数", fields: ["qty"], style: { color: "green" } }
      }
    });
    const { plan, warnings } = paginateTemplate(template, {
      detail: [
        { name: "A", group: "一", qty: 2 },
        { name: "B", group: "二", qty: 5 },
        { name: "C", group: "一", qty: -1 }
      ]
    });
    expect(warnings).toEqual([]);
    const components = plan.pages.flatMap((page) => page.components);
    const groups = components.filter((component) => component.nid?.startsWith("listg_"));
    expect(groups.map((component) => component.grid?.cells[0]?.[0]?.text)).toEqual(["分类：一", "分类：二"]);
    expect(groups[0]!.grid?.cells[0]?.[0]?.style).toMatchObject({ backgroundColor: "#dddddd" });
    const subtotals = components.filter((component) => component.nid?.startsWith("listst_"));
    expect(subtotals.map((component) => component.grid?.cells[0]?.map((cell) => cell?.text))).toEqual([["本组", "1.00"], ["本组", "5.00"]]);
    expect(subtotals[0]!.grid?.cells[0]?.[1]?.style).toMatchObject({ color: "blue" });
    const grand = components.find((component) => component.nid?.startsWith("listgt_"))!;
    expect(grand.grid?.cells[0]?.map((cell) => cell?.text)).toEqual(["总数", "6.00"]);
    expect(grand.grid?.cells[0]?.[1]?.style).toMatchObject({ color: "green" });
    const rows = components.filter((component) => component.nid?.startsWith("listr_"));
    expect(rows).toHaveLength(3);
    expect(rows[1]!.grid?.cells[0]?.[1]?.style).toMatchObject({ align: "right", color: "red" });
    expect(rows.every((row) => row.heightMm >= 9 && row.style?.borderTop === false)).toBe(true);
    expect(components.find((component) => component.nid?.startsWith("listh_"))!.grid?.cells[0]?.[0]?.style).toMatchObject({ backgroundColor: "#eeeeee", fontSize: 11 });
  });

  it.each([true, false])("分页保留全部明细，按 headerEveryPage=%s 重复表头", (headerEveryPage) => {
    const template = createTableTemplate({
      title: "明细",
      paper: { widthMm: 100, heightMm: 60 },
      margins: { marginTopMm: 5, marginBottomMm: 5, marginLeftMm: 5, marginRightMm: 5 },
      columns: basicColumns,
      listOptions: { rowHeightMm: 8, headerEveryPage }
    });
    const data = Array.from({ length: 30 }, (_, i) => ({ name: `A${i}`, qty: i }));
    const { plan, warnings } = paginateTemplate(template, { detail: data });
    expect(warnings).toEqual([]);
    expect(plan.pages.length).toBeGreaterThan(1);
    const rows = plan.pages.flatMap((page) => page.components.filter((component) => component.nid?.startsWith("listr_")));
    expect(rows.map((row) => row.grid?.cells[0]?.[0]?.text)).toEqual(data.map((row) => row.name));
    for (const [index, page] of plan.pages.entries()) {
      const headers = page.components.filter((component) => component.nid?.startsWith("listh_"));
      expect(headers).toHaveLength(index === 0 || headerEveryPage ? 1 : 0);
      for (const component of page.components) {
        expect(component.topMm + component.heightMm).toBeLessThanOrEqual(55);
      }
    }
    expect(plan.pages[0]!.components[0]).toMatchObject({ heightMm: 10, topMm: 5 });
    expect(plan.pages[0]!.components[1]).toMatchObject({ topMm: 19 });
  });

  it("冻结的输入列不被工厂或分页修改，flex 不进入毫米模板", () => {
    const columns = Object.freeze([
      Object.freeze({ header: "名称", field: "name", flex: 2, style: { color: "blue" } }),
      Object.freeze({ header: "数量", field: "qty", widthMm: 30 })
    ]);
    const snapshot = structuredClone(columns);
    const template = createTableTemplate({ columns });
    paginateTemplate(template, { detail: [{ name: "A", qty: 1 }] });
    expect(columns).toEqual(snapshot);
    expect(listOf(template).columns[0]).not.toBe(columns[0]);
    expect(listOf(template).columns[0]).not.toHaveProperty("flex");
    expect(listOf(template).columns.map((column) => column.widthMm)).toEqual([160, 30]);
  });

  it("有限的大 flex 权重不会因权重和溢出失效", () => {
    const template = createTableTemplate({
      columns: basicColumns.map((column) => ({ ...column, flex: Number.MAX_VALUE }))
    });
    expect(listOf(template).columns.map((column) => column.widthMm)).toEqual([95, 95]);
  });

  it.each([
    { options: { columns: [] }, error: /columns 至少/ },
    { options: { columns: null }, error: /columns 至少/ },
    { options: { paper: "a0" }, error: /未知纸张/ },
    { options: { paper: "__proto__" }, error: /未知纸张/ },
    { options: { paper: null }, error: /paper 必须/ },
    { options: { paper: 210 }, error: /paper 必须/ },
    { options: { paper: { widthMm: 0, heightMm: 100 } }, error: /纸张 widthMm/ },
    { options: { paper: { widthMm: NaN, heightMm: 100 } }, error: /纸张 widthMm/ },
    { options: { paper: { widthMm: 100, heightMm: Infinity } }, error: /纸张 heightMm/ },
    { options: { landscape: "true" }, error: /landscape 必须/ },
    { options: { margins: null }, error: /margins 必须/ },
    { options: { margins: [] }, error: /margins 必须/ },
    { options: { margins: { marginLeftMm: -1 } }, error: /marginLeftMm/ },
    { options: { margins: { marginTopMm: Infinity } }, error: /marginTopMm/ },
    { options: { margins: { marginRightMm: NaN } }, error: /marginRightMm/ },
    { options: { margins: { marginBottomMm: null } }, error: /marginBottomMm/ },
    { options: { margins: { marginLeftMm: 100, marginRightMm: 110 } }, error: /页边距占满/ },
    { options: { margins: { marginTopMm: 150, marginBottomMm: 150 } }, error: /页边距占满/ },
    { options: { columns: [{ header: "A", field: "a", widthMm: 191 }] }, error: /固定列宽.*超出/ },
    { options: { columns: [{ header: "A", field: "a", widthMm: 190 }, basicColumns[1]] }, error: /自动列需要/ },
    { options: { columns: [{ header: "A", field: "a", widthMm: 0 }] }, error: /columns\[0\].widthMm/ },
    { options: { columns: [{ header: "A", field: "a", widthMm: Infinity }] }, error: /columns\[0\].widthMm/ },
    { options: { columns: [{ header: "A", field: "a", flex: -1 }] }, error: /columns\[0\].flex/ },
    { options: { columns: [{ header: "A", field: "a", flex: NaN }] }, error: /columns\[0\].flex/ },
    { options: { columns: [{ header: "A", field: "a", flex: Infinity }] }, error: /columns\[0\].flex/ },
    { options: { columns: [null] }, error: /columns\[0\].*header.*field/ },
    { options: { columns: [{ header: "A", field: " " }] }, error: /columns\[0\].*field/ },
    { options: { title: 123 }, error: /title 必须/ },
    { options: { titleHeightMm: 0 }, error: /titleHeightMm/ },
    { options: { titleGapMm: -1 }, error: /titleGapMm/ },
    { options: { title: "标题", titleHeightMm: 273 }, error: /标题.*占满/ },
    { options: { title: "标题", titleGapMm: Number.MAX_VALUE }, error: /标题.*占满/ },
    { options: { dataset: " " }, error: /dataset 必须/ },
    { options: { listOptions: null }, error: /listOptions 必须/ },
    { options: { listOptions: { fontSizePt: NaN } }, error: /listOptions.fontSizePt/ },
    { options: { listOptions: { rowHeightMm: -1 } }, error: /listOptions.rowHeightMm/ },
    { options: { listOptions: { paddingMm: -1 } }, error: /listOptions.paddingMm/ }
  ])("非法输入明确报错 %#", ({ options, error }) => {
    const invalid = { columns: basicColumns, ...options } as unknown as TableTemplateOptions;
    expect(() => createTableTemplate(invalid)).toThrow(error);
  });

  it("零边距、零标题间距、零 padding 是合法布局", () => {
    const template = createTableTemplate({
      title: "标题",
      titleGapMm: 0,
      columns: basicColumns,
      margins: { marginTopMm: 0, marginBottomMm: 0, marginLeftMm: 0, marginRightMm: 0 },
      listOptions: { paddingMm: 0 }
    });
    const { plan, warnings } = paginateTemplate(template, { detail: [{ name: "A", qty: 1 }] });
    expect(warnings).toEqual([]);
    expect(plan.pages[0]!.components[0]).toMatchObject({ topMm: 0, heightMm: 10, widthMm: 210 });
    expect(plan.pages[0]!.components[1]).toMatchObject({ topMm: 10, widthMm: 210 });
  });
});
