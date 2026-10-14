import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

test("82列×2000行：实际字号、左右端可达、连续分段、远右搜索和小画布缩略图", async ({ page }, testInfo) => {
  test.setTimeout(90000);
  await page.goto("http://localhost:8610");
  await expect(page.getByText("产品出库单")).toBeVisible({ timeout: 10000 });
  const sourceUrl = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/index.ts", import.meta.url))}`;
  const metrics = await page.evaluate(async (sourceUrl) => {
    const moduleSource = await fetch("/src/main.ts").then((response) => response.text());
    const vueUrl = moduleSource.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)?.[1];
    const reportUrl = moduleSource.match(/from ["']([^"']*mach-report\/src\/vue\/index\.ts[^"']*)["']/)?.[1];
    if (!vueUrl || !reportUrl) throw new Error("未找到当前示例的Vue/预览模块");
    const { createApp, h, nextTick } = await import(vueUrl) as typeof import("vue");
    const { ReportPreview } = await import(reportUrl) as typeof import("../packages/mach-report/src/vue/index");
    const { createTableTemplate, paginateTemplate } = await import(/* @vite-ignore */ sourceUrl);
    localStorage.setItem("mach-report:ui", JSON.stringify({ zoomMode: "fit" }));
    localStorage.removeItem("mach-report:ui:wide");
    const columns = Array.from({ length: 82 }, (_, index) => ({ header: `字段${index + 1}`, field: `c${index}`, widthMm: 30 }));
    const detail = Array.from({ length: 2000 }, (_, row) => Object.fromEntries(columns.map((column, index) => [
      column.field, row === 1999 && index === 81 ? "末端目标2000" : row === 0 && (index === 1 || index === 81)
        ? "同页目标" : `${row + 1}:${index + 1}`
    ])));
    const started = performance.now();
    const template = createTableTemplate({ layout: "wide", title: "82列完整宽表", columns, listOptions: { fontSizePt: 10, rowHeightMm: 6.5 } });
    const { plan, warnings } = paginateTemplate(template, { detail });
    const planMs = performance.now() - started;
    const target = document.createElement("div");
    target.id = "wide-table-fixture";
    target.style.cssText = "position:fixed;inset:0;z-index:9999";
    document.body.append(target);
    await new Promise<void>((resolve) => {
      createApp({ render: () => h(ReportPreview, {
        reportId: "wide-table", fetcher: async () => plan, height: "100vh",
        showExport: false, showPrint: false, showPdfWindow: false,
        onLoaded: async () => {
          await nextTick();
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }
      }) }).mount(target);
    });
    return { columns: 82, rows: 2000, pages: plan.pages.length, widthMm: plan.pages[0]!.pageWidthMm, planMs,
      firstPaintMs: performance.now() - started, warnings: warnings.length };
  }, sourceUrl);
  const root = page.locator("#wide-table-fixture");
  const viewport = root.locator(".mrp-body");
  await expect(root.locator(".mach-report-preview")).toHaveClass(/mrp-wide-report/);
  await expect(root.getByRole("button", { name: "100%", exact: true })).toHaveClass(/mrp-active/);
  const initial = await root.locator(".mrp-scale-inner").evaluate((element) => {
    const page = element.querySelector<HTMLElement>(".mr-page")!;
    const holder = element.querySelector<HTMLElement>(".mrp-page-holder")!;
    const cell = element.querySelector<HTMLElement>("td")!;
    return { transform: getComputedStyle(element).transform, fontPx: Number.parseFloat(getComputedStyle(cell).fontSize), textColor: getComputedStyle(cell).color,
      holderGap: getComputedStyle(holder).marginBottom, shadow: getComputedStyle(holder).boxShadow,
      firstPageHeight: page.getBoundingClientRect().height };
  });
  expect(initial.transform).toBe("matrix(1, 0, 0, 1, 0, 0)");
  expect(initial.fontPx).toBeCloseTo(13.3333, 2);
  expect(initial.textColor).toBe("rgb(0, 0, 0)");
  expect(initial.holderGap).toBe("0px");
  expect(initial.shadow).toBe("none");
  expect(metrics.warnings).toBe(0);
  expect(metrics.widthMm).toBe(2480);
  expect(await root.locator(".mrp-page-holder").count()).toBeLessThanOrEqual(4);
  const first = root.locator('[data-page="1"] td').first();
  const last = root.locator('[data-page="1"] tr').first().locator("td").last();
  const viewBox = (await viewport.boundingBox())!;
  expect((await first.boundingBox())!.x).toBeGreaterThanOrEqual(viewBox.x);
  await viewport.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  await expect.poll(async () => {
    const box = (await last.boundingBox())!;
    return box.x + box.width;
  }).toBeLessThanOrEqual(viewBox.x + viewBox.width);
  expect((await last.boundingBox())!.x).toBeGreaterThanOrEqual(viewBox.x);

  // 主动适宽允许小于30%，并且实际可滚动几何随缩放收紧。
  await root.getByRole("button", { name: "适宽", exact: true }).click();
  await expect.poll(() => viewport.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(2);
  const fit = await root.locator(".mrp-scale-inner").evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a);
  expect(fit).toBeLessThan(0.3);
  expect(fit).toBeCloseTo((viewBox.width - 48) / (metrics.widthMm * 96 / 25.4), 3);
  // 宿主侧栏/容器变化不会派发window.resize，仍应重新适宽。
  await root.evaluate((element) => { element.style.width = "1000px"; });
  await expect.poll(() => root.locator(".mrp-scale-inner").evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a))
    .toBeCloseTo(952 / (metrics.widthMm * 96 / 25.4), 3);
  await root.evaluate((element) => { element.style.width = ""; });
  await expect.poll(() => root.locator(".mrp-scale-inner").evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a))
    .toBeCloseTo(fit, 3);
  await root.getByRole("button", { name: "100%", exact: true }).click();

  // 同页两处命中分别滚到左侧和第82列。
  await root.getByRole("button", { name: "🔍" }).click();
  await root.locator(".mrp-search-input").fill("同页目标");
  await expect(root.locator(".mrp-search-count")).toHaveText("1/2");
  expect(await viewport.evaluate((element) => element.scrollLeft)).toBeLessThan(100);
  await root.getByRole("button", { name: "›", exact: true }).click();
  await expect(root.locator(".mrp-search-count")).toHaveText("2/2");
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(7000);
  const searchStarted = Date.now();
  await root.locator(".mrp-search-input").fill("末端目标2000");
  await expect(root.locator(".mrp-search-count")).toHaveText("1/1");
  await expect(root.locator(".mrp-pageinfo")).toHaveText(`${metrics.pages} / ${metrics.pages}`);
  const hit = root.locator("mark.mrp-hit");
  await expect(hit).toHaveText("末端目标2000");
  const hitBox = (await hit.boundingBox())!;
  expect(hitBox.x).toBeGreaterThanOrEqual(viewBox.x);
  expect(hitBox.x + hitBox.width).toBeLessThanOrEqual(viewBox.x + viewBox.width);
  const peakBodyPages = await root.locator(".mrp-page-holder").count();
  expect(peakBodyPages).toBeLessThanOrEqual(4);
  const searchLastMs = Date.now() - searchStarted;
  await root.getByRole("button", { name: /缩略图/ }).click();
  await expect.poll(() => root.locator(".mrp-thumb-box canvas").count()).toBeGreaterThan(0);
  await expect.poll(async () => {
    const box = (await hit.boundingBox())!;
    const viewportBox = (await viewport.boundingBox())!;
    return box.x + box.width - (viewportBox.x + viewportBox.width);
  }).toBeLessThanOrEqual(0);
  const canvases = await root.locator(".mrp-thumb-box canvas").evaluateAll((elements) => elements.map((element) => ({
    width: (element as HTMLCanvasElement).width, height: (element as HTMLCanvasElement).height
  })));
  const thumbSlots = await root.locator("[data-thumb]").count();
  expect(thumbSlots).toBeLessThanOrEqual(26);
  expect(canvases.length).toBeLessThanOrEqual(26);
  expect(canvases.every((canvas) => canvas.width <= 116 && canvas.height <= 116)).toBe(true);
  const result = { ...metrics, ...initial, fit, peakBodyPages, thumbSlots, thumbCount: canvases.length, maxThumbWidth: Math.max(...canvases.map((canvas) => canvas.width)),
    searchLastMs };
  console.log(`[perf] wide-table: ${JSON.stringify(result)}`);
  await testInfo.attach("wide-table-metrics.json", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
  await testInfo.attach("wide-table-preview.png", { body: await page.screenshot(), contentType: "image/png" });
});
