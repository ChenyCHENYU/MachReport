// @vitest-environment node
import { afterAll, beforeAll, expect, it } from "vitest";
import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compileWorkerModules } from "./worker-fixture-tools";
import { createAutoExporterController } from "../worker/auto-core";
import { createReportWorkerExecutor } from "../worker/client";
import type { PreparedReport } from "../server/types";

let directory: string, filename: string;
beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), "mach-auto-zip-"));
  const modules = await compileWorkerModules(resolve(directory, "modules"), ["worker/index.ts", "xlsx/render-xlsx.ts"]);
  const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
  const url = (entry: string) => pathToFileURL(modules.get(resolve(sourceRoot, entry))!).href;
  await symlink(fileURLToPath(new URL("../../node_modules", import.meta.url)), resolve(directory, "node_modules"), "dir");
  filename = resolve(directory, "zip.mjs");
  const excelPath = createRequire(import.meta.url).resolve("exceljs");
  await writeFile(filename, `
    import { parentPort } from 'node:worker_threads';
    import ExcelJS from ${JSON.stringify(pathToFileURL(excelPath).href)};
    import { serveReportWorker } from ${JSON.stringify(url("worker/index.ts"))};
    import { renderPlanToXlsx } from ${JSON.stringify(url("xlsx/render-xlsx.ts"))};
    const descriptor = Object.getOwnPropertyDescriptor(ExcelJS.Workbook.prototype, 'xlsx');
    Object.defineProperty(ExcelJS.Workbook.prototype, 'xlsx', {...descriptor, get(){
      const xlsx = descriptor.get.call(this);
      if(!xlsx.observed){xlsx.observed=true; const write=xlsx.writeBuffer.bind(xlsx);
        xlsx.writeBuffer=(...args)=>{const pending=write(...args); parentPort.postMessage({qa:'zip-started'}); pending.then(()=>parentPort.postMessage({qa:'zip-completed'})); return pending;};}
      return xlsx;
    }});
    const runtime={exportPrepared: async ({prepared})=>{
      const encoded=await renderPlanToXlsx(prepared.plan);
      return {...prepared,plan:undefined,bytes:new Uint8Array(encoded.buffer),format:'xlsx',contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
    }};
    serveReportWorker(runtime,{addEventListener:(_type,listener)=>parentPort.on('message',data=>listener({data})),removeEventListener:()=>{},postMessage:(value,transfer)=>parentPort.postMessage(value,transfer)});
  `);
});
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
it("terminates a real Node thread during actual third-party final XLSX compression, awaiting release", async () => {
  let notify!: () => void; const started = new Promise<void>(resolve => { notify = resolve; });
  let zipCompleted = false; const workers: Worker[] = [];
  const exporter = createAutoExporterController({}, () => createReportWorkerExecutor(() => {
    const worker = new Worker(filename); workers.push(worker);
    worker.on("message", value => { if (value.qa === "zip-started") notify(); if (value.qa === "zip-completed") zipCompleted = true; });
    return { postMessage: (value, transfer) => worker.postMessage(value, transfer), terminate: () => worker.terminate(), subscribe: (message, error) => { worker.on("message", message); worker.on("error", error); return () => { worker.off("message", message); worker.off("error", error); }; } };
  }));
  const cells = Array.from({ length: 4000 }, (_, row) => Array.from({ length: 16 }, (_, column) => ({ text: `${row}-${column}-production-value`, value: row * 16 + column })));
  const prepared: PreparedReport = { plan: { schemaVersion: "mach-report/1", pages: [{ pageWidthMm: 200, pageHeightMm: 100, components: [{ kind: "text", leftMm: 0, topMm: 0, widthMm: 190, heightMm: 90, grid: { cells } }] }] }, stats: { rows: 4000, pages: 1, cells: 0, durationMs: 0 }, diagnostics: [], revisions: {} };
  const pending = exporter.exportPrepared({ prepared, format: "xlsx" });
  try {
    await started; await new Promise(resolve => setTimeout(resolve, 25)); expect(zipCompleted).toBe(false);
    const cancelledAt = Date.now(); exporter.cancel(); await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(Date.now() - cancelledAt).toBeLessThan(1000); expect(workers.every(worker => worker.threadId === -1)).toBe(true);
  } finally { exporter.dispose(); }
}, 15_000);
