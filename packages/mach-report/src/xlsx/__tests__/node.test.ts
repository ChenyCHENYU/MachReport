// @vitest-environment node
import { Writable } from "node:stream";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { writeRowsToXlsx } from "../node";

function collectedStream() {
  const chunks: Buffer[] = [];
  const stream = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
  return { stream, buffer: () => Buffer.concat(chunks) };
}

describe("Node streaming XLSX data writer", () => {
  it("consumes an async source and creates real typed Excel rows while reporting batches", async () => {
    const output = collectedStream();
    const progress: number[] = [];
    async function* source() {
      for (let index = 0; index < 1200; index++) yield { id: String(index).padStart(5, "0"), amount: index, note: "=SUM(A1:A2)" };
    }
    const result = await writeRowsToXlsx(source(), { stream: output.stream, columns: [{ key: "id", header: "Heat" }, { key: "amount", numberFormat: "0.00" }, { key: "note" }], batchSize: 200, onProgress: ({ rowsWritten }) => progress.push(rowsWritten) });
    expect(result.rowsWritten).toBe(1200);
    expect(progress).toEqual([200, 400, 600, 800, 1000, 1200, 1200]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(output.buffer()).buffer);
    const sheet = workbook.getWorksheet(1)!;
    expect(sheet.rowCount).toBe(1201);
    expect(sheet.getCell("A2").value).toBe("00000");
    expect(sheet.getCell("B2").value).toBe(0);
    expect(sheet.getCell("B1201").value).toBe(1199);
    expect(sheet.getCell("B2").numFmt).toBe("0.00");
    expect(sheet.getCell("C2").type).toBe(ExcelJS.ValueType.String);
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
  });

  it("supports explicit file destinations and value projection without changing the source", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mach-stream-"));
    try {
      const filename = join(directory, "report.xlsx");
      const rows = [{ value: 12.5 }];
      await writeRowsToXlsx(rows, { filename, sheetName: "Daily", columns: [{ key: "value", value: (row) => row.value * 2 }] });
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Uint8Array.from(await readFile(filename)).buffer);
      expect(workbook.getWorksheet("Daily")!.getCell("A2").value).toBe(25);
      expect(rows).toEqual([{ value: 12.5 }]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("rejects row budget overflow, destroys incomplete output and closes the source", async () => {
    const output = collectedStream();
    let closed = false;
    async function* source() { try { yield { id: 1 }; yield { id: 2 }; } finally { closed = true; } }
    await expect(writeRowsToXlsx(source(), { stream: output.stream, columns: [{ key: "id" }], maxRows: 1 })).rejects.toThrow("maxRows");
    expect(output.stream.destroyed).toBe(true);
    expect(closed).toBe(true);
  });

  it("cancels a pending source read promptly even when a provider ignores the signal", async () => {
    const controller = new AbortController();
    const output = collectedStream();
    const source: AsyncIterable<{ id: number }> = { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) };
    const pending = writeRowsToXlsx(source, { stream: output.stream, signal: controller.signal, columns: [{ key: "id" }] });
    controller.abort(new Error("cancelled by caller"));
    await expect(pending).rejects.toThrow("cancelled by caller");
    expect(output.stream.destroyed).toBe(true);
  });

  it("enforces a wall-clock budget while waiting for upstream data", async () => {
    const output = collectedStream();
    const source: AsyncIterable<{ id: number }> = { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) };
    await expect(writeRowsToXlsx(source, { stream: output.stream, maxDurationMs: 20, columns: [{ key: "id" }] })).rejects.toThrow("maxDurationMs");
    expect(output.stream.destroyed).toBe(true);
  });

  it.each([NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, { formula: "1+1" }, "x".repeat(32_768)])("rejects invalid or oversized cells without truncation", async (value) => {
    const output = collectedStream();
    await expect(writeRowsToXlsx([{ value }], { stream: output.stream, columns: [{ key: "value" }] })).rejects.toThrow();
    expect(output.stream.destroyed).toBe(true);
  });

  it("propagates a failing downstream stream instead of returning a success result", async () => {
    const stream = new Writable({ write(_chunk, _encoding, callback) { callback(new Error("disk unavailable")); } });
    const rows = Array.from({ length: 300 }, (_, id) => ({ id }));
    await expect(writeRowsToXlsx(rows, { stream, columns: [{ key: "id" }], batchSize: 1 })).rejects.toThrow("disk unavailable");
  });

  it("a throwing upstream cleanup does not replace a row-budget failure", async () => {
    const output = collectedStream();
    const source: Iterable<{ id: number }> = { [Symbol.iterator]: () => ({ next: () => ({ value: { id: 1 }, done: false }), return: () => { throw new Error("cleanup failed"); } }) };
    await expect(writeRowsToXlsx(source, { stream: output.stream, columns: [{ key: "id" }], maxRows: 1 })).rejects.toThrow("maxRows");
  });
});
