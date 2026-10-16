import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

const clientUrl = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/worker.ts", import.meta.url))}`;
const workerUrl = `/@fs${fileURLToPath(new URL("./fixtures/runtime.worker.ts", import.meta.url))}`;

test("native browser Worker reuses runtime and cancels busy CPU work while main thread stays responsive", async ({ page }) => {
  await page.goto("http://localhost:8610");
  const result = await page.evaluate(async ({ clientUrl, workerUrl }) => {
    const { createBrowserReportExecutor } = await import(/* @vite-ignore */ clientUrl) as typeof import("../packages/mach-report/src/worker");
    let terminated = 0;
    let notifyStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    const executor = createBrowserReportExecutor(() => {
      const worker = new Worker(workerUrl, { type: "module" });
      const terminate = worker.terminate.bind(worker);
      worker.terminate = () => { terminated++; terminate(); };
      worker.addEventListener("message", (event) => { if (event.data?.qa === "cpu-started") notifyStarted(); });
      return worker;
    }, { timeoutMs: 10_000 });
    const prepared = await executor.prepare({ reportIds: ["sales"], params: { plant: "A" } });
    let error: { code?: string; issues?: unknown } = {};
    try { await executor.prepare({ reportIds: ["sales"] }); } catch (reason) { error = reason as typeof error; }
    const controller = new AbortController();
    const pending = executor.prepare({ reportIds: ["sales"], params: { plant: "A", mode: "cpu" } }, controller.signal);
    await started;
    let frames = 0;
    const until = performance.now() + 80;
    while (performance.now() < until) { await new Promise(requestAnimationFrame); frames++; }
    const cancelledAt = performance.now(); controller.abort("stop CPU");
    let cancelled = "";
    try { await pending; } catch (reason) { cancelled = (reason as Error).name; }
    return { stats: prepared.stats, revisions: prepared.revisions, error: { code: error.code, issues: error.issues }, frames, cancelled, cancellationMs: performance.now() - cancelledAt, terminated };
  }, { clientUrl, workerUrl });
  expect(result.stats.rows).toBe(1);
  expect(result.revisions.sales?.revision).toBe("browser-r1");
  expect(result.error).toMatchObject({ code: "params", issues: [expect.objectContaining({ code: "required", field: "plant" })] });
  expect(result.frames).toBeGreaterThan(1);
  expect(result.cancelled).toBe("AbortError");
  expect(result.cancellationMs).toBeLessThan(1000);
  expect(result.terminated).toBe(3);
});
