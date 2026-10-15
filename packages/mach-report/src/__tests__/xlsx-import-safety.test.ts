// @vitest-environment node
import { describe, expect, it } from "vitest";
import ExcelJSRuntime from "exceljs";
import { importExcelTemplate } from "../xlsx";
import { excelColumnWidthToMm, mmToExcelColumnWidth } from "../xlsx/column-width";

async function workbookBytes(build?: (sheet: ExcelJSRuntime.Worksheet) => void | Promise<void>): Promise<Uint8Array> {
  const workbook = new ExcelJSRuntime.Workbook();
  const sheet = workbook.addWorksheet("模板");
  sheet.getCell("A1").value = "内容";
  await build?.(sheet);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

/** Locate the public ZIP central directory without decoding payloads. */
function editDirectory(bytes: Uint8Array, edit: (view: DataView, offset: number) => void): Uint8Array {
  const copy = bytes.slice();
  const view = new DataView(copy.buffer);
  const end = copy.length - 22;
  let offset = view.getUint32(end + 16, true);
  const count = view.getUint16(end + 10, true);
  for (let index = 0; index < count; index++) {
    const next = offset + 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    edit(view, offset); offset = next;
  }
  return copy;
}

describe("Excel import safety and geometry budgets", () => {
  it.each([0.01, 0.25, 0.5, 1, 8.43, 12, 80, 255])("roundtrips character width %s including narrow columns", (width) => {
    expect(mmToExcelColumnWidth(excelColumnWidthToMm(width))).toBeCloseTo(width, 10);
  });

  it("rejects invalid, old xls, truncated and non-workbook ZIP inputs", async () => {
    await expect(importExcelTemplate(new Uint8Array())).rejects.toThrow(/为空|格式无效/);
    await expect(importExcelTemplate(new Uint8Array(100))).rejects.toThrow(/完整/);
    const bytes = await workbookBytes();
    await expect(importExcelTemplate(bytes.subarray(0, bytes.length - 1))).rejects.toThrow(/完整/);
    await expect(importExcelTemplate("bad" as never)).rejects.toThrow(/ArrayBuffer/);
  });

  it("rejects input byte and declared decompressed budgets before workbook parsing", async () => {
    const bytes = await workbookBytes();
    await expect(importExcelTemplate(bytes, { limits: { maxFileBytes: bytes.length - 1 } })).rejects.toThrow(/文件超过/);
    await expect(importExcelTemplate(bytes, { limits: { maxUncompressedBytes: 100 } })).rejects.toThrow(/解压后/);
  });

  it("enforces actual inflate budget even if all central directory uncompressed sizes are forged as zero", async () => {
    const bytes = await workbookBytes((sheet) => { sheet.getCell("A2").value = "重复内容".repeat(2_000); });
    const forged = editDirectory(bytes, (view, offset) => view.setUint32(offset + 24, 0, true));
    await expect(importExcelTemplate(forged, { limits: { maxUncompressedBytes: 1_000 } })).rejects.toThrow(/实际解压/);
  });

  it("rejects encrypted and unsupported compression entries", async () => {
    const bytes = await workbookBytes();
    await expect(importExcelTemplate(editDirectory(bytes, (view, offset) => view.setUint16(offset + 8, 1, true)))).rejects.toThrow(/加密/);
    await expect(importExcelTemplate(editDirectory(bytes, (view, offset) => view.setUint16(offset + 10, 99, true)))).rejects.toThrow(/不支持/);
  });

  it("checks sparse source coordinates before ExcelJS loads even when the selected output range is small", async () => {
    const bytes = await workbookBytes((sheet) => { sheet.getCell("A500000").value = "稀疏尾部"; });
    await expect(importExcelTemplate(bytes, { range: "A1:A1" })).rejects.toThrow(/源文件.*上限/);
  });

  it("rejects huge merge spans before ExcelJS allocates their covered cells", async () => {
    const bytes = await workbookBytes((sheet) => sheet.mergeCells("A1:B300"));
    await expect(importExcelTemplate(bytes)).rejects.toThrow(/合并区域超过安全加载上限/);
  });

  it("checks selected cell budgets cumulatively across sheets, as well as row/column ranges", async () => {
    const bytes = await workbookBytes((sheet) => { sheet.getCell("B2").value = 1; });
    await expect(importExcelTemplate(bytes, { limits: { maxCells: 3 } })).rejects.toThrow(/单元格上限/);
    await expect(importExcelTemplate(bytes, { range: "A1:XFD1" })).rejects.toThrow(/行、列/);
    await expect(importExcelTemplate(bytes, { range: "A1:A100001" })).rejects.toThrow(/行、列/);
    await expect(importExcelTemplate(bytes, { range: "B2:A1" })).rejects.toThrow(/边界或顺序/);
    await expect(importExcelTemplate(bytes, { range: "not a range" })).rejects.toThrow(/范围无效/);
  });

  it.each([
    { layout: "unknown" }, { maxRowsPerPage: 0 }, { maxRowsPerPage: 201 },
    { landscape: "yes" }, { limits: { maxCells: 1_000_001 } }, { limits: { maxColumns: 16_385 } },
    { limits: { maxRows: Infinity } }, { limits: { maxFileBytes: -1 } }
  ])("rejects invalid options without opening input: %j", async (options) => {
    await expect(importExcelTemplate(new Uint8Array(), options as never)).rejects.toThrow();
  });

  it("retains hidden source dimensions and reports unsupported features", async () => {
    const bytes = await workbookBytes((sheet) => {
      sheet.getColumn(1).hidden = true; sheet.getRow(1).hidden = true;
      sheet.getCell("B2").value = 1;
      sheet.getCell("B2").numFmt = "# ?/?";
      sheet.getCell("B2").fill = { type: "pattern", pattern: "darkGrid", fgColor: { argb: "FFFF0000" } };
      sheet.getCell("B2").dataValidation = { type: "whole", operator: "greaterThan", formulae: [0] };
      sheet.autoFilter = "A1:B2";
    });
    const result = await importExcelTemplate(bytes);
    expect(result.warnings.join("\n")).toMatch(/隐藏行列/);
    expect(result.warnings.join("\n")).toMatch(/数字或日期格式/);
    expect(result.warnings.join("\n")).toMatch(/图案填充/);
    expect(result.warnings.join("\n")).toMatch(/数据验证/);
    const first = result.template.pages[0]!.components[0]!;
    expect("grid" in first && first.grid!.colWidthsMm![0]).toBe(0.01);
  });

  it("honors locked cells only when Excel worksheet protection is enabled", async () => {
    const unprotected = await importExcelTemplate(await workbookBytes());
    expect(unprotected.template.pages[0]!.components[0]).toMatchObject({ grid: { cells: [[{ editable: true }]] } });
    const bytes = await workbookBytes(async (sheet) => {
      sheet.getCell("B1").value = "可修改";
      sheet.getCell("B1").protection = { locked: false };
      await sheet.protect("test", { spinCount: 1 });
    });
    const protectedResult = await importExcelTemplate(bytes);
    expect(protectedResult.template.pages[0]!.components[0]).toMatchObject({ grid: { cells: [[{ editable: false }, { editable: true }]] } });
    expect(protectedResult.warnings.join("\n")).toMatch(/工作表保护/);
  });
});
