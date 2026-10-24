// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createAutoReportExporter } from "../worker/auto";
import { createAutoExporterController } from "../worker/auto-core";
import { decideReportExport } from "../worker/auto-policy";
import { createReportWorkerExecutor } from "../worker/client";
import { REPORT_WORKER_PROTOCOL, type ReportWorkerRequest } from "../worker/protocol";
import { runReportEncodingRequest, serveReportEncodingWorker } from "../worker/encoding";
import { checkPreparedFont } from "../server/prepared";
import type { PreparedReport, ReportRuntimeExportResult, ReportRuntimePreparedExportInput } from "../server/types";
import type { BrowserReportWorker, ReportWorkerScope } from "../worker/browser";

const prepared = (): PreparedReport => ({ plan: { schemaVersion: "mach-report/1", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [{ kind: "text", leftMm: 0, topMm: 0, widthMm: 90, heightMm: 10, grid: { cells: [[{ text: "A" }, { text: "0", value: 0 }]] } }] }] }, stats: { rows: 1, pages: 1, cells: 0, durationMs: 0 }, diagnostics: [], revisions: {}, layout: { textMetrics: "heuristic" } });
const input = (): ReportRuntimePreparedExportInput => ({ prepared: prepared(), format: "xlsx" });
const result = (): ReportRuntimeExportResult => ({ bytes: new Uint8Array([1, 2]), format: "xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", stats: { rows: 1, pages: 1, cells: 2, durationMs: 0 }, diagnostics: [], revisions: {} });
function fakeWorker(run: (request: ReportWorkerRequest, emit: (value: unknown) => void) => void) {
  const listeners = new Map<string, Set<(event: MessageEvent) => void>>();
  const terminate = vi.fn();
  const worker: BrowserReportWorker = { terminate, addEventListener: (type, listener) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(listener as (event: MessageEvent) => void); }, removeEventListener: (type, listener) => { listeners.get(type)?.delete(listener as (event: MessageEvent) => void); }, postMessage: value => run(value as ReportWorkerRequest, data => { for (const listener of listeners.get("message") ?? []) listener({ data } as MessageEvent); }) };
  return { worker, terminate, listeners };
}

describe("自动编码执行策略", () => {
  it("真实计划计数而不相信stats，字体仅按长度且有界扫描", () => {
    expect(decideReportExport(input(), {}).reason).toBe("small-task");
    expect(decideReportExport(input(), { thresholds: { cells: 2 } })).toMatchObject({ mode: "worker", reason: "threshold", estimate: { cells: 2 } });
    const font = input(); font.pdf = { customFontBytes: new Uint8Array(2_000_000) };
    expect(decideReportExport(font, {}).estimate.bytes).toBe(2_000_000);
    const huge = input(); huge.prepared.plan.pages[0]!.components[0]!.grid!.cells = Array.from({ length: 100_001 }, () => []);
    expect(decideReportExport(huge, {}).reason).toBe("scan-limit");
    expect(() => decideReportExport(input(), { thresholds: { cells: 0 } })).toThrow("正安全整数");
    expect(() => createAutoReportExporter({ mode: "bad" as never })).toThrow("模式");
    expect(() => createAutoReportExporter({ fallback: "bad" as never })).toThrow("策略");
    expect(() => createAutoReportExporter({ timeoutMs: -1 })).toThrow("正有限");
  });
  it("小任务真实本地编码；无factory大任务可观察回退；显式worker缺factory拒绝", async () => {
    const observe = vi.fn(); const exporter = createAutoReportExporter({ onDecision: observe });
    const small = await exporter.exportPrepared(input());
    expect(small.bytes[0]).toBe(80); expect(small.stats.cells).toBe(2); expect(small.execution.reason).toBe("small-task");
    const local = vi.fn(async () => result());
    const large = await createAutoReportExporter({ thresholds: { cells: 1 } }).exportPrepared(input(), local);
    expect(large.execution).toMatchObject({ mode: "local", reason: "worker-unavailable", hardCancellation: false });
    expect(local).toHaveBeenCalledOnce(); expect(observe).toHaveBeenCalledOnce();
    await expect(createAutoReportExporter({ mode: "worker" }).exportPrepared(input(), local)).rejects.toMatchObject({ name: "ReportWorkerStartError" });
    await expect(createAutoReportExporter({ thresholds: { cells: 1 }, fallback: "error" }).exportPrepared(input())).rejects.toThrow("启动");
    exporter.dispose(); await expect(exporter.exportPrepared(input())).rejects.toMatchObject({ code: "closed" });
  });
  it("构造失败允许回退；编码失败绝不重跑；观察者异常不改变结果", async () => {
    const local = vi.fn(async () => result()); const decisions: string[] = [];
    await createAutoReportExporter({ thresholds: { cells: 1 }, workerFactory: () => { throw new Error("CSP"); }, onDecision: decision => { decisions.push(decision.reason); throw new Error("observer"); } }).exportPrepared(input(), local);
    expect(decisions).toEqual(["threshold", "worker-start-failed"]); expect(local).toHaveBeenCalledOnce();
    const failed = fakeWorker((request, emit) => emit({ protocol: REPORT_WORKER_PROTOCOL, id: request.id, error: { name: "Error", message: "encoding failed" } }));
    await expect(createAutoReportExporter({ mode: "worker", workerFactory: () => failed.worker }).exportPrepared(input(), local)).rejects.toThrow("encoding failed");
    expect(local).toHaveBeenCalledOnce(); expect(failed.terminate).toHaveBeenCalledOnce();
    expect([...failed.listeners.values()].every(value => value.size === 0)).toBe(true);
  });
  it("函数选项保留本地行为与明确决策；强制worker不静默丢选项", async () => {
    const request = input(); const sheetName = (index: number) => `page-${index}`; request.xlsx = { sheetName, maxImages: 1 };
    const local = vi.fn(async next => { expect(next.xlsx!.sheetName).toBe(sheetName); expect(next.xlsx!.maxImages).toBe(1); return result(); });
    const output = await createAutoReportExporter().exportPrepared(request, local);
    expect(output.execution.reason).toBe("nonserializable-options");
    await expect(createAutoReportExporter({ mode: "worker" }).exportPrepared(request, local)).rejects.toThrow("函数选项");
    expect(local).toHaveBeenCalledOnce();
    expect((await createAutoReportExporter({ mode: "local" }).exportPrepared(input(), async () => result())).execution.reason).toBe("explicit-local");
  });
  it("取消等待线程释放，旧响应不交付；字体转移只detach独立快照", async () => {
    let request!: ReportWorkerRequest; let emit!: (value: unknown) => void; let finish!: () => void;
    const terminated = new Promise<void>(resolve => { finish = resolve; });
    let transferred!: ArrayBuffer[];
    const executor = createReportWorkerExecutor(() => ({ subscribe: next => { emit = next; return () => {}; }, terminate: () => terminated, postMessage: (next, transfer) => { request = next; transferred = transfer!; structuredClone(next, { transfer }); } }));
    const exporter = createAutoExporterController({ mode: "worker" }, () => executor);
    const values = input(); const font = new Uint8Array([1, 2, 3]); values.pdf = { customFontBytes: font };
    let settled = false; const pending = exporter.exportPrepared(values).catch(error => { settled = true; throw error; });
    expect(font.byteLength).toBe(3); expect(transferred[0]!.byteLength).toBe(0);
    exporter.cancel(); await Promise.resolve(); expect(settled).toBe(false);
    finish(); await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    emit({ protocol: REPORT_WORKER_PROTOCOL, id: request.id, result: result() });
    expect(settled).toBe(true);
  });
  it("并发上界、预取消、timeout和输出budget拒绝都释放", async () => {
    const controller = new AbortController(); controller.abort(); const factory = vi.fn();
    await expect(createAutoReportExporter({ mode: "worker", workerFactory: factory }).exportPrepared({ ...input(), signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" }); expect(factory).not.toHaveBeenCalled();
    const idle = fakeWorker(() => {}); const exporter = createAutoReportExporter({ mode: "worker", workerFactory: () => idle.worker, timeoutMs: 20 });
    const first = exporter.exportPrepared(input()); const second = exporter.exportPrepared(input());
    const firstAssertion = expect(first).rejects.toMatchObject({ code: "timeout" }); const secondAssertion = expect(second).rejects.toMatchObject({ code: "timeout" });
    await expect(exporter.exportPrepared(input())).rejects.toMatchObject({ code: "queue-full" });
    await Promise.all([firstAssertion, secondAssertion]); expect(idle.terminate).toHaveBeenCalledTimes(2);
    await expect(createAutoReportExporter({ mode: "local", budget: { maxOutputBytes: 1 } }).exportPrepared(input(), async () => result())).rejects.toMatchObject({ code: "budget" });
  });
  it("内置worker只接受已准备输出并应用传入预算；scope可撤销", async () => {
    const base = { protocol: REPORT_WORKER_PROTOCOL, id: "one", operation: "exportPrepared" as const, input: input() };
    expect((await runReportEncodingRequest({ ...base, budget: { maxCells: 1 } })).error).toMatchObject({ code: "budget" });
    expect((await runReportEncodingRequest({ ...base, operation: "prepare", input: { reportIds: ["x"] } })).error?.message).toContain("仅接受");
    const scope = { addEventListener: vi.fn(), removeEventListener: vi.fn(), postMessage: vi.fn() } as unknown as ReportWorkerScope;
    const dispose = serveReportEncodingWorker(scope); dispose(); expect(scope.removeEventListener).toHaveBeenCalledOnce();
    const encoded = await runReportEncodingRequest(base); expect(encoded.result).toMatchObject({ format: "xlsx" });
  });
  it("preserve不绕过已声明font fingerprint；provided几何保留有明确诊断", () => {
    const value = { ...input(), format: "pdf" as const, layoutPolicy: "preserve" as const, fidelity: "strict" as const };
    value.prepared.layout = { textMetrics: "provided" }; checkPreparedFont(value);
    expect(value.prepared.diagnostics[0]!.code).toBe("prepared-layout-preserved");
    value.prepared.layout = { textMetrics: "font-bytes", fontFingerprint: "a".repeat(64) };
    expect(() => checkPreparedFont(value)).toThrow("字体度量");
    expect(() => checkPreparedFont({ ...value, layoutPolicy: "bad" as never })).toThrow("layoutPolicy");
  });
});
