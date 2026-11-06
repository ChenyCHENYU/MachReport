import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const ExcelJSRuntime = createRequire(new URL("../packages/mach-report/package.json", import.meta.url))("exceljs") as { Workbook: new () => Awaited<ReturnType<typeof import("../packages/mach-report/src/xlsx/render-xlsx")["renderPlanToXlsx"]>>["workbook"] };
const clientUrl = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/worker.ts", import.meta.url))}`;
const workerUrl = `/@fs${fileURLToPath(new URL("./fixtures/encoding.worker.ts", import.meta.url))}`;
const entryUrl = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/worker/encoding-entry.ts", import.meta.url))}`;

test("additional worksheets trigger automatic isolation and preserve invocation snapshots through real XLSX encoding", async ({ page }, testInfo) => {
  await page.goto("http://localhost:8610");
  const result = await page.evaluate(async ({ clientUrl, entryUrl }) => {
    const { createAutoReportExporter } = await import(/* @vite-ignore */ clientUrl) as typeof import("../packages/mach-report/src/worker");
    const component = { kind: "text" as const, leftMm: 0, topMm: 0, widthMm: 90, heightMm: 10, text: "Original report" };
    const rows = Array.from({ length: 25_000 }, (_, index) => [`coil-${String(index).padStart(5, "0")}`, index]);
    const progress: [number, number][] = [];
    const exporter = createAutoReportExporter({ workerFactory: () => new Worker(entryUrl, { type: "module" }), onDecision: () => { component.text = "Observer mutation"; rows[0]![0] = "Observer mutation"; } });
    const started = performance.now();
    const pending = exporter.exportPrepared({ format: "xlsx", prepared: { plan: { schemaVersion: "mach-report/1", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [component] }] }, stats: { rows: 0, pages: 1, cells: 0, durationMs: 0 }, diagnostics: [], revisions: {} }, xlsx: { additionalSheets: [{ name: "Source data", rows }] }, onEvent: event => { if (event.stage === "encode" && event.completed !== undefined) progress.push([event.completed, event.total!]); } });
    const synchronousCaptureMs = performance.now() - started;
    component.text = "After invocation"; rows[0]![0] = "After invocation";
    let frames = 0, done = false;
    const frame = () => { if (!done) { frames++; requestAnimationFrame(frame); } };
    requestAnimationFrame(frame);
    try {
      const output = await pending;
      return { bytes: Array.from(output.bytes), execution: output.execution, progress, frames, synchronousCaptureMs };
    } finally { done = true; exporter.dispose(); }
  }, { clientUrl, entryUrl });
  expect(result.execution).toMatchObject({ mode: "worker", reason: "threshold", estimate: { cells: 20_000 } });
  expect(result.frames).toBeGreaterThan(0);
  expect(result.progress).toEqual([[1, 3], [2, 3], [3, 3]]);
  const workbook = new ExcelJSRuntime.Workbook(); await workbook.xlsx.load(Buffer.from(result.bytes));
  expect(workbook.worksheets[0]!.getCell("A1").value).toBe("Original report");
  expect(workbook.getWorksheet("Source data")!.getCell("A1").value).toBe("coil-00000");
  expect(workbook.getWorksheet("Source data")!.getCell("B1").value).toBe(0);
  expect(workbook.getWorksheet("Source data")!.getCell("B25000").value).toBe(24_999);
  await testInfo.attach("additional-worksheet-export.json", { body: JSON.stringify({ ...result, bytes: result.bytes.length }, null, 2), contentType: "application/json" });
});

test("automatic worker keeps final real XLSX ZIP compression off main thread and hard-cancels it", async ({ page, browserName }, testInfo) => {
  const cdp = browserName === "chromium" ? await page.context().newCDPSession(page) : undefined;
  await cdp?.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.goto("http://localhost:8610");
  const result = await page.evaluate(async ({ clientUrl, workerUrl, entryUrl }) => {
    const { createAutoReportExporter } = await import(/* @vite-ignore */ clientUrl) as typeof import("../packages/mach-report/src/worker");
    let started!: () => void; const compressing = new Promise<void>(resolve => { started = resolve; });
    let zipCompleted = false, terminated = 0;
    const exporter = createAutoReportExporter({ workerFactory: () => {
      const worker = new Worker(workerUrl, { type: "module" });
      const stop = worker.terminate.bind(worker); worker.terminate = () => { terminated++; stop(); };
      worker.addEventListener("message", event => { if (event.data?.qa === "zip-started") started(); if (event.data?.qa === "zip-completed") zipCompleted = true; });
      return worker;
    } });
    const cells = Array.from({ length: 4000 }, (_, row) => Array.from({ length: 16 }, (_, column) => ({ text: `${row}-${column}-production-value`, value: row * 16 + column })));
    const prepared = { plan: { schemaVersion: "mach-report/1", pages: [{ pageWidthMm: 200, pageHeightMm: 100, components: [{ kind: "text" as const, leftMm: 0, topMm: 0, widthMm: 190, heightMm: 90, grid: { cells } }] }] }, stats: { rows: 4000, pages: 1, cells: 0, durationMs: 0 }, diagnostics: [], revisions: {} };
    const controller = new AbortController();
    const captureStarted = performance.now();
    const pending = exporter.exportPrepared({ prepared, format: "xlsx", signal: controller.signal });
    const synchronousCaptureMs = performance.now() - captureStarted;
    await Promise.race([compressing, pending.then(() => { throw new Error("XLSX completed without compression probe"); })]);
    let frames = 0; const until = performance.now() + 50;
    while (performance.now() < until) { await new Promise(requestAnimationFrame); frames++; }
    const completedBeforeCancel = zipCompleted; const cancelledAt = performance.now(); controller.abort();
    let cancelled = ""; try { await pending; } catch (error) { cancelled = (error as Error).name; }
    const cancellationMs = performance.now() - cancelledAt; exporter.dispose();
    const packaged = createAutoReportExporter({ mode: "worker", workerFactory: () => new Worker(entryUrl, { type: "module" }) });
    prepared.plan.pages[0]!.components[0]!.grid!.cells = [[{ text: "A", value: 0 }]];
    const next = await packaged.exportPrepared({ prepared, format: "xlsx" }); packaged.dispose();
    return { frames, synchronousCaptureMs, completedBeforeCancel, cancelled, cancellationMs, terminated, next: next.bytes[0], mode: next.execution.mode };
  }, { clientUrl, workerUrl, entryUrl });
  expect(result.completedBeforeCancel).toBe(false);
  expect(result.frames).toBeGreaterThan(1);
  expect(result.cancelled).toBe("AbortError");
  expect(result.cancellationMs).toBeLessThan(1000);
  expect(result.terminated).toBe(1);
  expect(result.next).toBe(80); expect(result.mode).toBe("worker");
  await testInfo.attach("worker-export-responsiveness.json", { body: JSON.stringify({ cpuThrottle: cdp ? 4 : 1, cells: 64_000, ...result }, null, 2), contentType: "application/json" });
  await cdp?.send("Emulation.setCPUThrottlingRate", { rate: 1 }); await cdp?.detach();
});
