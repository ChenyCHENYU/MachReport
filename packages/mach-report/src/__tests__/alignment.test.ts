// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTableTemplate } from "../builder/table-template";
import { paginateTemplate, type ListComponent, type ReportTemplate } from "../layout/paginate";
import { toExcelNumberFormat } from "../format";
import { heuristicMeasurer, wrapText } from "../layout/textwrap";
import { LINE_HEIGHT } from "../defaults";

function grids(template: ReportTemplate, rows: Record<string, unknown>[]) {
  const { plan } = paginateTemplate(template, { detail: rows });
  return plan.pages.flatMap((page) => page.components).filter((component) => component.grid);
}

describe("表头与内容对齐", () => {
  it("标准模板按业务类型自动对齐，数字字符串编号保留左对齐", () => {
    const template = createTableTemplate({
      columns: [
        { header: "名称", field: "name" },
        { header: "编码", field: "code" },
        { header: "数量", field: "qty" },
        { header: "比例", field: "ratio", format: { kind: "percent" } },
        { header: "日期", field: "date", format: { kind: "date" } },
        { header: "启用", field: "enabled" }
      ]
    });
    const [header, row] = grids(template, [{ name: "物料", code: "00123", qty: 0, ratio: 0.25, date: "2026-10-15", enabled: false }]);
    expect(header!.grid!.cells[0]!.map((cell) => cell?.style?.align)).toEqual(Array(6).fill("center"));
    expect(row!.grid!.cells[0]!.map((cell) => cell?.style?.align)).toEqual(["left", "left", "right", "right", "center", "center"]);
    expect(row!.grid!.cells[0]!.map((cell) => cell?.text)).toEqual(["物料", "00123", "0", "25.00%", "2026-10-15", "否"]);
  });

  it("列对齐覆盖整表默认，表头独立样式与内容互不影响", () => {
    const template = createTableTemplate({
      columns: [
        { header: "A", field: "a", style: { align: "left", color: "blue" }, align: "center", headerAlign: "left" },
        { header: "B", field: "b", headerAlign: "right", headerStyle: { align: "center", color: "red" } },
        { header: "C", field: "c", style: { align: "left" } },
        { header: "D", field: "d" }
      ],
      listOptions: { align: "right", headerAlign: "right", headerStyle: { align: "left", color: "green", bold: false } }
    });
    const [header, row] = grids(template, [{ a: 1, b: 2, c: 3, d: "文本" }]);
    expect(header!.grid!.cells[0]!.map((cell) => cell?.style?.align)).toEqual(["left", "center", "left", "left"]);
    expect(header!.grid!.cells[0]!.map((cell) => cell?.style?.color)).toEqual(["green", "red", "green", "green"]);
    expect(row!.grid!.cells[0]!.map((cell) => cell?.style?.align)).toEqual(["center", "right", "left", "right"]);
    expect(row!.grid!.cells[0]![0]?.style?.color).toBe("blue");
    expect(row!.grid!.cells[0]![1]?.style?.color).toBeUndefined();
  });

  it("低层模板缺省对齐和旧列 style 继承行为兼容", () => {
    const list: ListComponent = {
      kind: "list", dataset: "detail", leftMm: 10, topMm: 10, widthMm: 190,
      columns: [
        { header: "名称", field: "name", widthMm: 100 },
        { header: "数量", field: "qty", widthMm: 90, style: { align: "right" } }
      ]
    };
    const [header, row] = grids({ pages: [{ widthMm: 210, heightMm: 297, components: [list] }] }, [{ name: 9, qty: 2 }]);
    expect(header!.grid!.cells[0]!.map((cell) => cell?.style?.align)).toEqual(["center", "right"]);
    expect(row!.grid!.cells[0]!.map((cell) => cell?.style?.align)).toEqual(["left", "right"]);
  });

  it("auto 的同类型样式驻留复用，条件规则仍能显式覆盖", () => {
    const template = createTableTemplate({
      columns: [{
        header: "值", field: "value",
        rules: [{ when: { field: "value", op: "<", value: 0 }, style: { align: "center", color: "red" } }]
      }]
    });
    const rows = grids(template, [1, 2, "001", "002", true, false, -1].map((value) => ({ value }))).slice(1);
    const styles = rows.map((row) => row.grid!.cells[0]![0]!.style);
    expect(styles[0]).toBe(styles[1]);
    expect(styles[2]).toBe(styles[3]);
    expect(styles[4]).toBe(styles[5]);
    expect(styles[6]).toMatchObject({ align: "center", color: "red" });
    expect(styles[0]).toMatchObject({ align: "right" });
  });

  it("日期对象居中，未声明格式的数字字符串和空值不被推断为数字", () => {
    const template = createTableTemplate({ columns: [{ header: "值", field: "value" }] });
    const rows = grids(template, [{ value: new Date("2026-10-15T00:00:00Z") }, { value: "123" }, { value: null }]).slice(1);
    expect(rows.map((row) => row.grid!.cells[0]![0]!.style?.align)).toEqual(["center", "left", "left"]);
    const formatted = createTableTemplate({ columns: [{ header: "数值", field: "value", format: { kind: "number" } }] });
    expect(grids(formatted, [{ value: "123" }])[1]!.grid!.cells[0]![0]!.style?.align).toBe("right");
  });

  it("独立表头字号参与行高测量，不与首行内容重叠", () => {
    const base = createTableTemplate({ columns: [{ header: "表头", field: "value" }] });
    const large = createTableTemplate({ columns: [{ header: "表头", field: "value", headerStyle: { fontSize: 28 } }] });
    const [baseHeader] = grids(base, [{ value: "内容" }]);
    const [header, row] = grids(large, [{ value: "内容" }]);
    expect(header!.heightMm).toBeGreaterThan(baseHeader!.heightMm * 2);
    expect(row!.topMm).toBeCloseTo(header!.topMm + header!.heightMm);
    expect(row!.grid!.cells[0]![0]!.style?.fontSize).toBe(baseHeader!.grid!.cells[0]![0]!.style?.fontSize);
  });

  it.each([
    { style: { fontSize: 28 }, fontPt: 28, lineHeight: LINE_HEIGHT },
    { style: { fontSize: 10.5, fontSizePx: 40 }, fontPt: 30, lineHeight: LINE_HEIGHT },
    { style: { fontSize: 18, lineHeight: 2 }, fontPt: 18, lineHeight: 2 }
  ])("内容行按列真实字号和行距排布，不覆盖下一行 %#", ({ style, fontPt, lineHeight }) => {
    const text = "大字号内容需要完整折行显示";
    const template = createTableTemplate({
      columns: [{ header: "内容", field: "value", widthMm: 50, style }],
      listOptions: { paddingMm: 1.5 }
    });
    const rows = grids(template, [{ value: text }, { value: text }]).slice(1);
    const lineCount = wrapText(text, 47, { fontSizePt: fontPt }, heuristicMeasurer).length;
    const expectedHeight = lineCount * fontPt * lineHeight * 25.4 / 72 + 3;
    expect(rows[0]!.heightMm).toBeCloseTo(expectedHeight);
    expect(rows[0]!.grid!.rowHeightsMm).toEqual([rows[0]!.heightMm]);
    expect(rows[1]!.topMm).toBeCloseTo(rows[0]!.topMm + rows[0]!.heightMm);
  });

  it("条件规则最终字体参与折行与行高，命中样式也驻留复用", () => {
    const text = "条件命中后字体变大且加粗，需要增加行高";
    const template = createTableTemplate({ columns: [{
      header: "说明", field: "value", widthMm: 60,
      rules: [{ when: { field: "warning", op: "==", value: 1 }, style: { fontSizePx: 32, bold: true, lineHeight: 1.8 } }]
    }] });
    const rows = grids(template, [
      { value: text, warning: 0 }, { value: text, warning: 1 }, { value: text, warning: 1 }, { value: text, warning: 0 }
    ]).slice(1);
    const lineCount = wrapText(text, 58, { fontSizePt: 24, bold: true }, heuristicMeasurer).length;
    expect(rows[1]!.heightMm).toBeCloseTo(lineCount * 24 * 1.8 * 25.4 / 72 + 2);
    expect(rows[1]!.heightMm).toBeGreaterThan(rows[0]!.heightMm);
    expect(rows[1]!.grid!.cells[0]![0]!.style).toBe(rows[2]!.grid!.cells[0]![0]!.style);
    expect(rows[0]!.grid!.cells[0]![0]!.style).toBe(rows[3]!.grid!.cells[0]![0]!.style);
    for (let i = 1; i < rows.length; i++) {
      if (rows[i]!.topMm > rows[i - 1]!.topMm) expect(rows[i]!.topMm).toBeCloseTo(rows[i - 1]!.topMm + rows[i - 1]!.heightMm);
    }
  });

  it("小计与总计的显式大字号同样扩展行高", () => {
    const template = createTableTemplate({
      columns: [{ header: "名称", field: "name" }, { header: "数量", field: "qty" }],
      listOptions: {
        groupBy: { field: "group", subtotal: ["qty"], subtotalStyle: { fontSize: 24 } },
        grandTotal: { fields: ["qty"], style: { fontSize: 30, lineHeight: 1.5 } }
      }
    });
    const components = grids(template, [{ name: "A", group: "一", qty: 2 }]);
    const subtotal = components.find((component) => component.nid?.startsWith("listst"))!;
    const grand = components.find((component) => component.nid?.startsWith("listgt"))!;
    expect(subtotal.heightMm).toBeCloseTo(24 * LINE_HEIGHT * 25.4 / 72 + 2);
    expect(grand.heightMm).toBeCloseTo(30 * 1.5 * 25.4 / 72 + 2);
    expect(grand.topMm).toBeCloseTo(subtotal.topMm + subtotal.heightMm);
  });

  it.each([
    { columns: [{ header: "A", field: "a", align: "bottom" }] },
    { columns: [{ header: "A", field: "a", headerAlign: "auto" }] },
    { columns: [{ header: "A", field: "a" }], listOptions: { align: null } },
    { columns: [{ header: "A", field: "a" }], listOptions: { headerAlign: "auto" } }
  ])("非法对齐配置给出可定位错误 %#", (options) => {
    expect(() => createTableTemplate(options as unknown as Parameters<typeof createTableTemplate>[0])).toThrow(/align|Align/);
  });
});

describe("Excel 原始值元数据", () => {
  it("保留 0、null、布尔与文本编号，日期/对象/非有限数字回退文本", () => {
    const template = createTableTemplate({ columns: [{ header: "值", field: "value" }] });
    const values = [0, null, false, "00123", undefined, new Date("2026-10-15T00:00:00Z"), { id: 1 }, Number.POSITIVE_INFINITY];
    const cells = grids(template, values.map((value) => ({ value }))).slice(1).map((row) => row.grid!.cells[0]![0]!);
    expect(cells.slice(0, 4).map((cell) => cell.value)).toEqual([0, null, false, "00123"]);
    expect(cells.slice(4).every((cell) => !Object.prototype.hasOwnProperty.call(cell, "value"))).toBe(true);
    expect(JSON.parse(JSON.stringify(cells.slice(0, 4)))).toMatchObject([{ value: 0 }, { value: null }, { value: false }, { value: "00123" }]);
  });

  it("数字与百分比元数据保留原始值，不将显示百分数二次转换", () => {
    const template = createTableTemplate({ columns: [
      { header: "金额", field: "amount", format: { kind: "number", digits: 2, thousands: true } },
      { header: "比例", field: "ratio", format: { kind: "percent", digits: 1 } },
      { header: "编号", field: "code", format: { kind: "number", digits: 2 } }
    ] });
    const cells = grids(template, [{ amount: 1234.5, ratio: 0.125, code: "00123" }])[1]!.grid!.cells[0]!;
    expect(cells[0]).toMatchObject({ text: "1,234.50", value: 1234.5, numberFormat: "#,##0.00" });
    expect(cells[1]).toMatchObject({ text: "12.5%", value: 0.125, numberFormat: "0.0%" });
    expect(cells[2]).toMatchObject({ text: "123.00", value: "00123" });
    expect(cells[2]).not.toHaveProperty("numberFormat");
  });

  it("小计和总计带数值与对齐元数据，沿用列格式和汇总样式", () => {
    const template = createTableTemplate({
      columns: [
        { header: "名称", field: "name" },
        { header: "金额", field: "amount", format: { kind: "number", digits: 2 } }
      ],
      listOptions: { groupBy: { field: "group", subtotal: ["amount"] }, grandTotal: { fields: ["amount"], style: { align: "center" } } }
    });
    const components = grids(template, [{ name: "A", group: "一", amount: 1.25 }, { name: "B", group: "一", amount: 2 }]);
    const subtotal = components.find((component) => component.nid?.startsWith("listst"))!.grid!.cells[0]![1]!;
    const grand = components.find((component) => component.nid?.startsWith("listgt"))!.grid!.cells[0]![1]!;
    expect(subtotal).toMatchObject({ text: "3.25", value: 3.25, numberFormat: "0.00", style: { align: "right" } });
    expect(grand).toMatchObject({ text: "3.25", value: 3.25, numberFormat: "0.00", style: { align: "center" } });
  });

  it("Excel 数字格式与无格式、千分位、百分比和日期边界一致", () => {
    expect(toExcelNumberFormat()).toBeUndefined();
    expect(toExcelNumberFormat({ kind: "number" })).toBeUndefined();
    expect(toExcelNumberFormat({ kind: "number", thousands: true })).toBe("#,##0.###############");
    expect(toExcelNumberFormat({ kind: "number", digits: 0 })).toBe("0");
    expect(toExcelNumberFormat({ kind: "number", digits: 3 })).toBe("0.000");
    expect(toExcelNumberFormat({ kind: "percent" })).toBe("0.00%");
    expect(toExcelNumberFormat({ kind: "percent", digits: 0 })).toBe("0%");
    expect(toExcelNumberFormat({ kind: "date" })).toBeUndefined();
    for (const digits of [-1, 0.5, NaN, 101]) expect(toExcelNumberFormat({ kind: "number", digits })).toBeUndefined();
  });
});
