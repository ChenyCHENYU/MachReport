import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import type { MachReportHandle } from "../packages/mach-report/src/vue/controller";

type FixtureWindow = Window & { __frozenWindow?: { report: MachReportHandle; original: string } };

test("82列×2000行推荐数据源在4倍CPU下冻结、搜索、编辑保持真实单元格与有界挂载", async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "CPU throttling and long-task metrics require Chromium CDP");
  test.setTimeout(90000);
  await page.goto("http://localhost:8610"); await expect(page.getByText("产品出库单")).toBeVisible();
  const cdp = await page.context().newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const coreUrl = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/index.ts", import.meta.url))}`;
  await page.evaluate(async (coreUrl) => {
    const source = await fetch("/src/main.ts").then(response => response.text());
    const vueUrl = source.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)?.[1];
    const reportUrl = source.match(/from ["']([^"']*mach-report\/src\/vue\/index\.ts[^"']*)["']/)?.[1];
    if (!vueUrl || !reportUrl) throw new Error("Missing fixture module URLs");
    const { createApp, h } = await import(vueUrl) as typeof import("vue");
    const { ReportPreview, useMachReport } = await import(reportUrl) as typeof import("../packages/mach-report/src/vue/index");
    const { createTableTemplate, createReportSource } = await import(coreUrl) as typeof import("../packages/mach-report/src/index");
    const columns = Array.from({ length: 82 }, (_, index) => ({ field: `c${index}`, header: `字段${index}`, widthMm: 30 }));
    const detail = Array.from({ length: 2000 }, (_, row) => Object.fromEntries(columns.map((column, index) => [column.field,
      index === 0 ? `ROW-${row + 1}` : row === 0 && (index === 2 || index === 81) ? "共同目标" : row === 1999 && index === 81 ? "末端目标2000" : `${row}:${index}`
    ])));
    const template = createTableTemplate({ layout: "wide", title: "冻结窗口组合验收", columns, listOptions: { rowKey: "c0", rowHeightMm: 6.5, fontSizePt: 10 } });
    const fetcher = createReportSource({ frozen: { template, datasets: { detail } } });
    const report = useMachReport(), target = document.createElement("div");
    target.id = "frozen-window-fixture"; target.style.cssText = "position:fixed;inset:0;z-index:9999"; document.body.append(target);
    (window as FixtureWindow).__frozenWindow = { report, original: "" };
    createApp({ render: () => h(ReportPreview, { ref: report.ref, reportId: "frozen", fetcher, height: "100vh", editable: true,
      interaction: { frozenColumns: 2, freezeHeaders: true }, showExport: false, showPrint: false, showPdfWindow: false }) }).mount(target);
  }, coreUrl);
  const root = page.locator("#frozen-window-fixture"), viewport = root.locator(".mrp-body");
  await expect(root.locator(".mrp-cell-frozen").first()).toHaveCSS("position", "sticky");
  await page.evaluate(() => { const fixture = (window as FixtureWindow).__frozenWindow!; fixture.original = JSON.stringify(fixture.report.getPlan()); });
  const initialCells = await root.locator("td").count(); expect(initialCells).toBeLessThan(1500);
  await viewport.evaluate(element => { element.scrollLeft = 5000; element.scrollTop = 180; });
  await expect.poll(() => root.locator("td").count()).toBeLessThan(1500);
  const pinned = root.getByRole("gridcell", { name: "ROW-10", exact: true }); await expect(pinned).toBeVisible();
  const positions = await pinned.evaluate(element => {
    const viewport = element.closest(".mrp-body")!;
    return [5000, 6000, 7200, 5000].map(left => {
      viewport.scrollLeft = left;
      return { left: element.getBoundingClientRect().left - viewport.getBoundingClientRect().left, connected: element.isConnected, position: getComputedStyle(element).position };
    });
  });
  for (const position of positions) { expect(position.connected).toBe(true); expect(position.position).toBe("sticky"); expect(Math.abs(position.left)).toBeLessThan(2); }
  const scrollMetrics = await viewport.evaluate(async element => {
    const longTasks: number[] = [], frames: number[] = [];
    const observer = new PerformanceObserver(list => { longTasks.push(...list.getEntries().map(entry => entry.duration)); }); observer.observe({ type: "longtask" });
    let previous = performance.now();
    for (let frame = 0; frame < 24; frame++) {
      element.scrollLeft = 4000 + frame % 6 * 600;
      await new Promise<void>(resolve => requestAnimationFrame(() => { const now = performance.now(); frames.push(now - previous); previous = now; resolve(); }));
    }
    longTasks.push(...observer.takeRecords().map(entry => entry.duration)); observer.disconnect();
    const sorted = [...frames].sort((a, b) => a - b);
    return { frameIntervalsMs: frames, frameP95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1]!, longTasksMs: longTasks };
  });
  console.log(`[perf] frozen-scroll ${JSON.stringify(scrollMetrics)}`);
  await testInfo.attach("frozen-scroll.json", { body: JSON.stringify(scrollMetrics, null, 2), contentType: "application/json" });
  expect(scrollMetrics.frameP95Ms).toBeLessThan(100);
  await root.getByRole("button", { name: "内容搜索", exact: true }).click();
  const search = root.getByRole("textbox", { name: "内容搜索", exact: true });
  await search.fill("共同目标"); await expect(root.locator(".mrp-search-count")).toHaveText("1/2");
  expect(await root.locator("td").count()).toBeLessThan(1500);
  await root.getByRole("button", { name: "下一个匹配", exact: true }).click();
  await expect(root.locator(".mrp-search-count")).toHaveText("2/2");
  await expect.poll(() => viewport.evaluate(element => element.scrollLeft)).toBeGreaterThan(7000);
  expect(await root.locator("td").count()).toBeLessThan(1500);
  const started = Date.now(); await search.fill("末端目标2000"); await expect(root.locator(".mrp-search-count")).toHaveText("1/1");
  const hit = root.locator("mark.mrp-hit"); await expect(hit).toHaveText("末端目标2000");
  const viewBox = (await viewport.boundingBox())!, hitBox = (await hit.boundingBox())!;
  expect(hitBox.x).toBeGreaterThan(viewBox.x + 60); expect(hitBox.x + hitBox.width).toBeLessThanOrEqual(viewBox.x + viewBox.width);
  const searchMs = Date.now() - started; expect(searchMs).toBeLessThan(3000);
  expect(await root.locator("td").count()).toBeLessThan(1500);
  expect(await page.evaluate(() => JSON.stringify((window as FixtureWindow).__frozenWindow!.report.getPlan()) === (window as FixtureWindow).__frozenWindow!.original)).toBe(true);
  await search.fill("");
  const lastField = root.getByRole("gridcell", { name: "1999:1", exact: true }); await expect(lastField).toBeVisible();
  await lastField.dblclick(); const editor = root.getByRole("textbox", { name: "编辑单元格", exact: true }); await expect(editor).toBeVisible();
  await editor.fill("EDITED-2000"); await viewport.evaluate(element => { element.scrollLeft -= 400; });
  await expect(editor).toHaveValue("EDITED-2000"); const editStarted = Date.now(); await editor.press("Enter");
  await expect(root.getByRole("gridcell", { name: "EDITED-2000", exact: true })).toBeVisible();
  const editMs = Date.now() - editStarted, undoStarted = Date.now();
  expect(await page.evaluate(() => (window as FixtureWindow).__frozenWindow!.report.undo())).toBe(true);
  await expect(root.getByRole("gridcell", { name: "1999:1", exact: true })).toBeVisible();
  expect(await root.locator("td").count()).toBeLessThan(1500);
  const metrics = { cpuThrottle: 4, source: "createReportSource", columns: 82, rows: 2000, initialCells, searchMs, editMs, undoMs: Date.now() - undoStarted, finalCells: await root.locator("td").count(), positions, ...scrollMetrics };
  console.log(`[perf] frozen-search-window ${JSON.stringify(metrics)}`);
  await testInfo.attach("frozen-search-window.json", { body: JSON.stringify(metrics, null, 2), contentType: "application/json" });
  await testInfo.attach("frozen-search-window.png", { body: await page.screenshot(), contentType: "image/png" });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 }); await cdp.detach();
});
