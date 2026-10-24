import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
const clientUrl = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/worker.ts", import.meta.url))}`;
const workerUrl = `/@fs${fileURLToPath(new URL("./fixtures/encoding.worker.ts", import.meta.url))}`;
const entryUrl = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/worker/encoding-entry.ts", import.meta.url))}`;

test("automatic worker keeps final real XLSX ZIP compression off main thread and hard-cancels it", async ({ page }) => {
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
    const pending = exporter.exportPrepared({ prepared, format: "xlsx", signal: controller.signal });
    await Promise.race([compressing, pending.then(() => { throw new Error("XLSX completed without compression probe"); })]);
    let frames = 0; const until = performance.now() + 50;
    while (performance.now() < until) { await new Promise(requestAnimationFrame); frames++; }
    const completedBeforeCancel = zipCompleted; const cancelledAt = performance.now(); controller.abort();
    let cancelled = ""; try { await pending; } catch (error) { cancelled = (error as Error).name; }
    const cancellationMs = performance.now() - cancelledAt; exporter.dispose();
    const packaged = createAutoReportExporter({ mode: "worker", workerFactory: () => new Worker(entryUrl, { type: "module" }) });
    prepared.plan.pages[0]!.components[0]!.grid!.cells = [[{ text: "A", value: 0 }]];
    const next = await packaged.exportPrepared({ prepared, format: "xlsx" }); packaged.dispose();
    return { frames, completedBeforeCancel, cancelled, cancellationMs, terminated, next: next.bytes[0], mode: next.execution.mode };
  }, { clientUrl, workerUrl, entryUrl });
  expect(result.completedBeforeCancel).toBe(false);
  expect(result.frames).toBeGreaterThan(1);
  expect(result.cancelled).toBe("AbortError");
  expect(result.cancellationMs).toBeLessThan(1000);
  expect(result.terminated).toBe(1);
  expect(result.next).toBe(80); expect(result.mode).toBe("worker");
});
