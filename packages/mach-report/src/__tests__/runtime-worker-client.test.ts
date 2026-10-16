// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createReportWorkerExecutor, type ReportWorkerConnection } from "../worker/client";
import { REPORT_WORKER_PROTOCOL, runReportWorkerRequest, type ReportWorkerRequest } from "../worker/protocol";
import type { ReportRuntime } from "../server/types";

describe("共享 Worker RPC 生命周期", () => {
  it("隔离不匹配消息，清理监听并等待 terminate 完成后才交付结果", async () => {
    let message!: (value: unknown) => void;
    let request!: ReportWorkerRequest;
    let stop!: () => void;
    const stopped = new Promise<void>((resolve) => { stop = resolve; });
    const unsubscribe = vi.fn();
    const connection: ReportWorkerConnection = { postMessage: (input) => { request = input; }, terminate: () => stopped, subscribe: (onMessage) => { message = onMessage; return unsubscribe; } };
    const executor = createReportWorkerExecutor(() => connection);
    let completed = false;
    const pending = executor.prepare({ reportIds: ["a"] }).then((value) => { completed = true; return value; });
    message({ protocol: REPORT_WORKER_PROTOCOL, id: "old", result: { wrong: true } });
    expect(unsubscribe).not.toHaveBeenCalled();
    message({ protocol: REPORT_WORKER_PROTOCOL, id: request.id, result: {
      plan: { schemaVersion: "test", pages: [{ pageWidthMm: 100, pageHeightMm: 80, components: [] }] },
      stats: { rows: 1, pages: 1, cells: 0, durationMs: 1 }, diagnostics: [], revisions: {}
    } });
    await Promise.resolve(); expect(completed).toBe(false);
    expect(unsubscribe).toHaveBeenCalledOnce();
    stop(); expect(await pending).toMatchObject({ stats: { rows: 1 } });
    message({ protocol: REPORT_WORKER_PROTOCOL, id: request.id, error: { name: "Error", message: "late" } });
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it("预取消不创建线程；同步发送失败也执行 terminate；同步subscribe错误不会泄漏监听", async () => {
    const controller = new AbortController(); controller.abort();
    const factory = vi.fn();
    await expect(createReportWorkerExecutor(factory).prepare({ reportIds: ["a"] }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(factory).not.toHaveBeenCalled();
    const terminate = vi.fn(); const unsubscribe = vi.fn();
    await expect(createReportWorkerExecutor(() => ({ postMessage: () => { throw new Error("serialize"); }, terminate, subscribe: () => unsubscribe })).prepare({ reportIds: ["a"] })).rejects.toThrow("serialize");
    expect(terminate).toHaveBeenCalledOnce(); expect(unsubscribe).toHaveBeenCalledOnce();
    const onSubscribe = vi.fn();
    await expect(createReportWorkerExecutor(() => ({ postMessage: vi.fn(), terminate, subscribe: (_message, error) => { error(new Error("startup")); return onSubscribe; } })).prepare({ reportIds: ["a"] })).rejects.toThrow("startup");
    expect(onSubscribe).toHaveBeenCalledOnce();
  });
  it("远端异常仅序列化明确的错误字段，循环issues也不会造成二次异常", async () => {
    const issue: Record<string, unknown> = { code: "invalid", path: "$.params.date", message: "bad date" }; issue.self = issue;
    const error = Object.assign(new Error("bad input"), { code: "params", issues: [issue], secret: "not serialized" });
    const runtime = { prepare: () => { throw error; } } as unknown as ReportRuntime;
    const result = await runReportWorkerRequest(runtime, { protocol: REPORT_WORKER_PROTOCOL, id: "job", operation: "prepare", input: { reportIds: ["a"] } });
    expect(result.error).toEqual({ name: "Error", message: "bad input", code: "params", issues: [{ code: "invalid", path: "$.params.date", message: "bad date" }] });
    expect(() => JSON.stringify(result)).not.toThrow();
  });
  it("严格输出的诊断位置可跨RPC返回，剔除宿主私有字段", async () => {
    const error = Object.assign(new Error("fidelity"), { code: "output-fidelity", diagnostics: [{ code: "missing-image", format: "pdf", severity: "warning", pageIndex: 2, componentIndex: 3, componentPath: [0, 1, 0], kind: "image", message: "missing", secret: "private" }] });
    const runtime = { export: () => { throw error; } } as unknown as ReportRuntime;
    const response = await runReportWorkerRequest(runtime, { protocol: REPORT_WORKER_PROTOCOL, id: "strict", operation: "export", input: { reportIds: ["a"], format: "pdf", fidelity: "strict" } });
    expect(response.error).toMatchObject({ code: "output-fidelity", diagnostics: [{ code: "missing-image", pageIndex: 2, componentIndex: 3, componentPath: [0, 1, 0] }] });
    expect(JSON.stringify(response)).not.toContain("private");
  });
  it("匹配任务ID但响应契约错误时明确拒绝并清理线程", async () => {
    let message!: (value: unknown) => void;
    const terminate = vi.fn();
    const executor = createReportWorkerExecutor(() => ({ terminate, subscribe: (onMessage) => { message = onMessage; return () => {}; }, postMessage: (request) => {
      message({ protocol: REPORT_WORKER_PROTOCOL, id: request.id, result: { plan: { pages: [] }, stats: { rows: NaN } } });
    } }));
    await expect(executor.prepare({ reportIds: ["a"] })).rejects.toThrow("无效响应");
    expect(terminate).toHaveBeenCalledOnce();
    expect(() => createReportWorkerExecutor(() => ({} as never), { timeoutMs: 2_147_483_648 })).toThrow("2147483647");
  });
});
