// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { renderPlanToWorkbook, renderPlanToXlsx } from "../xlsx";
import { createReportRuntime } from "../server/runtime";
import { snapshotXlsxOptions } from "../server/prepared";
import type { RenderPlan } from "../schema/render-plan";

const plan: RenderPlan = { schemaVersion: "test", pages: [{ pageWidthMm: 210, pageHeightMm: 297, components: [] }] };
const additionalSheets = [{ name: "来源", columnWidths: [24, 80], rows: [["厂别", "YTS0"], ["数值", 1], ["空值", null], ["有效", false]] }];
afterEach(() => vi.restoreAllMocks());

describe("Excel 附加工作表单次编码", () => {
  it("编码前写入附加表，真实回读保留类型且只编码一次", async () => {
    const write = vi.spyOn(Object.getPrototypeOf(new ExcelJS.Workbook().xlsx) as ExcelJS.Workbook["xlsx"], "writeBuffer");
    const result = await renderPlanToXlsx(plan, { additionalSheets });
    expect(write).toHaveBeenCalledTimes(1);
    const read = new ExcelJS.Workbook();
    await read.xlsx.load(result.buffer);
    const sheet = read.getWorksheet("来源")!;
    expect(sheet.getCell("B2").value).toBe(1);
    expect(sheet.getCell("B3").value).toBeNull();
    expect(sheet.getCell("B4").value).toBe(false);
    expect(sheet.getColumn(2).width).toBe(80);
  });
  it("需要自行完善工作簿时构建阶段不编码", async () => {
    const result = await renderPlanToWorkbook(plan, { additionalSheets });
    expect(result.workbook.getWorksheet("来源")!.getCell("B1").value).toBe("YTS0");
    expect("buffer" in result).toBe(false);
  });
  it("运行时和跨线程交接捕获独立标量快照", () => {
    const input = [{ name: "数据", rows: [["old"]] }];
    const captured = snapshotXlsxOptions({ additionalSheets: input })!;
    input[0]!.rows[0]![0] = "new";
    expect(captured.additionalSheets![0]!.rows[0]![0]).toBe("old");
  });
  it.each([
    [{ name: "bad/name", rows: [] }],
    [{ name: "same", rows: [] }, { name: "SAME", rows: [] }],
    [{ name: "data", rows: [[Infinity]] }],
    [{ name: "data", rows: [[{ formula: "1+1" }]] }],
    [{ name: "data", rows: [], columnWidths: [256] }]
  ].map(sheets => ({ sheets })))("拒绝无效声明 $sheets", async ({ sheets }) => {
    await expect(renderPlanToXlsx(plan, { additionalSheets: sheets as unknown as typeof additionalSheets })).rejects.toThrow();
  });
  it("拒绝与主体工作表重名，并在取消后停止", async () => {
    await expect(renderPlanToXlsx(plan, { additionalSheets: [{ name: "Sheet1", rows: [] }] })).rejects.toThrow("已被报表使用");
    const signal = new AbortController(); signal.abort();
    await expect(renderPlanToXlsx(plan, { additionalSheets, signal: signal.signal })).rejects.toBeDefined();
  });
  it("稀疏行、工作表和列宽不能绕过标量验证", async () => {
    for (const sheets of [Array(1), [{ name: "data", rows: Array(1) }], [{ name: "data", rows: [Array(1)] }], [{ name: "data", rows: [], columnWidths: Array(1) }]]) {
      await expect(renderPlanToXlsx(plan, { additionalSheets: sheets })).rejects.toThrow();
    }
  });
  it("服务端已准备计划可使用同一附加表声明", async () => {
    const runtime = createReportRuntime({ reports: {} });
    const prepared = { plan, params: {}, revisions: {}, diagnostics: [], stats: { rows: 0, pages: 1, cells: 0, durationMs: 0 } };
    const result = await runtime.exportPrepared({ prepared, format: "xlsx", xlsx: { additionalSheets } });
    const read = new ExcelJS.Workbook();
    await read.xlsx.load(result.bytes as unknown as ExcelJS.Buffer);
    expect(read.getWorksheet("来源")!.getCell("B1").value).toBe("YTS0");
  });
  it("附表不能绕过服务端的总单元格预算，来源行数和计划统计含义保持稳定", async () => {
    const runtime = createReportRuntime({ reports: {}, budget: { maxCells: 7 } });
    const prepared = { plan, params: {}, revisions: {}, diagnostics: [], stats: { rows: 0, pages: 1, cells: 0, durationMs: 0 } };
    await expect(runtime.exportPrepared({ prepared, format: "xlsx", xlsx: { additionalSheets } })).rejects.toMatchObject({ code: "budget", path: "$.budget.maxCells" });
    const output = await createReportRuntime({ reports: {}, budget: { maxRows: 1, maxCells: 8 } }).exportPrepared({ prepared, format: "xlsx", xlsx: { additionalSheets } });
    expect(output.stats).toMatchObject({ rows: 0, cells: 0 });
  });
  it("进度包含附表，最终文件编码完成前不会报告100%", async () => {
    const progress: [number, number][] = [];
    const prototype = Object.getPrototypeOf(new ExcelJS.Workbook().xlsx) as ExcelJS.Workbook["xlsx"];
    const original = prototype.writeBuffer;
    vi.spyOn(prototype, "writeBuffer").mockImplementation(function (this: ExcelJS.Workbook["xlsx"], options) {
      expect(progress).toEqual([[1, 3], [2, 3]]);
      return original.call(this, options);
    });
    const result = await renderPlanToXlsx(plan, { additionalSheets, onProgress: (completed, total) => progress.push([completed, total]) });
    expect(progress).toEqual([[1, 3], [2, 3], [3, 3]]);
    const read = new ExcelJS.Workbook(); await read.xlsx.load(result.buffer);
    expect(read.worksheets).toHaveLength(2);
    expect(read.getWorksheet("来源")!.getCell("B2").value).toBe(1);
  });
  it("最后一张附表完成后仍可取消，不启动ZIP编码", async () => {
    const controller = new AbortController(); const progress: [number, number][] = [];
    const write = vi.spyOn(Object.getPrototypeOf(new ExcelJS.Workbook().xlsx) as ExcelJS.Workbook["xlsx"], "writeBuffer");
    await expect(renderPlanToXlsx(plan, { additionalSheets, signal: controller.signal, onProgress: (completed, total) => {
      progress.push([completed, total]); if (completed === total - 1) controller.abort();
    } })).rejects.toMatchObject({ name: "AbortError" });
    expect(write).not.toHaveBeenCalled();
    expect(progress).toEqual([[1, 3], [2, 3]]);
  });
  it("附表写入过程中响应取消并释放，源声明不被修改", async () => {
    const controller = new AbortController();
    const prototype = Object.getPrototypeOf(new ExcelJS.Workbook().addWorksheet("probe")) as ExcelJS.Worksheet;
    const original = prototype.addRow;
    const add = vi.spyOn(prototype, "addRow").mockImplementation(function (this: ExcelJS.Worksheet, values, style) {
      const row = original.call(this, values, style);
      if (this.name === "large" && this.rowCount === 512) controller.abort();
      return row;
    });
    const rows = Array.from({ length: 2000 }, (_, index) => [index]);
    await expect(renderPlanToXlsx(plan, { additionalSheets: [{ name: "large", rows }], signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(add).toHaveBeenCalledTimes(512);
    expect(rows).toHaveLength(2000); expect(rows[511]).toEqual([511]);
  });
  it("工作簿构建的完成进度只统计实际工作表", async () => {
    const progress: [number, number][] = [];
    const result = await renderPlanToWorkbook(plan, { additionalSheets, onProgress: (completed, total) => progress.push([completed, total]) });
    expect(progress).toEqual([[1, 2], [2, 2]]);
    expect(result.workbook.worksheets).toHaveLength(2);
  });
});
