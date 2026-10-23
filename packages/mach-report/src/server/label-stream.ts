import type { ReportTemplate } from "../layout/paginate";
import type { PreparedReport, ReportRuntimeOptions, ReportPdfFontOptions, ReportRuntimePreparedExportInput, ReportRuntimeExportResult } from "./types";
import { createReportRuntime } from "./runtime";
import { runReportBatch } from "./batch";
import { controlled, ReportRuntimeError, throwIfAborted } from "./control";
import { readRecordScalar } from "../layout/record-bindings";
import { validateReportTemplate } from "../source/template-registry";

export interface LabelStreamReceipt {
  /** Private artifact storage key, not a credential-bearing URL. */
  key: string;
  format: "pdf" | "xlsx";
  bytes: number;
  sha256?: string;
}
export interface LabelStreamContext {
  index: number;
  rowOffset: number;
  rowCount: number;
  signal: AbortSignal;
  /** Encode this chunk with the same runtime, resources, fonts, signal and budgets. */
  export(input: Omit<ReportRuntimePreparedExportInput, "prepared" | "signal">): Promise<ReportRuntimeExportResult>;
}
export interface LabelStreamOptions {
  template: ReportTemplate;
  batchSize?: number;
  maxRows?: number;
  maxChunks?: number;
  /** Conservative retained scalar/key size (UTF-16 + field overhead), default 16 MB. */
  maxRetainedBytes?: number;
  signal?: AbortSignal;
  /** Shared existing runtime budgets/assets; callbacks never cross a Worker boundary. */
  runtime?: Omit<ReportRuntimeOptions, "reports" | "executor">;
  pdf?: ReportPdfFontOptions;
  /** Persist each artifact here; retain only its small receipt in the manifest. */
  execute(prepared: PreparedReport, context: LabelStreamContext): Promise<LabelStreamReceipt>;
  /** Awaited after commit and before pulling more source rows. A failure stops consumption. */
  onReceipt?(receipt: LabelStreamReceipt, context: LabelStreamContext): void | Promise<void>;
}
export interface LabelStreamManifest {
  rows: number;
  chunks: Array<LabelStreamReceipt & { index: number; rowOffset: number; rowCount: number }>;
}
function integer(value: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new RangeError(`${name} 应为 1–${maximum} 的安全整数`);
  return value;
}
function receiptSnapshot(value: LabelStreamReceipt): LabelStreamReceipt {
  if (!value || typeof value.key !== "string" || !value.key.trim() || value.key.length > 1024 || !["pdf", "xlsx"].includes(value.format) || !Number.isSafeInteger(value.bytes) || value.bytes < 0 || value.sha256 !== undefined && !/^[a-f0-9]{64}$/i.test(value.sha256)) throw new TypeError("分批归档回执应包含存储键、格式、大小和可选 SHA256");
  return { key: value.key, format: value.format, bytes: value.bytes, ...(value.sha256 ? { sha256: value.sha256 } : {}) };
}
function streamTemplate(template: ReportTemplate): ReportTemplate {
  const validation = validateReportTemplate(template);
  if (!validation.ok || !template.repeat) throw new TypeError("分批生成仅支持有效的逐记录固定标签模板");
  return JSON.parse(JSON.stringify(template)) as ReportTemplate;
}
function bindingFields(template: ReportTemplate): string[] {
  const fields = new Set<string>();
  const repeat = template.repeat!;
  if (repeat.rowKey) fields.add(repeat.rowKey);
  if (typeof repeat.copies === "object") fields.add(repeat.copies.field);
  const visit = (component: import("../schema/render-plan").PlanComponent) => {
    if (component.binding) fields.add(component.binding.field);
    for (const row of component.grid?.cells ?? []) for (const cell of row) cell?.children?.forEach(visit);
  };
  template.pages.forEach(page => page.components.forEach(component => visit(component as import("../schema/render-plan").PlanComponent)));
  return [...fields];
}
function snapshotRow(input: object, fields: string[], dataset: string, rowIndex: number): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError(`标签记录 ${rowIndex} 应为对象`);
  const result: Record<string, unknown> = Object.create(null);
  // Only declared scalar inputs enter the chunk; reused/mutated generator objects are safe.
  for (const field of fields) {
    const value = readRecordScalar(input as Record<string, unknown>, field, { dataset, rowIndex });
    if (typeof value === "string" && value.length > 1_000_000) throw new ReportRuntimeError("budget", "标签字段超过 1 MB 字符预算", `$.datasets.${dataset}[${rowIndex}].${field}`);
    if (value !== undefined) result[field] = value;
  }
  return result;
}
function checkKey(row: Record<string, unknown>, template: ReportTemplate, ledger: { keys: Set<string>; bytes: number }, rowIndex: number): void {
  const repeat = template.repeat!;
  if (!repeat.rowKey) return;
  const key = readRecordScalar(row, repeat.rowKey, { rowIndex, dataset: repeat.dataset });
  if (!(typeof key === "string" && key.trim() || typeof key === "number" && Number.isFinite(key))) throw new TypeError(`标签记录 ${rowIndex} 的业务主键无效`);
  const identity = JSON.stringify([typeof key, key]);
  if (ledger.keys.has(identity)) throw new TypeError(`标签记录 ${rowIndex} 的业务主键重复（包含先前批次）`);
  ledger.bytes += identity.length * 2 + 64;
  ledger.keys.add(identity);
}
function retainedRowBytes(row: Record<string, unknown>): number {
  return Object.entries(row).reduce((total, [key, value]) => total + 64 + key.length * 2 + (typeof value === "string" ? value.length * 2 : 8), 0);
}
function offsetPlan(prepared: PreparedReport, offset: number): PreparedReport {
  if (!offset) return prepared;
  for (const page of prepared.plan.pages) {
    const record = page.meta?.record;
    if (record && typeof record === "object" && "rowIndex" in record && typeof record.rowIndex === "number") record.rowIndex += offset;
  }
  return prepared;
}

async function closeIterator(iterator: AsyncIterator<object>, signal: AbortSignal): Promise<void> {
  if (!iterator.return) return;
  const closing = Promise.resolve(iterator.return());
  if (signal.aborted) { void closing.catch(() => {}); return; }
  await controlled(signal, undefined, () => closing);
}
async function notifyReceipt(options: LabelStreamOptions, receipt: LabelStreamReceipt, context: LabelStreamContext): Promise<void> {
  // Invoke once even when cancellation arrived immediately after an artifact commit.
  const notified = Promise.resolve().then(() => options.onReceipt?.(receipt, context));
  void notified.catch(() => {});
  await controlled(context.signal, undefined, () => notified);
}
/** A same-turn committed receipt wins; an uncooperative archive cannot retain the runner.
 * Late commits are observed only as small receipts with the already-aborted context signal.
 */
function waitForExecution(pending: Promise<LabelStreamReceipt>, signal: AbortSignal, late: (receipt: LabelStreamReceipt) => Promise<void>): Promise<LabelStreamReceipt> {
  return new Promise((resolve, reject) => {
    let settled = false, abandoned = false, timer: ReturnType<typeof setTimeout> | undefined;
    const clean = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
    const abort = () => {
      if (settled || timer !== undefined) return;
      // Finish this turn's promise reactions before classifying a receipt as late.
      timer = setTimeout(() => {
        if (settled) return;
        settled = true; abandoned = true; clean();
        try { throwIfAborted(signal); } catch (error) { reject(error); }
      }, 0);
    };
    pending.then(receipt => {
      if (abandoned) { void Promise.resolve().then(() => late(receipt)).catch(() => {}); return; }
      if (settled) return;
      settled = true; clean(); resolve(receipt);
    }, error => { if (!settled) { settled = true; clean(); reject(error); } });
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
/** Bounded fixed-label consumption, not cross-chunk aggregation or a new durable task queue.
 * The next source chunk is pulled only after execute + onReceipt complete. Earlier receipts
 * remain committed if a later chunk fails; use onReceipt for a durable incremental manifest.
 */
export async function runLabelStream(source: AsyncIterable<object>, options: LabelStreamOptions): Promise<LabelStreamManifest> {
  const batchSize = integer(options.batchSize ?? 100, 1000, "batchSize");
  const maxRows = integer(options.maxRows ?? 100_000, 1_000_000, "maxRows"), maxChunks = integer(options.maxChunks ?? 1000, 10_000, "maxChunks");
  const maxRetainedBytes = integer(options.maxRetainedBytes ?? 16_000_000, 64_000_000, "maxRetainedBytes");
  const template = streamTemplate(options.template), fields = bindingFields(template);
  if (!source || typeof source[Symbol.asyncIterator] !== "function") throw new TypeError("标签来源应为 AsyncIterable");
  return controlled(options.signal, options.runtime?.budget?.maxDurationMs ?? 120_000, async signal => {
    const manifest: LabelStreamManifest = { rows: 0, chunks: [] }, ledger = { keys: new Set<string>(), bytes: 0 }, iterator = source[Symbol.asyncIterator]();
    let ended = false, primaryFailure = false;
    let cleanup: Promise<void> | undefined;
    const close = () => cleanup ??= closeIterator(iterator, signal);
    const abortCleanup = () => { if (!ended) void close().catch(() => {}); };
    signal.addEventListener("abort", abortCleanup, { once: true });
    try {
      while (!ended) {
        throwIfAborted(signal);
        const rows: Record<string, unknown>[] = [];
        let retainedBytes = 0;
        while (rows.length < batchSize) {
          const next = await controlled(signal, undefined, () => Promise.resolve(iterator.next()));
          if (next.done) { ended = true; break; }
          if (manifest.rows + rows.length >= maxRows) throw new ReportRuntimeError("budget", "标签来源行数超过预算", "$.maxRows");
          if (manifest.chunks.length >= maxChunks) throw new ReportRuntimeError("budget", "标签分块数量超过预算", "$.maxChunks");
          const row = snapshotRow(next.value, fields, template.repeat!.dataset, manifest.rows + rows.length);
          checkKey(row, template, ledger, manifest.rows + rows.length);
          retainedBytes += retainedRowBytes(row);
          if (ledger.bytes + retainedBytes > maxRetainedBytes) throw new ReportRuntimeError("budget", "标签当前块字段与全局主键索引超过内存预算", "$.maxRetainedBytes");
          rows.push(row);
        }
        if (!rows.length) break;
        const runtime = createReportRuntime({ ...options.runtime, reports: { labels: { template, datasets: { [template.repeat!.dataset]: rows } } } });
        let prepared: PreparedReport;
        const context: LabelStreamContext = { index: manifest.chunks.length, rowOffset: manifest.rows, rowCount: rows.length, signal,
          export: input => runtime.exportPrepared({ pdf: options.pdf, ...input, prepared, signal })
        };
        let failure: unknown;
        const outcomes = await runReportBatch([{ id: `labels-${context.index}`, params: {} }], async () => {
          try {
            prepared = offsetPlan(await runtime.prepare({ reportIds: ["labels"], pdf: options.pdf, signal }), context.rowOffset);
            throwIfAborted(signal);
            const pending = Promise.resolve(options.execute(prepared, context));
            const receipt = await waitForExecution(pending, signal, value => notifyReceipt(options, receiptSnapshot(value), context));
            return receiptSnapshot(receipt);
          } catch (error) { failure = error; throw error; }
        }, { concurrency: 1, signal, failure: "stop" });
        const outcome = outcomes[0]!;
        if (outcome.status === "cancelled") { throwIfAborted(signal); throw new Error("标签分批任务已取消"); }
        if (outcome.status === "failed") throw failure ?? new Error(outcome.error.message);
        // Commit stays committed even if cancellation arrives just after execute resolves.
        manifest.chunks.push({ ...outcome.value, index: context.index, rowOffset: context.rowOffset, rowCount: context.rowCount });
        manifest.rows += rows.length;
        await notifyReceipt(options, outcome.value, context);
      }
      return manifest;
    } catch (error) { primaryFailure = true; throw error; }
    finally {
      signal.removeEventListener("abort", abortCleanup);
      if (!ended) {
        await close().catch(error => { if (!primaryFailure) throw error; });
      }
    }
  });
}
