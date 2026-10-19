// @vitest-environment node
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  importExcelTemplate,
  inspectExcelWorkbook,
} from "../xlsx/import-template";
import {
  createExcelBindingDocument,
  createExcelBindingSession,
  excelBindingRowRange,
  parseExcelBindingSession,
  validateExcelBindingRecipe,
  type ExcelBindingDataset,
  type ExcelBindingRecipe,
} from "../xlsx/binding-workflow";
import { getExcelSheetWindow } from "../xlsx/binding-preview";
import { paginateTemplate } from "../layout/paginate";
import { renderPlanToXlsx } from "../xlsx/render-xlsx";
const datasets: ExcelBindingDataset[] = [
  {
    id: "heats",
    label: "生产实绩",
    rowKey: "id",
    fields: [
      {
        field: "id",
        label: "炉号",
        type: "text",
        semanticRole: "identifier",
        sample: "001",
      },
      {
        field: "weight",
        label: "产重",
        type: "number",
        unit: "kg",
        digits: 3,
        sample: 0,
      },
      {
        field: "exact",
        type: "decimal",
        unit: "元",
        sample: "999999999999999999.01",
      },
    ],
    samples: [{ id: "001", weight: 0, exact: "999999999999999999.01" }],
  },
];
function recipe(): ExcelBindingRecipe {
  return {
    version: "1.0",
    sheet: "生产日报",
    dataset: "heats",
    regions: {
      title: "A1:C1",
      header: "A2:C3",
      detail: "A4:C5",
      footer: "A6:C6",
    },
    fields: ["id", "weight", "exact"],
    rowKey: "id",
  };
}
async function fixture() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("生产日报");
  sheet.mergeCells("A1:C1");
  sheet.getCell("A1").value = "生产日报标题";
  sheet.mergeCells("A2:A3");
  sheet.getCell("A2").value = "炉号";
  sheet.mergeCells("B2:C2");
  sheet.getCell("B2").value = "指标";
  sheet.getCell("B3").value = "产重";
  sheet.getCell("C3").value = "精确金额";
  sheet.getCell("A4").value = "SAMPLE MUST DISAPPEAR";
  sheet.getCell("B4").value = 777;
  sheet.getCell("B4").numFmt = "0.0";
  sheet.getCell("C4").value = 888;
  sheet.getCell("C4").numFmt = "0.00";
  sheet.getCell("A5").value = "OLD SAMPLE";
  sheet.getCell("B5").value = 1;
  sheet.getCell("C5").value = 2;
  sheet.mergeCells("A6:C6");
  sheet.getCell("A6").value = "静态尾页声明";
  workbook.addWorksheet("未绑定源").getCell("A1").value = "UNSELECTED SAMPLE";
  return importExcelTemplate(new Uint8Array(await workbook.xlsx.writeBuffer()));
}

describe("Excel binding workflow", () => {
  it("明确标定区域、契约、物理列后生成独立模板，仅接口数据进入明细和安全导出", async () => {
    const imported = await fixture();
    const before = JSON.stringify(imported);
    expect(validateExcelBindingRecipe(imported, recipe(), datasets)).toEqual({
      ok: true,
      issues: [],
      mapped: 3,
      total: 3,
    });
    const result = createExcelBindingDocument(imported, recipe(), datasets, {
      id: "bound",
      name: "业务日报",
    });
    expect(result.document).toMatchObject({
      id: "bound",
      name: "业务日报",
      schemaVersion: "1.0",
    });
    expect(JSON.stringify(result.document)).not.toMatch(/SAMPLE|777|888/);
    const rows = [{ id: "000418", weight: 0, exact: "999999999999999999.01" }];
    const { plan } = paginateTemplate(result.document.template, {
      heats: rows,
    });
    const serialized = JSON.stringify(plan);
    expect(serialized).toContain("000418");
    expect(serialized).toContain("0.000");
    expect(serialized).toContain("999999999999999999.01");
    expect(serialized).toContain("静态尾页声明");
    expect(result.warnings.join(" ")).toMatch(/独立页面/);
    const { workbook } = await renderPlanToXlsx(plan);
    expect(
      JSON.stringify(
        workbook.worksheets.map((sheet) => sheet.getSheetValues()),
      ),
    ).not.toContain("SAMPLE");
    expect(JSON.stringify(imported)).toBe(before);
  });
  it("JSON 会话恢复精确参数和来源，恢复后编译相同且返回独立快照", async () => {
    const imported = await fixture(),
      original = recipe();
    const session = createExcelBindingSession(imported, original, {
      id: "bound",
      name: "业务日报",
    });
    const restored = parseExcelBindingSession(JSON.stringify(session));
    expect(restored).toEqual(session);
    const first = createExcelBindingDocument(
      imported,
      original,
      datasets,
      session.identity,
    );
    const second = createExcelBindingDocument(
      restored.source,
      restored.recipe,
      datasets,
      restored.identity,
    );
    expect(second).toEqual(first);
    restored.recipe.fields[0] = "changed";
    expect(original.fields[0]).toBe("id");
  });
  it("不自动匹配字段，未映射、重复和未知字段均有物理列路径", async () => {
    const imported = await fixture(),
      config = recipe();
    config.fields = ["", "weight", "weight"];
    const result = validateExcelBindingRecipe(imported, config, datasets);
    expect(result.ok).toBe(false);
    expect(result.mapped).toBe(1);
    expect(result.issues.map((item) => item.path)).toEqual([
      "$.recipe.fields[0]",
      "$.recipe.fields[2]",
    ]);
    expect(() =>
      createExcelBindingDocument(imported, config, datasets, {
        id: "bound",
        name: "bad",
      }),
    ).toThrow(/fields\[0\]/);
  });
  it("缺主键、未声明主键、布尔主键和重复样例主键全部拒绝", async () => {
    const imported = await fixture();
    for (const key of ["", "missing"]) {
      const config = recipe();
      config.rowKey = key;
      expect(
        validateExcelBindingRecipe(imported, config, datasets).issues.some(
          (item) => item.code === "row-key",
        ),
      ).toBe(true);
    }
    const catalog = structuredClone(datasets);
    catalog[0]!.samples = [{ id: "same" }, { id: "same" }];
    expect(
      validateExcelBindingRecipe(imported, recipe(), catalog).issues,
    ).toContainEqual(
      expect.objectContaining({
        code: "row-key",
        path: "$.datasets.heats.samples[1].id",
      }),
    );
  });
  it("源范围必须连续全宽且显式覆盖，不删静态标题或漏标尾页", async () => {
    const imported = await fixture();
    const configs = [
      { ...recipe(), regions: { header: "A2:C3", detail: "A4:C6" } },
      { ...recipe(), regions: { ...recipe().regions, detail: "A4:B5" } },
      { ...recipe(), regions: { ...recipe().regions, detail: "A5:C5" } },
      { ...recipe(), regions: { ...recipe().regions, detail: "A3:C5" } },
    ];
    for (const config of configs)
      expect(
        validateExcelBindingRecipe(imported, config, datasets).issues.some(
          (item) => item.code === "region",
        ),
      ).toBe(true);
    expect(excelBindingRowRange(imported, "生产日报", 3, 2)).toBe("A2:C3");
    expect(() => excelBindingRowRange(imported, "生产日报", 0, 2)).toThrow(
      /超出/,
    );
  });
  it("区域切断合并格时编译失败而不丢主格，字段契约类型错误精确定位", async () => {
    const imported = await fixture(),
      config = recipe();
    config.regions.title = "A1:C2";
    config.regions.header = "A3:C3";
    expect(validateExcelBindingRecipe(imported, config, datasets).ok).toBe(
      false,
    );
    expect(() =>
      createExcelBindingDocument(imported, config, datasets, {
        id: "b",
        name: "b",
      }),
    ).toThrow(/合并/);
    const catalog = structuredClone(datasets);
    catalog[0]!.samples = [{ id: "1", weight: "0" }];
    expect(
      validateExcelBindingRecipe(imported, recipe(), catalog).issues,
    ).toContainEqual(
      expect.objectContaining({
        path: "$.datasets.heats.samples[0].weight",
        code: "schema",
      }),
    );
  });
  it("公开校验每次读取实际合并属性，不因来源对象复用而返回过期通过结果", async () => {
    const imported = await fixture();
    expect(validateExcelBindingRecipe(imported, recipe(), datasets).ok).toBe(true);
    const component = imported.template.pages[0]!.components[0]!;
    if (component.kind === "list") throw new Error("static fixture");
    component.grid!.cells[0]![0]!.rowSpan = 2;
    expect(validateExcelBindingRecipe(imported, recipe(), datasets).issues.some((item) => item.code === "region")).toBe(true);
  });
  it("有错误契约和精度时不会静默降级，空数据集允许验证契约", async () => {
    const imported = await fixture(),
      bad = structuredClone(datasets);
    bad[0]!.fields[1]!.digits = 101;
    expect(
      validateExcelBindingRecipe(imported, recipe(), bad).issues[0]!.path,
    ).toBe("$.datasets[0].fields[1].digits");
    expect(
      validateExcelBindingRecipe(imported, recipe(), []).issues.some(
        (item) => item.path === "$.recipe.dataset",
      ),
    ).toBe(true);
    expect(() => parseExcelBindingSession({ version: "other" })).toThrow(
      /版本/,
    );
  });
  it("先读sheet元数据再只转换选中sheet，仍保留源文件硬预算与默认全表行为", async () => {
    const workbook = new ExcelJS.Workbook(),
      first = workbook.addWorksheet("small"),
      large = workbook.addWorksheet("large");
    first.getCell("A1").value = "small";
    first.getCell("B1").value = "header";
    for (let row = 1; row <= 20; row++) large.getCell(row, 1).value = row;
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
    const inspection = await inspectExcelWorkbook(bytes, {
      limits: { maxCells: 2 },
    });
    expect(
      inspection.sheets.map((sheet) => [sheet.name, sheet.rowCount]),
    ).toEqual([
      ["small", 1],
      ["large", 20],
    ]);
    expect(
      await importExcelTemplate(bytes, {
        sheets: ["small"],
        limits: { maxCells: 2 },
      }),
    ).toMatchObject({ sheets: [{ name: "small" }] });
    await expect(
      importExcelTemplate(bytes, { limits: { maxCells: 2 } }),
    ).rejects.toThrow(/上限/);
    await expect(
      inspectExcelWorkbook(bytes, { limits: { maxFileBytes: 1 } }),
    ).rejects.toThrow(/上限/);
    expect((await importExcelTemplate(bytes)).sheets).toHaveLength(2);
  });
  it("会话拒绝危险元数据、损坏范围和超大JSON，不修改正常会话", async () => {
    const session = createExcelBindingSession(await fixture(), recipe(), {
      id: "bound",
      name: "业务日报",
    });
    const unsafe = JSON.parse(JSON.stringify(session));
    unsafe.recipe.regions = JSON.parse(
      '{"header":"A2:C3","detail":"A4:C5","__proto__":{}}',
    );
    expect(() => parseExcelBindingSession(unsafe)).toThrow(/不安全/);
    const malformed = structuredClone(session);
    malformed.recipe.regions.header = "not-a-range";
    expect(() => parseExcelBindingSession(malformed)).toThrow(/范围/);
    expect(() => parseExcelBindingSession(" ".repeat(10_000_001))).toThrow(
      /上限/,
    );
  });
  it("双向窗口保留跨窗口合并标签，最多 24×12 格，导航不展开整张工作表", async () => {
    const imported = await fixture();
    const view = getExcelSheetWindow(imported, "生产日报", {
      row: 3,
      column: 2,
      rows: 2,
      columns: 2,
    });
    expect(view.rows).toHaveLength(2);
    expect(view.columns.map((item) => item.name)).toEqual(["B", "C"]);
    expect(view.rows[0]!.cells.map((cell) => cell.text)).toEqual([
      "产重",
      "精确金额",
    ]);
    const title = getExcelSheetWindow(imported, "生产日报", {
      row: 1,
      column: 2,
      rows: 1,
      columns: 1,
    });
    expect(title.rows[0]!.cells[0]).toMatchObject({
      address: "A1",
      text: "生产日报标题",
      continued: true,
      colSpan: 1,
    });
    expect(() =>
      getExcelSheetWindow(imported, "生产日报", { columns: 16384 }),
    ).toThrow(/1–32/);
  });
});
