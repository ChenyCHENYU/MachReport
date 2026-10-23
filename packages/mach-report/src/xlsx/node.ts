/** Node-only streaming data export. Intentionally excluded from the browser /xlsx entry. */
import { createWriteStream } from "node:fs";
import { setImmediate as yieldToIo } from "node:timers/promises";
import { isWritable, type Writable } from "node:stream";
import ExcelJS from "exceljs";
import { observeOutput } from "../output/progress";

export type XlsxRowValue = string | number | boolean | Date | null | undefined;

export interface XlsxStreamColumn<Row> {
  key: keyof Row & string;
  header?: string;
  width?: number;
  numberFormat?: string;
  value?: (row: Row, rowIndex: number) => XlsxRowValue;
}

export interface XlsxStreamProgress {
  rowsWritten: number;
  elapsedMs: number;
}

interface XlsxStreamCommonOptions<Row> {
  columns: readonly XlsxStreamColumn<Row>[];
  sheetName?: string;
  signal?: AbortSignal;
  /** Data rows, excluding the header. Excel's hard limit is always enforced. */
  maxRows?: number;
  maxDurationMs?: number;
  /** Yield/check downstream backpressure after each batch (default 256). */
  batchSize?: number;
  onProgress?: (progress: XlsxStreamProgress) => void;
}

export type XlsxStreamOptions<Row> = XlsxStreamCommonOptions<Row> & (
  | { stream: Writable; filename?: never }
  | { filename: string; stream?: never }
);

const MAX_DATA_ROWS = 1_048_575;

function validateOptions<Row>(options: XlsxStreamOptions<Row>): void {
  validateDestination(options);
  validateColumns(options.columns);
  if (options.sheetName !== undefined && (!options.sheetName || options.sheetName.length > 31 || /[\\/*?:[\]]/.test(options.sheetName))) throw new TypeError("Invalid XLSX sheetName.");
  positiveInteger(options.maxRows, "maxRows", MAX_DATA_ROWS);
  positiveInteger(options.batchSize, "batchSize", MAX_DATA_ROWS);
  if (options.maxDurationMs !== undefined && (!Number.isFinite(options.maxDurationMs) || options.maxDurationMs <= 0 || options.maxDurationMs > 2_147_483_647)) throw new RangeError("maxDurationMs must be positive and at most 2147483647.");
}

function validateDestination<Row>(options: XlsxStreamOptions<Row>): void {
  if ((options.stream === undefined) === (options.filename === undefined)) throw new TypeError("Provide exactly one explicit XLSX destination: stream or filename.");
  if (options.stream !== undefined && !isWritable(options.stream)) throw new TypeError("XLSX stream must be an open Node writable stream.");
  if (options.filename !== undefined && (typeof options.filename !== "string" || !options.filename || options.filename.includes("\0"))) throw new TypeError("XLSX filename must be a nonempty path without null bytes.");
}

function validateColumns<Row>(columns: readonly XlsxStreamColumn<Row>[]): void {
  if (!columns.length || columns.length > 16_384) throw new RangeError("XLSX requires between 1 and 16384 columns.");
  const keys = new Set<string>();
  for (const column of columns) {
    if (!column.key || keys.has(column.key)) throw new TypeError("XLSX column keys must be nonempty and unique.");
    keys.add(column.key);
    if (column.width !== undefined && (!Number.isFinite(column.width) || column.width <= 0 || column.width > 255)) throw new RangeError("XLSX column width must be greater than 0 and at most 255.");
    checkedValue(column.header ?? column.key);
  }
}

function positiveInteger(value: number | undefined, name: string, maximum: number): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 1 || value > maximum)) throw new RangeError(`${name} must be an integer between 1 and ${maximum}.`);
}

function checkedValue(value: unknown): XlsxRowValue {
  if (value === undefined || value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return value;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === "string") {
    if (value.length > 32_767 || (value.match(/\n/g)?.length ?? 0) > 253) throw new RangeError("XLSX cell text exceeds Excel's 32767-character or 253-line-feed limit; nothing was truncated.");
    return value;
  }
  throw new TypeError("XLSX values must be finite numbers (safe integers), strings, booleans, valid dates or null. Use strings for large identifiers; formula objects require a separate trusted adapter.");
}

function checkBudget(signal: AbortSignal, startedAt: number, maxDurationMs?: number): void {
  if (signal.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
  if (maxDurationMs !== undefined && Date.now() - startedAt > maxDurationMs) throw new RangeError("XLSX export exceeded maxDurationMs.");
}

function withAbort<T>(pending: PromiseLike<T> | T, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(pending).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

async function downstreamReady(stream: Writable, signal: AbortSignal): Promise<void> {
  await yieldToIo();
  if (!stream.writableNeedDrain) return;
  await withAbort(new Promise<void>((resolve, reject) => {
    const cleanup = () => { stream.removeListener("drain", drained); stream.removeListener("error", failed); signal.removeEventListener("abort", cleanup); };
    const drained = () => { cleanup(); resolve(); };
    const failed = (error: Error) => { cleanup(); reject(error); };
    stream.once("drain", drained);
    stream.once("error", failed);
    signal.addEventListener("abort", cleanup, { once: true });
  }), signal);
}

function configureSheet<Row>(workbook: ExcelJS.stream.xlsx.WorkbookWriter, options: XlsxStreamOptions<Row>): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(options.sheetName ?? "Report", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = options.columns.map((column) => ({
    header: column.header ?? column.key, width: column.width ?? 16,
    style: column.numberFormat ? { numFmt: column.numberFormat } : undefined
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).commit();
  return sheet;
}

function rowIterator<Row>(rows: AsyncIterable<Row> | Iterable<Row>): AsyncIterator<Row> | Iterator<Row> {
  return Symbol.asyncIterator in rows ? rows[Symbol.asyncIterator]() : rows[Symbol.iterator]();
}

function closeIterator<Row>(iterator: AsyncIterator<Row> | Iterator<Row>): void {
  try { void Promise.resolve(iterator.return?.()).catch(() => { /* upstream cleanup must not replace the export failure */ }); }
  catch { /* A provider may also throw synchronously from return(). */ }
}

function cleanupDestination<Row>(destination: Writable, iterator: AsyncIterator<Row> | Iterator<Row>, failed: (error: Error) => void, completed: boolean): void {
  if (!completed) { destination.destroy(); closeIterator(iterator); }
  // A file open can fail after cancellation; retain the error observer until the destroyed stream closes.
  if (!completed && !destination.closed) destination.once("close", () => destination.removeListener("error", failed));
  else destination.removeListener("error", failed);
}

/**
 * Commits each source row directly to ExcelJS WorkbookWriter. No RenderPlan, full row array,
 * Workbook or Buffer is retained. Styles are column-scoped; shared strings are disabled.
 * Destination is ended by the writer. An abort/error leaves a partial, unusable XLSX file.
 */
export async function writeRowsToXlsx<Row extends object>(rows: AsyncIterable<Row> | Iterable<Row>, options: XlsxStreamOptions<Row>): Promise<XlsxStreamProgress> {
  validateOptions(options);
  if (options.signal?.aborted) throw options.signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
  const iterator = rowIterator(rows);
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  const deadline = options.maxDurationMs === undefined ? undefined : setTimeout(() => controller.abort(new RangeError("XLSX export exceeded maxDurationMs.")), options.maxDurationMs);
  const startedAt = Date.now();
  const destination = options.stream ?? createWriteStream(options.filename!);
  const failed = (error: Error) => controller.abort(error);
  destination.on("error", failed);
  let rowsWritten = 0;
  let completed = false;
  try {
    if (destination.destroyed || destination.writableEnded) throw new Error("XLSX destination must be an open writable stream.");
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: destination, useStyles: true, useSharedStrings: false });
    const sheet = configureSheet(workbook, options);
    while (true) {
      checkBudget(controller.signal, startedAt, options.maxDurationMs);
      const next = await withAbort(iterator.next(), controller.signal);
      if (next.done) break;
      if (rowsWritten >= (options.maxRows ?? MAX_DATA_ROWS)) throw new RangeError("XLSX export exceeded maxRows; no rows were silently omitted.");
      const values = options.columns.map((column) => checkedValue(column.value ? column.value(next.value, rowsWritten) : next.value[column.key]));
      sheet.addRow(values).commit();
      rowsWritten++;
      if (rowsWritten % (options.batchSize ?? 256) === 0) {
        await downstreamReady(destination, controller.signal);
        observeOutput(() => options.onProgress?.({ rowsWritten, elapsedMs: Date.now() - startedAt }));
      }
    }
    checkBudget(controller.signal, startedAt, options.maxDurationMs);
    sheet.commit();
    await withAbort(workbook.commit(), controller.signal);
    completed = true;
    const result = { rowsWritten, elapsedMs: Date.now() - startedAt };
    observeOutput(() => options.onProgress?.(result));
    return result;
  } finally {
    clearTimeout(deadline);
    options.signal?.removeEventListener("abort", abort);
    cleanupDestination(destination, iterator, failed, completed);
  }
}
