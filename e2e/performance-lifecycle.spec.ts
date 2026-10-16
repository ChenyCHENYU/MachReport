import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import type { MachReportHandle } from "../packages/mach-report/src/vue/controller";
import type { App } from "vue";

type PerfWindow = Window & { __reportPerf?: { app: App; report: MachReportHandle; nextTick(): Promise<void> } };

test("4倍CPU限速：重复宽表查询首屏P95、搜索延迟及卸载后堆回落", async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "CPU throttling and explicit heap collection require Chromium CDP");
  test.setTimeout(90000);
  await page.goto("http://localhost:8610"); await expect(page.getByText("产品出库单")).toBeVisible();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const coreUrl = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/index.ts", import.meta.url))}`;
  await page.evaluate(async (coreUrl) => {
    const source = await fetch("/src/main.ts").then((response) => response.text());
    const vueUrl = source.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)?.[1];
    const reportUrl = source.match(/from ["']([^"']*mach-report\/src\/vue\/index\.ts[^"']*)["']/)?.[1];
    if (!vueUrl || !reportUrl) throw new Error("Missing fixture module URLs");
    const { createApp, h, nextTick } = await import(vueUrl) as typeof import("vue");
    const { ReportPreview, useMachReport } = await import(reportUrl) as typeof import("../packages/mach-report/src/vue/index");
    const { createTableTemplate, paginateTemplate } = await import(coreUrl) as typeof import("../packages/mach-report/src/index");
    const template = createTableTemplate({ layout: "wide", title: "性能验收", columns: Array.from({ length: 48 }, (_, index) => ({ field: `c${index}`, header: `指标${index}`, widthMm: 24 })) });
    const rows = Array.from({ length: 300 }, (_, row) => Object.fromEntries(Array.from({ length: 48 }, (_, column) => [`c${column}`, row === 299 && column === 47 ? "目标末行" : `${row}:${column}`])));
    const target = document.createElement("div"); target.id = "perf-lifecycle"; target.style.cssText = "position:fixed;inset:0;z-index:9999"; document.body.append(target);
    const report = useMachReport();
    const app = createApp({ render: () => h(ReportPreview, { ref: report.ref, reportId: "perf", height: "100vh", showExport: false, showPdfWindow: false, showPrint: false, fetcher: async () => paginateTemplate(template, { detail: rows }).plan }) });
    (window as PerfWindow).__reportPerf = { app, report, nextTick }; app.mount(target);
  }, coreUrl);
  const root = page.locator("#perf-lifecycle"); await expect(root.locator("td").first()).toBeVisible();
  await cdp.send("HeapProfiler.collectGarbage");
  const before = await cdp.send("Runtime.getHeapUsage");
  const samples: number[] = [];
  for (let index = 0; index < 12; index++) {
    samples.push(await page.evaluate(async () => {
      const fixture = (window as PerfWindow).__reportPerf!; const started = performance.now();
      await fixture.report.reload(); await fixture.nextTick();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return performance.now() - started;
    }));
    expect(await root.locator(".mrp-page-holder").count()).toBeLessThanOrEqual(4);
  }
  const sorted = [...samples].sort((a, b) => a - b); const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]!;
  expect(p95).toBeLessThan(3000);
  await root.getByRole("button", { name: "内容搜索", exact: true }).click();
  const searchStarted = Date.now(); await root.locator(".mrp-search-input").fill("目标末行"); await expect(root.locator("mark.mrp-hit")).toHaveText("目标末行");
  const searchMs = Date.now() - searchStarted; expect(searchMs).toBeLessThan(3000);
  await page.evaluate(() => { (window as PerfWindow).__reportPerf!.app.unmount(); delete (window as PerfWindow).__reportPerf; document.querySelector("#perf-lifecycle")?.remove(); });
  await cdp.send("HeapProfiler.collectGarbage"); const after = await cdp.send("Runtime.getHeapUsage");
  const retainedBytes = after.usedSize - before.usedSize; expect(retainedBytes).toBeLessThan(16 * 1024 * 1024);
  const metrics = { cpuThrottle: 4, rows: 300, columns: 48, repetitions: samples.length, samplesMs: samples, p95Ms: p95, searchMs, retainedBytesAfterExplicitGC: retainedBytes };
  await testInfo.attach("performance-lifecycle.json", { body: JSON.stringify(metrics, null, 2), contentType: "application/json" });
  console.log(`[perf] lifecycle ${JSON.stringify(metrics)}`);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 }); await cdp.detach();
});
