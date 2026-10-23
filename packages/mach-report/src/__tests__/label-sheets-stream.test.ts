// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { createLabelTemplate } from "../builder/label-template";
import { paginateTemplate } from "../layout/paginate";
import { imposeLabelSheets } from "../layout/label-sheets";
import { runLabelStream } from "../server/label-stream";
import { createReportRuntime } from "../server/runtime";

const template = createLabelTemplate({ dataset: "items", rowKey: "id", copies: { field: "copies" }, pages: [
  { components: [{ kind: "text", leftMm: 3, topMm: 3, widthMm: 70, heightMm: 8, binding: { field: "id" } }] },
  { components: [{ kind: "text", leftMm: 3, topMm: 4, widthMm: 70, heightMm: 8, text: "Back" }] }
] });
const rows = [{ id: "0001", copies: 2 }, { id: "0002", copies: 1 }];
async function* source(count: number) { for (let id = 0; id < count; id++) yield { id: String(id), copies: 1 }; }

describe("physical label sheet imposition", () => {
  it("keeps record/copy/face order with first-sheet empty slots and exact millimetre positions", async () => {
    const plan = paginateTemplate(template, { items: rows }).plan, original = JSON.stringify(plan);
    const imposed = imposeLabelSheets(plan, { columns: 2, rows: 4, marginMm: 5, gapMm: 2, startSlot: 3 });
    expect(imposed.pages).toHaveLength(2);
    expect(imposed.pages.map(page => page.components.length)).toEqual([5, 1]);
    expect(imposed.pages[0]!.components[0]).toMatchObject({ leftMm: 90, topMm: 65 });
    expect(imposed.pages[1]!.components[0]).toMatchObject({ leftMm: 8, topMm: 9, text: "Back" });
    const placements = imposed.pages.flatMap(page => (page.meta!.labelSheet as { slots: Array<{ sourcePageIndex: number; sourceMeta: unknown }> }).slots);
    expect(placements.map(slot => slot.sourcePageIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(placements[2]?.sourceMeta).toMatchObject({ record: { rowIndex: 0, copyIndex: 1, templatePageIndex: 0 } });
    const runtime = createReportRuntime({ reports: {} });
    const file = await runtime.exportPrepared({ prepared: { plan: imposed, stats: { rows: 2, cells: 0, pages: 2, durationMs: 0 }, diagnostics: [], revisions: {} }, format: "pdf" });
    const pdf = await PDFDocument.load(file.bytes);
    expect(pdf.getPageCount()).toBe(2); expect(pdf.getPages()[0]!.getWidth()).toBeCloseTo(210 * 72 / 25.4, 6);
    expect(pdf.getPages()[0]!.getHeight()).toBeCloseTo(297 * 72 / 25.4, 6);
    expect(JSON.stringify(plan)).toBe(original);
  });
  it("preflights physical overflow, mixed page sizes, start position, cancellation and full budgets", () => {
    const plan = paginateTemplate(template, { items: rows }).plan;
    expect(() => imposeLabelSheets(plan, { columns: 3, rows: 1 })).toThrow("不会自动缩小");
    expect(() => imposeLabelSheets(plan, { columns: 2, rows: 4, startSlot: 8 })).toThrow("起始位置");
    expect(() => imposeLabelSheets(plan, { columns: 2, rows: 4, offsetMm: { x: -1, y: 0 } })).toThrow("尺寸");
    expect(() => imposeLabelSheets(plan, { columns: 1, rows: 1, maxSheets: 1 })).toThrow("数量超过预算");
    expect(() => imposeLabelSheets(plan, { columns: 2, rows: 4, maxComponents: 1 })).toThrow("组件总量");
    expect(() => imposeLabelSheets(plan, { columns: 2, rows: 4, marginMm: { top: 1 } as never })).toThrow();
    plan.pages[1]!.pageWidthMm = 79;
    expect(() => imposeLabelSheets(plan, { columns: 2, rows: 4 })).toThrow("尺寸相同");
    const controller = new AbortController(); controller.abort();
    expect(() => imposeLabelSheets(plan, { columns: 2, rows: 4, signal: controller.signal })).toThrow(expect.objectContaining({ name: "AbortError" }));
    expect(imposeLabelSheets({ ...plan, pages: [] }, { columns: 2, rows: 4, startSlot: 2 }).pages).toEqual([]);
  });
  it("creates independent nested metadata, grid and style snapshots under a byte budget", () => {
    const plan = paginateTemplate(template, { items: rows }).plan;
    plan.pages[0]!.components[0]!.style = { color: "#111111" };
    plan.pages[0]!.components[0]!.grid = { cells: [[{ text: "original", style: { bold: true } }]] };
    const imposed = imposeLabelSheets(plan, { columns: 2, rows: 4 });
    imposed.pages[0]!.components[0]!.style!.color = "#222222";
    imposed.pages[0]!.components[0]!.grid!.cells[0]![0]!.text = "changed";
    const placement = imposed.pages[0]!.components[0]!.meta!.labelSheet as { sourceMeta: { record: { rowKey: string } } };
    placement.sourceMeta.record.rowKey = "changed";
    expect(plan.pages[0]!.components[0]!.style!.color).toBe("#111111");
    expect(plan.pages[0]!.components[0]!.grid!.cells[0]![0]!.text).toBe("original");
    expect(plan.pages[0]!.meta!.record).toMatchObject({ rowKey: "0001" });
    expect(() => imposeLabelSheets(plan, { columns: 2, rows: 4, maxSnapshotBytes: 10 })).toThrow("预算");
  });
});
describe("bounded label stream and artifact manifest", () => {
  it("awaits execution and receipt before reading another chunk, preserving global identities", async () => {
    const pulls: number[] = [], committed: number[] = [], observed: number[] = [];
    async function* records() { for (let id = 0; id < 5; id++) { pulls.push(id); yield { id: String(id), copies: 1 }; } }
    const manifest = await runLabelStream(records(), { template, batchSize: 2, execute: async (prepared, context) => {
      expect(pulls.length).toBe(Math.min(5, (context.index + 1) * 2));
      expect(observed.length).toBe(context.index);
      expect(prepared.plan.pages[0]!.meta).toMatchObject({ record: { rowIndex: context.rowOffset, rowKey: String(context.rowOffset) } });
      const file = await context.export({ format: context.index % 2 ? "xlsx" : "pdf" });
      committed.push(context.index);
      return { key: `artifacts/${context.index}`, bytes: file.bytes.byteLength, format: file.format };
    }, onReceipt: async (_receipt, context) => { expect(committed).toContain(context.index); await Promise.resolve(); observed.push(context.index); } });
    expect(manifest).toMatchObject({ rows: 5, chunks: [{ index: 0, rowOffset: 0, rowCount: 2 }, { index: 1, rowOffset: 2, rowCount: 2 }, { index: 2, rowOffset: 4, rowCount: 1 }] });
  });
  it("snapshots declared fields when a generator reuses one mutable row and detects duplicates across chunks", async () => {
    async function* reused() { const row = { id: "", copies: 1 }; for (let id = 0; id < 3; id++) { row.id = String(id); yield row; } }
    const ids: string[] = [];
    await runLabelStream(reused(), { template, batchSize: 3, execute: async prepared => {
      ids.push(...prepared.plan.pages.filter((_page, index) => index % 2 === 0).map(page => page.components[0]!.text!));
      return { key: "one", format: "pdf", bytes: 1 };
    } });
    expect(ids).toEqual(["0", "1", "2"]);
    async function* duplicate() { yield { id: "one", copies: 1 }; yield { id: "one", copies: 1 }; }
    const execute = vi.fn(async () => ({ key: "one", format: "pdf" as const, bytes: 1 }));
    await expect(runLabelStream(duplicate(), { template, batchSize: 1, execute })).rejects.toThrow("先前批次");
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("closes the source on failure/budget/cancel without retaining outputs or starting another chunk", async () => {
    let closed = 0, pulls = 0;
    async function* records() { try { for (let id = 0; id < 10; id++) { pulls++; yield { id: String(id), copies: 1 }; } } finally { closed++; } }
    const error = new Error("archive unavailable");
    await expect(runLabelStream(records(), { template, batchSize: 2, execute: async () => { throw error; } })).rejects.toBe(error);
    expect(pulls).toBe(2); expect(closed).toBe(1);
    await expect(runLabelStream(source(4), { template, batchSize: 2, maxRows: 3, execute: async () => ({ key: "first", format: "pdf", bytes: 1 }) })).rejects.toMatchObject({ code: "budget" });
    const controller = new AbortController();
    await expect(runLabelStream(records(), { template, signal: controller.signal, batchSize: 1, execute: async () => { controller.abort(); return { key: "committed", format: "pdf", bytes: 1 }; } })).rejects.toMatchObject({ name: "AbortError" });
    expect(closed).toBe(2);
  });
  it("validates fixed-label scope, bounded manifest, receipt values and a stalled iterator timeout", async () => {
    const execute = vi.fn(async () => ({ key: "one", format: "pdf" as const, bytes: 1 }));
    await expect(runLabelStream(source(3), { template, batchSize: 1, maxChunks: 1, execute })).rejects.toMatchObject({ code: "budget", path: "$.maxChunks" });
    expect(execute).toHaveBeenCalledTimes(1);
    await expect(runLabelStream(source(2), { template, batchSize: 1, maxRetainedBytes: 256, execute })).rejects.toMatchObject({ code: "budget", path: "$.maxRetainedBytes" });
    const stalled = { [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<object>>(() => {}) }) };
    await expect(runLabelStream(stalled, { template, runtime: { budget: { maxDurationMs: 10 } }, execute })).rejects.toMatchObject({ code: "timeout" });
    await expect(runLabelStream(source(1), { template: { pages: [] }, execute })).rejects.toThrow("固定标签");
    await expect(runLabelStream(source(1), { template, execute: async () => ({ key: "", format: "pdf", bytes: 1 }) })).rejects.toThrow("回执");
    expect(await runLabelStream(source(0), { template, execute })).toEqual({ rows: 0, chunks: [] });
  });
  it("times out a stalled receipt, closes the source, and preserves the already committed receipt", async () => {
    let closed = 0, receipts = 0;
    async function* records() { try { yield { id: "one", copies: 1 }; yield { id: "two", copies: 1 }; } finally { closed++; } }
    await expect(runLabelStream(records(), { template, batchSize: 1, runtime: { budget: { maxDurationMs: 20 } },
      execute: async () => ({ key: "committed", format: "pdf", bytes: 1 }),
      onReceipt: () => { receipts++; return new Promise(() => {}); }
    })).rejects.toMatchObject({ code: "timeout" });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(receipts).toBe(1); expect(closed).toBe(1);
  });
  it("cancels a stalled receipt and does not mask execution failures with a throwing iterator return", async () => {
    const controller = new AbortController();
    let enter!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    let closed = 0;
    async function* records() { try { yield { id: "one", copies: 1 }; yield { id: "two", copies: 1 }; } finally { closed++; } }
    const pending = runLabelStream(records(), { template, batchSize: 1, signal: controller.signal,
      execute: async () => ({ key: "committed", format: "pdf", bytes: 1 }),
      onReceipt: () => { enter(); return new Promise(() => {}); }
    });
    await entered; controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await new Promise(resolve => setTimeout(resolve, 0)); expect(closed).toBe(1);
    const source = { [Symbol.asyncIterator]: () => ({ next: async () => ({ value: { id: "one", copies: 1 }, done: false }), return: () => { throw new Error("cleanup failure"); } }) };
    const original = new Error("archive failure");
    await expect(runLabelStream(source, { template, batchSize: 1, execute: async () => { throw original; } })).rejects.toBe(original);
  });
  it("does not let a stalled iterator return extend the total duration budget", async () => {
    let closed = 0;
    const source = { [Symbol.asyncIterator]: () => ({
      next: async () => ({ value: { id: "one", copies: 1 }, done: false }),
      return: () => { closed++; return new Promise<IteratorResult<object>>(() => {}); }
    }) };
    const original = new Error("archive failure");
    await expect(runLabelStream(source, { template, batchSize: 1, runtime: { budget: { maxDurationMs: 20 } }, execute: async () => { throw original; } })).rejects.toMatchObject({ code: "timeout" });
    expect(closed).toBe(1);
  });
  it("releases a stalled execute and closes its iterator after total timeout", async () => {
    let closed = 0, pulls = 0;
    async function* records() { try { pulls++; yield { id: "one", copies: 1 }; pulls++; yield { id: "two", copies: 1 }; } finally { closed++; } }
    await expect(runLabelStream(records(), { template, batchSize: 1, runtime: { budget: { maxDurationMs: 20 } }, execute: () => new Promise(() => {}) })).rejects.toMatchObject({ code: "timeout" });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(closed).toBe(1); expect(pulls).toBe(1);
  });
  it("reports a same-turn committed receipt once despite cancellation, and audits a later commit without resuming consumption", async () => {
    const controller = new AbortController(), immediate: string[] = [];
    await expect(runLabelStream(source(2), { template, batchSize: 1, signal: controller.signal,
      execute: async () => { controller.abort(); return { key: "committed", format: "pdf", bytes: 1 }; },
      onReceipt: receipt => { immediate.push(receipt.key); }
    })).rejects.toMatchObject({ name: "AbortError" });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(immediate).toEqual(["committed"]);

    let closed = 0, pulls = 0, complete!: (receipt: { key: string; format: "pdf"; bytes: number }) => void;
    const late: string[] = [], pendingArchive = new Promise<{ key: string; format: "pdf"; bytes: number }>(resolve => { complete = resolve; });
    async function* records() { try { pulls++; yield { id: "one", copies: 1 }; pulls++; yield { id: "two", copies: 1 }; } finally { closed++; } }
    await expect(runLabelStream(records(), { template, batchSize: 1, runtime: { budget: { maxDurationMs: 20 } }, execute: () => pendingArchive,
      onReceipt: (receipt, context) => { expect(context.signal.aborted).toBe(true); late.push(receipt.key); }
    })).rejects.toMatchObject({ code: "timeout" });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(closed).toBe(1); expect(pulls).toBe(1);
    complete({ key: "late-commit", format: "pdf", bytes: 1 });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(late).toEqual(["late-commit"]); expect(pulls).toBe(1);
  });
});
