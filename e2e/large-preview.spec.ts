import { expect, test } from "@playwright/test";

/** 使用同一 Vite/Vue 运行时挂载有界大计划，不改动示例页面或宿主接口。 */
test("1000 页预览：正文和缩略图有界、滚动实际渲染、搜索跳到末页、关闭释放画布", async ({ page }, testInfo) => {
  await page.goto("http://localhost:8610");
  await expect(page.getByText("产品出库单")).toBeVisible({ timeout: 10000 });
  const mountMetrics = await page.evaluate(async () => {
    const moduleSource = await fetch("/src/main.ts").then((response) => response.text());
    const vueUrl = moduleSource.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)?.[1];
    const reportUrl = moduleSource.match(/from ["']([^"']*mach-report\/src\/vue\/index\.ts[^"']*)["']/)?.[1];
    if (!vueUrl || !reportUrl) throw new Error("未找到示例所用的 Vue/ReportPreview 模块地址");
    const { createApp, h, nextTick } = await import(vueUrl) as typeof import("vue");
    const { ReportPreview } = await import(reportUrl) as typeof import("../packages/mach-report/src/vue/index");
    const target = document.createElement("div");
    target.id = "large-preview-fixture";
    target.style.cssText = "position:fixed;inset:0;z-index:9999";
    document.body.appendChild(target);
    const plan = {
      schemaVersion: "large-e2e",
      pages: Array.from({ length: 1000 }, (_, i) => ({
        pageWidthMm: 210, pageHeightMm: 297,
        components: [{
          kind: "text" as const, leftMm: 10, topMm: 10, widthMm: 190, heightMm: 100,
          text: i === 999 ? "末页目标独有" : `大报表第 ${i + 1} 页\n${"数据钢材明细\n".repeat(50)}`
        }]
      }))
    };
    const started = performance.now();
    return await new Promise<{ pages: number; acceptedMs: number; firstPaintMs: number }>((resolve) => {
      createApp({
        render: () => h(ReportPreview, {
          reportId: "large-e2e", fetcher: async () => plan, height: "100vh",
          showExport: false, showPdfWindow: false, showPrint: false,
          onLoaded: async (pages: number) => {
            const acceptedMs = performance.now() - started;
            await nextTick();
            // 两帧后再记录，避免把 loaded（早于 DOM 提交）当作首屏绘制完成。
            requestAnimationFrame(() => requestAnimationFrame(() => resolve({
              pages, acceptedMs, firstPaintMs: performance.now() - started
            })));
          }
        })
      }).mount(target);
    });
  });
  expect(mountMetrics.pages).toBe(1000);
  const root = page.locator("#large-preview-fixture");
  await expect(root.locator('.mrp-page-holder[data-page="1"] .mr-page')).toContainText("大报表第 1 页");
  await root.getByRole("button", { name: "100%", exact: true }).click();
  let peakBodyPages = 0;
  for (const position of [0.1, 0.5, 0.8]) {
    const targetPage = await root.locator(".mrp-body").evaluate((element, ratio) => {
      const viewport = element as HTMLElement;
      viewport.scrollTop = viewport.scrollHeight * ratio;
      return Math.floor(viewport.scrollTop / (297 * (96 / 25.4) + 18)) + 1;
    }, position);
    await expect(root.locator(`[data-page="${targetPage}"] .mr-page`)).toContainText(`大报表第 ${targetPage} 页`);
    peakBodyPages = Math.max(peakBodyPages, await root.locator(".mrp-page-holder").count());
    expect(peakBodyPages).toBeLessThanOrEqual(4);
  }
  await root.getByRole("toolbar").getByRole("button", { name: /缩略图/ }).click();
  await expect.poll(() => root.locator(".mrp-thumb-box canvas").count()).toBeGreaterThan(0);
  const initial = root.locator('[data-thumb="1"]');
  await expect(initial).toHaveCount(1);
  let peakThumbs = await root.locator("[data-thumb]").count();
  for (const position of [0.1, 0.5, 0.8]) {
    const targetThumb = await root.locator(".mrp-thumbs").evaluate((element, ratio) => {
      const sidebar = element as HTMLElement;
      sidebar.scrollTop = sidebar.scrollHeight * ratio;
      return Math.floor(sidebar.scrollTop / 192) + 1;
    }, position);
    await expect(initial).toHaveCount(0);
    await expect(root.locator(`[data-thumb="${targetThumb}"] canvas`)).toHaveCount(1);
    peakThumbs = Math.max(peakThumbs, await root.locator("[data-thumb]").count());
    expect(peakThumbs).toBeLessThanOrEqual(8);
    expect(await root.locator(".mrp-thumb-box canvas").count()).toBeLessThanOrEqual(8);
  }
  await root.getByRole("toolbar").getByRole("button", { name: /缩略图/ }).click();
  await expect(root.locator(".mrp-thumb-box canvas")).toHaveCount(0);
  await root.getByRole("button", { name: "内容搜索" }).click();
  const searchStarted = Date.now();
  await root.locator(".mrp-search-input").fill("末页目标独有");
  await expect(root.locator(".mrp-search-count")).toHaveText("1/1");
  await expect(root.locator(".mrp-pageinfo")).toHaveText("1000 / 1000");
  await expect(root.locator('mark.mrp-hit')).toHaveText("末页目标独有");
  const metrics = { ...mountMetrics, peakBodyPages, peakThumbs, searchMs: Date.now() - searchStarted };
  console.log(`[perf] large-preview: ${JSON.stringify(metrics)}`);
  await testInfo.attach("large-preview-metrics.json", {
    body: JSON.stringify(metrics, null, 2),
    contentType: "application/json"
  });
});
