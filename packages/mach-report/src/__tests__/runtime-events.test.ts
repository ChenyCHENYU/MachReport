// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createTemplate } from "../builder/template-builder";
import { createReportSource } from "../source/report-source";
import { notifyReportTaskEvent, type ReportTaskEvent } from "../source/task-events";
import type { PreparedReport, ReportRuntimeExecutor } from "../server/types";
import { createReportRuntime } from "../server/runtime";
import { createReportTaskQueue } from "../server/task-queue";
import { createReportWorkerExecutor } from "../worker/client";
import { REPORT_WORKER_PROTOCOL, validReportWorkerEvent, type ReportWorkerRequest } from "../worker/protocol";

const template = createTemplate().page(100, 80).list("rows", { leftMm: 0, topMm: 0, widthMm: 80 }, [{ field: "id", header: "ID", widthMm: 80 }]).build();
const reports = { sample: { template, datasets: { rows: [{ id: "0001" }] } } };

describe("真实阶段观测与隔离", () => {
  it("取数、校验、排版和编码有真实边界，同一任务/关联ID贯穿全部事件", async () => {
    const events: ReportTaskEvent[] = [];
    const result = await createReportRuntime({ reports }).export({ reportIds: ["sample"], format: "xlsx", taskId: "job-1", correlationId: "trace-1", onEvent: (event) => events.push(event) });
    expect(result.bytes.slice(0, 2)).toEqual(new Uint8Array([0x50, 0x4b]));
    expect(events.every((event) => event.taskId === "job-1" && event.correlationId === "trace-1")).toBe(true);
    for (const stage of ["query", "layout", "encode"]) expect(events.filter((event) => event.stage === stage && event.completed === undefined).map((event) => event.status)).toEqual(["started", "completed"]);
    expect(events.filter((event) => event.reportId === "sample").map((event) => `${event.stage}:${event.status}`)).toEqual(["validate:started", "validate:completed", "query:started", "query:completed", "validate:started", "validate:completed", "layout:started", "layout:completed"]);
    expect(events.at(-1)).toMatchObject({ stage: "encode", status: "completed" });
  });
  it("观察器不能修改已保存事件；意外async回调拒绝也不会泄漏未处理异常", async () => {
    const event: ReportTaskEvent = { taskId: "immutable", stage: "query", status: "started" };
    notifyReportTaskEvent((value) => { value.taskId = "changed"; }, event);
    expect(event.taskId).toBe("immutable");
    notifyReportTaskEvent(async () => { throw new Error("async observer unavailable"); }, event);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  it("Runtime严格保真拒绝已知缺失内容，encode失败事件保留精确诊断", async () => {
    const image = createTemplate().page(100, 80).build();
    image.pages[0]!.components.push({ kind: "image", leftMm: 0, topMm: 0, widthMm: 10, heightMm: 10 });
    const runtime = createReportRuntime({ reports: { sample: { template: image } } });
    const events: ReportTaskEvent[] = [];
    await expect(runtime.export({ reportIds: ["sample"], format: "xlsx", fidelity: "strict", onEvent: (event) => events.push(event) })).rejects.toMatchObject({ code: "output-fidelity", diagnostics: [expect.objectContaining({ code: "missing-image", pageIndex: 0, componentIndex: 0 })] });
    expect(events.at(-1)).toMatchObject({ stage: "encode", status: "failed" });
    const warned = await runtime.export({ reportIds: ["sample"], format: "xlsx" });
    expect(warned.diagnostics).toContainEqual(expect.objectContaining({ code: "missing-image" }));
  });
  it("取数与字段校验失败报告对应阶段；观测异常不影响任务成功或原始错误", async () => {
    const events: ReportTaskEvent[] = [];
    const onEvent = (event: ReportTaskEvent) => { events.push(event); throw new Error("observer unavailable"); };
    const source = createReportSource({ sample: { template, load: () => { throw new Error("provider unavailable"); } } });
    await expect(source({ reportIds: ["sample"], params: {}, onEvent })).rejects.toThrow("provider unavailable");
    expect(events.at(-1)).toMatchObject({ stage: "query", status: "failed" });
    await expect(createReportSource(reports)({ reportIds: ["sample"], params: {}, onEvent })).resolves.toHaveProperty("pages");
    const bad = createReportSource({ sample: { template, datasets: { rows: [{ id: null }] }, dataSchema: { rows: { fields: [{ field: "id", type: "text", required: true }] } } } });
    await expect(bad({ reportIds: ["sample"], params: {}, onEvent })).rejects.toMatchObject({ code: "validate" });
    expect(events.at(-1)).toMatchObject({ stage: "validate", status: "failed" });
  });
  it("取消后忽略迟到取数及所有通知，避免覆盖下一次任务状态", async () => {
    let release!: (value: typeof reports.sample.datasets) => void;
    const events: ReportTaskEvent[] = [];
    const source = createReportSource({ sample: { template, load: () => new Promise<typeof reports.sample.datasets>((resolve) => { release = resolve; }) } });
    const controller = new AbortController();
    const pending = source({ reportIds: ["sample"], params: {}, signal: controller.signal, onEvent: (event) => events.push(event) });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    const count = events.length;
    release(reports.sample.datasets); await Promise.resolve(); await Promise.resolve();
    expect(events).toHaveLength(count);
    expect(events.at(-1)).toMatchObject({ stage: "query", status: "started" });
  });
  it("自定义executor忽略signal时也无法在超时后污染任务，观察器异常不进入执行器", async () => {
    const prepared = await createReportRuntime({ reports }).prepare({ reportIds: ["sample"] });
    let late!: () => void;
    const executor: ReportRuntimeExecutor = {
      prepare: (_input, _signal, onEvent) => new Promise<PreparedReport>((resolve) => { late = () => { onEvent?.({ taskId: "custom", stage: "query", status: "completed" }); resolve(prepared); }; }),
      export: async () => { throw new Error("unused"); }
    };
    const events: ReportTaskEvent[] = [];
    const pending = createReportRuntime({ reports, executor, budget: { maxDurationMs: 5 } }).prepare({ reportIds: ["sample"], onEvent: (event) => { events.push(event); throw new Error("observer"); } });
    await expect(pending).rejects.toMatchObject({ code: "timeout" });
    const count = events.length; late(); await Promise.resolve();
    expect(events).toHaveLength(count);
  });
  it("Worker函数不跨线程，通知帧校验身份、阶段及计数，取消后不调用observer", async () => {
    let message!: (value: unknown) => void;
    let request!: ReportWorkerRequest;
    const terminate = vi.fn();
    const observer = vi.fn();
    const executor = createReportWorkerExecutor(() => ({ terminate, subscribe: (next) => { message = next; return () => {}; }, postMessage: (value) => { request = structuredClone(value); } }));
    const controller = new AbortController();
    const pending = executor.prepare({ reportIds: ["sample"], taskId: "job-2" }, controller.signal, observer);
    const event = { taskId: "job-2", stage: "query", status: "started", reportId: "sample" };
    const frame = { protocol: REPORT_WORKER_PROTOCOL, id: request.id, type: "event", event };
    message(frame); expect(observer).toHaveBeenCalledWith(event);
    expect(request.input).not.toHaveProperty("onEvent");
    controller.abort(); await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    message(frame); expect(observer).toHaveBeenCalledOnce(); expect(terminate).toHaveBeenCalledOnce();
    for (const malformed of [{ ...event, taskId: "other" }, { ...event, stage: "anything" }, { ...event, completed: NaN }, { ...event, completed: 2, total: 1 }, { ...event, reportId: "other" }]) expect(validReportWorkerEvent(malformed, request.input)).toBe(false);
  });
  it("匹配任务的恶意通知帧明确拒绝并终止线程", async () => {
    const terminate = vi.fn();
    let message!: (value: unknown) => void;
    const executor = createReportWorkerExecutor(() => ({ terminate, subscribe: (next) => { message = next; return () => {}; }, postMessage: (request) => message({ protocol: REPORT_WORKER_PROTOCOL, id: request.id, type: "event", event: { taskId: "wrong", stage: "query", status: "started" } }) }));
    await expect(executor.prepare({ reportIds: ["sample"], taskId: "expected" })).rejects.toThrow("无效阶段事件");
    expect(terminate).toHaveBeenCalledOnce();
  });
  it("队列承接Runtime阶段与进度，终态后不接收迟到更新", async () => {
    const queue = createReportTaskQueue({ concurrency: 2, maxQueued: 40 });
    const runtime = createReportRuntime({ reports });
    const events: ReportTaskEvent[] = [];
    const task = queue.enqueue(({ taskId, signal, onEvent }) => runtime.prepare({ reportIds: ["sample"], taskId, signal, onEvent }), { id: "queued-job", onEvent: (event) => { events.push(event); throw new Error("observer"); } });
    await task.result;
    expect(events.length).toBeGreaterThan(0);
    expect(task.event).toMatchObject({ taskId: "queued-job", stage: "validate", status: "completed" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queue.active).toBe(0); expect(queue.pending).toBe(0);
    queue.close();
  });
  it("反复并发与取消后队列槽位归零，未执行取消任务不会泄漏ID或回调", async () => {
    const queue = createReportTaskQueue({ concurrency: 3, maxQueued: 100 });
    let peak = 0; let active = 0;
    const tasks = Array.from({ length: 60 }, (_, index) => queue.enqueue(async ({ signal, reportProgress }) => {
      active++; peak = Math.max(peak, active);
      try { await new Promise((resolve) => setTimeout(resolve, 1)); if (signal.aborted) return -1; reportProgress(1, 1); return index; }
      finally { active--; }
    }, { id: `stress-${index}` }));
    const all = Promise.allSettled(tasks.map((task) => task.result));
    tasks.forEach((task, index) => { if (index % 4 === 0) task.cancel(); });
    await all; await new Promise((resolve) => setTimeout(resolve, 0));
    expect(peak).toBeLessThanOrEqual(3); expect(active).toBe(0); expect(queue.active).toBe(0); expect(queue.pending).toBe(0);
    expect(await queue.enqueue(() => "reused", { id: "stress-0" }).result).toBe("reused");
    queue.close();
  });
});
