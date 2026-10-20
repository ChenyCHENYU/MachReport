// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import ExcelJSRuntime from "exceljs";
import { openExcelWorkbook } from "../xlsx/workbook-session";
import { resolveImportOptions } from "../xlsx/import-types";
import { preflightExcelEntries } from "../xlsx/import-preflight";
import { importExcelTemplate, inspectExcelWorkbook } from "../xlsx/import-template";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function fixture(): Promise<Uint8Array> {
  const workbook = new ExcelJSRuntime.Workbook();
  workbook.addWorksheet("一").addRows([["数量", "金额"], [0, 12]]);
  workbook.addWorksheet("二").addRows([["炉号"], ["00001"]]);
  workbook.addWorksheet("隐藏", { state: "hidden" }).getCell("A1").value = "可显式选择";
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

describe("bounded reusable Excel workbook sessions", () => {
  it("parses once for inspection and multiple sheet conversions without sharing mutable results", async () => {
    const bytes = await fixture();
    const workbook = new ExcelJSRuntime.Workbook();
    const load = vi.spyOn(Object.getPrototypeOf(workbook.xlsx), "load");
    const session = await openExcelWorkbook(bytes);
    expect(load).toHaveBeenCalledTimes(1);
    const inspection = session.inspect();
    expect(inspection.sheets.map((sheet) => sheet.name)).toEqual(["一", "二", "隐藏"]);
    const first = await session.importTemplate({ sheets: ["一"] });
    first.template.pages.length = 0;
    const second = await session.importTemplate({ sheets: ["二"] });
    const original = await session.importTemplate({ sheets: ["一"] });
    expect(second.sheets.map((sheet) => sheet.name)).toEqual(["二"]);
    expect(original.template.pages.length).toBeGreaterThan(0);
    expect((await session.importTemplate({ sheets: ["隐藏"] })).sheets[0]?.name).toBe("隐藏");
    expect(load).toHaveBeenCalledTimes(1);
    session.dispose();
    expect(session.disposed).toBe(true);
    expect(() => session.inspect()).toThrow(/已释放/);
    await expect(session.importTemplate()).rejects.toThrow(/已释放/);
    expect(second.template.pages.length).toBeGreaterThan(0);
  });

  it("keeps opening budgets fixed and recovers from an invalid or cancelled selection", async () => {
    const session = await openExcelWorkbook(await fixture(), { limits: { maxCells: 4 } });
    await expect(session.importTemplate()).rejects.toThrow(/单元格/);
    await expect(session.importTemplate({ limits: { maxCells: 100 } } as never)).rejects.toThrow(/openExcelWorkbook/);
    await expect(session.importTemplate({ sheets: ["missing"] })).rejects.toThrow(/不存在/);
    const controller = new AbortController(); controller.abort();
    await expect(session.importTemplate({ sheets: ["一"], signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    const progress = vi.fn();
    expect((await session.importTemplate({ sheets: ["一"], onProgress: progress })).sheets).toHaveLength(1);
    expect(progress).toHaveBeenLastCalledWith(1, 1);
    session.dispose();
  });

  it("cancels in-flight conversion on dispose and refuses overlapping conversions", async () => {
    const session = await openExcelWorkbook(await fixture());
    const result = session.importTemplate();
    const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await expect(session.importTemplate({ sheets: ["二"] })).rejects.toThrow(/正在转换/);
    session.dispose();
    await rejected;
  });

  it("yields within one large Sheet so cancellation stops later segment allocations", async () => {
    const workbook = new ExcelJSRuntime.Workbook(), sheet = workbook.addWorksheet("大表");
    for (let row = 0; row < 1_600; row++) sheet.addRow([row, row]);
    const session = await openExcelWorkbook(new Uint8Array(await workbook.xlsx.writeBuffer()));
    const reads = vi.spyOn(Object.getPrototypeOf(sheet), "getCell");
    const controller = new AbortController(), progress = vi.fn();
    const cancel = setTimeout(() => controller.abort(), 0);
    try {
      await expect(session.importTemplate({ signal: controller.signal, onProgress: progress })).rejects.toMatchObject({ name: "AbortError" });
      expect(reads.mock.calls.length).toBeGreaterThan(0);
      expect(reads.mock.calls.length).toBeLessThan(3_200);
      expect(progress).not.toHaveBeenCalled();
    } finally { clearTimeout(cancel); session.dispose(); }
  });
});

describe("Excel import cancellation before parsing", () => {
  it("cancels a stalled reader promptly even when underlying cancel never settles, without opening later entries", async () => {
    const controller = new AbortController();
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const stream = vi.spyOn(Blob.prototype, "stream").mockImplementation(() => new ReadableStream({ cancel }));
    const entries = ["xl/workbook.xml", "xl/worksheets/sheet1.xml"].map((name) => ({ name, start: 0, compressed: 1, method: 0 }));
    const pending = preflightExcelEntries(new Uint8Array([0]), entries, resolveImportOptions({}), { signal: controller.signal });
    const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejection;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it.each([inspectExcelWorkbook, importExcelTemplate, openExcelWorkbook])("%s does not read an already cancelled Blob and detaches from a pending arrayBuffer", async (api) => {
    const buffer = vi.spyOn(Blob.prototype, "arrayBuffer").mockImplementation(() => new Promise<ArrayBuffer>(() => undefined));
    const cancelled = new AbortController(); cancelled.abort();
    await expect(api(new Blob(["xlsx"]), { signal: cancelled.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(buffer).not.toHaveBeenCalled();
    const controller = new AbortController();
    const pending = api(new Blob(["xlsx"]), { signal: controller.signal });
    const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejection;
    expect(buffer).toHaveBeenCalledTimes(1);
  });

  it("preserves the public converted-sheet progress contract", async () => {
    const progress = vi.fn();
    const result = await importExcelTemplate(await fixture(), { onProgress: progress });
    expect(result.sheets).toHaveLength(2);
    expect(progress.mock.calls).toEqual([[1, 2], [2, 2]]);
  });

  it("detaches promptly from a stalled third-party parser and ignores its late failure", async () => {
    const bytes = await fixture(), controller = new AbortController();
    const workbook = new ExcelJSRuntime.Workbook();
    let rejectParser!: (reason: Error) => void;
    const load = vi.spyOn(Object.getPrototypeOf(workbook.xlsx), "load").mockImplementation(() => new Promise((_resolve, reject) => { rejectParser = reject; }));
    const pending = openExcelWorkbook(bytes, { signal: controller.signal });
    const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    controller.abort(); await rejection;
    rejectParser(new Error("late parser failure"));
    await Promise.resolve();
  });
});
