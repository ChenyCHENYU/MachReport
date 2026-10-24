// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Worker } from "node:worker_threads";
import { createReportWorkerExecutor } from "../worker/client";
import { createReportTaskQueue } from "../server/task-queue";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compileWorkerModules } from "./worker-fixture-tools";
import type { ReportTaskEvent } from "../source/task-events";
import { createNodeReportExecutor, serveNodeReportWorker } from "../server/node";

let directory: string;
let filename: string;
const sourceRoot = fileURLToPath(new URL("../", import.meta.url));


beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), "mach-report-worker-"));
  const entries = ["server/node.ts", "server/runtime.ts", "builder/template-builder.ts"];
  const modules = await compileWorkerModules(resolve(directory, "modules"), entries);
  const url = (path: string) => pathToFileURL(modules.get(resolve(sourceRoot, path))!).href;
  filename = resolve(directory, "worker.mjs");
  await writeFile(filename, `
    import { parentPort, workerData } from 'node:worker_threads';
    import { writeFileSync } from 'node:fs';
    import { serveNodeReportWorker } from ${JSON.stringify(url(entries[0]!))};
    import { createReportRuntime } from ${JSON.stringify(url(entries[1]!))};
    import { createTemplate } from ${JSON.stringify(url(entries[2]!))};
    const template = createTemplate().params([{field:'plant',required:true}]).page(100,80)
      .list('rows',{leftMm:0,topMm:10,widthMm:80},[{field:'id',header:'ID',widthMm:80}]).build();
    const runtime = createReportRuntime({reports:{sales:{template,provider:{query:({params})=>{
      if(params.mode==='cpu'){writeFileSync(workerData.marker,'started'); const until=Date.now()+10000; while(Date.now()<until){} }
      return {datasets:{rows:[{id:params.plant}]},revision:'worker-r1'};
    }}}}});
    parentPort.postMessage({protocol:'mach-report-worker/1',id:'stale',result:{wrong:true}});
    serveNodeReportWorker(runtime);
  `);
});
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

describe("真实 Node Worker 适配器", () => {
  it("真实线程运行同一 runtime，隔离过期消息，并序列化参数错误", async () => {
    const executor = createNodeReportExecutor({ filename });
    const events: ReportTaskEvent[] = [];
    const result = await executor.prepare({ reportIds: ["sales"], params: { plant: "A" }, taskId: "real-worker", correlationId: "trace" }, undefined, (event) => events.push(event));
    expect(events.some((event) => event.stage === "query" && event.status === "completed")).toBe(true);
    expect(events.every((event) => event.taskId === "real-worker" && event.correlationId === "trace")).toBe(true);
    expect(result).toMatchObject({ stats: { rows: 1, cells: 2 }, revisions: { sales: { revision: "worker-r1" } } });
    expect(result.plan.pages[0]?.components.some((component) => component.grid?.cells[0]?.[0]?.text === "A")).toBe(true);
    await expect(executor.prepare({ reportIds: ["sales"] })).rejects.toMatchObject({ name: "ReportParamValidationError", code: "params", issues: [expect.objectContaining({ code: "required", field: "plant" })] });
    expect(() => serveNodeReportWorker({} as never)).toThrow("worker_threads");
  });
  it("CPU 密集同步取数开始后仍可硬取消，Promise 完成前线程已终止", async () => {
    const marker = resolve(directory, "running");
    const executor = createNodeReportExecutor({ workerUrl: pathToFileURL(filename), workerOptions: { workerData: { marker } } });
    const controller = new AbortController();
    const pending = executor.prepare({ reportIds: ["sales"], params: { plant: "A", mode: "cpu" } }, controller.signal);
    const deadline = Date.now() + 3000;
    while (!existsSync(marker) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(existsSync(marker)).toBe(true);
    const cancelled = Date.now(); controller.abort("cancel CPU");
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(Date.now() - cancelled).toBeLessThan(1000);
    expect((await executor.prepare({ reportIds: ["sales"], params: { plant: "B" } })).stats.rows).toBe(1);
  });
  it("多轮并发运行后所有真实线程已终止，队列资源归零且下一批仍能正常执行", async () => {
    const workers: Worker[] = [];
    const executor = createReportWorkerExecutor(() => {
      const worker = new Worker(filename); workers.push(worker);
      return {
        postMessage: (request) => worker.postMessage(request), terminate: () => worker.terminate(),
        subscribe: (message, error) => {
          worker.on("message", message); worker.on("error", error);
          return () => { worker.off("message", message); worker.off("error", error); };
        }
      };
    });
    const queue = createReportTaskQueue({ concurrency: 2, maxQueued: 4 });
    for (let batch = 0; batch < 3; batch++) {
      const tasks = Array.from({ length: 3 }, () => queue.enqueue(({ signal, taskId, onEvent }) => executor.prepare({ reportIds: ["sales"], params: { plant: "A" }, taskId }, signal, onEvent)));
      const results = await Promise.all(tasks.map((task) => task.result));
      expect(results.every((result) => result.stats.rows === 1)).toBe(true);
      expect(workers.every((worker) => worker.threadId === -1)).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(queue.active).toBe(0); expect(queue.pending).toBe(0);
    }
    expect(workers).toHaveLength(9); queue.close();
  });
  it("未返回结果的 worker 超时或提前退出均拒绝并终止", async () => {
    const stalled = resolve(directory, "stalled.mjs");
    await writeFile(stalled, "setInterval(()=>{},1000)");
    await expect(createNodeReportExecutor({ filename: stalled, timeoutMs: 50 }).prepare({ reportIds: ["sales"] })).rejects.toMatchObject({ code: "timeout" });
    const exited = resolve(directory, "exited.mjs"); await writeFile(exited, "process.exit(0)");
    await expect(createNodeReportExecutor({ filename: exited }).prepare({ reportIds: ["sales"] })).rejects.toThrow("响应前退出");
  });
});
