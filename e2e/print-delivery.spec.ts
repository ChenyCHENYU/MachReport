import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test, type Route } from "@playwright/test";

const printModule = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/vue/composables/usePrintExport.ts", import.meta.url))}`;
const coreModule = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/index.ts", import.meta.url))}`;
const previewModule = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/vue/index.ts", import.meta.url))}`;
declare global { interface Window { printDelivery: { printed: number; done: boolean; error: string; fontReady?: boolean; imageReady?: boolean; pageWidth?: number; transformed?: string } } }

test("print waits for the actual iframe font and decoded image before handing off to the system", async ({ page }) => {
  let fontRoute!: Route, imageRoute!: Route;
  await page.route("**/fonts/print-ready.otf", route => { fontRoute = route; });
  await page.route("**/print-ready.png", route => { imageRoute = route; });
  await page.goto("http://localhost:8610/labels.html");
  await expect(page.locator(".mrp-page-holder").first()).toBeVisible();
  await page.evaluate(async module => {
    const { printPlans } = await import(module);
    const state = window.printDelivery = { printed: 0, done: false, error: "" } as Window["printDelivery"];
    const observer = new MutationObserver(() => {
      const frame = document.querySelector("iframe");
      if (!frame?.contentWindow) return;
      frame.contentWindow.print = () => {
        state.printed++; state.fontReady = frame.contentDocument!.fonts.check('12px "MachPrint"');
        const image = frame.contentDocument!.querySelector("img")!;
        state.imageReady = image.complete && image.naturalWidth > 0;
        state.pageWidth = parseFloat((frame.contentDocument!.querySelector(".mr-page") as HTMLElement).style.width);
        state.transformed = frame.contentDocument!.querySelector(".mr-page>div")!.getAttribute("style") ?? "";
      };
    });
    observer.observe(document.body, { childList: true });
    const plan = { schemaVersion: "print-test", pages: [{ pageWidthMm: 80, pageHeightMm: 55, components: [
      { kind: "text", leftMm: 5, topMm: 5, widthMm: 50, heightMm: 8, text: "Material 0001", style: { fontFamily: "MachPrint", fontSize: 10 } },
      { kind: "image", leftMm: 60, topMm: 10, widthMm: 10, heightMm: 10, imageData: "/print-ready.png" }
    ] }] };
    void printPlans([plan], { printOptions: { fonts: [{ family: "MachPrint", source: "/fonts/print-ready.otf" }], calibration: { offsetXmm: 1.5, offsetYmm: -.5 } }, onError: (message: string) => { state.error = message; } }).finally(() => { state.done = true; observer.disconnect(); });
  }, printModule);
  await expect.poll(() => !!fontRoute).toBe(true);
  expect(await page.evaluate(() => window.printDelivery.printed)).toBe(0);
  await fontRoute.fulfill({ contentType: "font/otf", body: await readFile(new URL("../examples/minimal/public/fonts/mach-report-demo.otf", import.meta.url)) });
  await expect.poll(() => !!imageRoute).toBe(true);
  expect(await page.evaluate(() => window.printDelivery.printed)).toBe(0);
  await imageRoute.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64") });
  await expect.poll(() => page.evaluate(() => window.printDelivery.done)).toBe(true);
  const result = await page.evaluate(() => window.printDelivery);
  expect(result).toMatchObject({ printed: 1, done: true, error: "", fontReady: true, imageReady: true });
  expect(result.pageWidth).toBeCloseTo(80 * 96 / 25.4, 2);
  expect(result.transformed).toContain("translate(1.5mm, -0.5mm)");
});

test("business explanations remain compact, preserve zero and locate the intended row", async ({ page }, testInfo) => {
  await page.goto("http://localhost:8610");
  await page.evaluate(async ({ coreModule, previewModule }) => {
    const source = await fetch("/src/main.ts").then(response => response.text());
    const vueUrl = source.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)?.[1];
    if (!vueUrl) throw new Error("Missing Vue URL");
    const { createApp, h } = await import(vueUrl);
    const { ReportPreview } = await import(previewModule);
    const { createReportSource, createTableTemplate } = await import(coreModule);
    const template = createTableTemplate({ title: "物料实绩核对", listOptions: { rowKey: "id" }, columns: [{ field: "id", header: "物料编号" }, { field: "weight", header: "实际重量" }] });
    const fetcher = createReportSource({ actual: { template, provider: { query: () => ({ datasets: { detail: [{ id: "0001", weight: 0 }, { id: "0002", weight: null }] }, diagnostics: [
      { code: "weight-unavailable", severity: "info", message: "该物料尚无称重实绩，待称重后可重新查询。", valueState: "missing-source", target: { datasetId: "detail", rowKey: "0002", field: "weight" } }
    ] }) } } });
    const root = document.createElement("div"); root.id = "explanation-fixture"; root.style.cssText = "position:fixed;inset:0;z-index:9999"; document.body.append(root);
    createApp({ render: () => h(ReportPreview, { reportId: "actual", fetcher, height: "100vh", showExport: false, showPdfWindow: false }) }).mount(root);
  }, { coreModule, previewModule });
  const root = page.locator("#explanation-fixture");
  await expect(root.locator(".mrp-page-holder")).toContainText("0001");
  await expect(root.getByRole('gridcell', { name: '0', exact: true })).toHaveText("0");
  const summary = root.locator(".mrp-data-explanation summary");
  expect((await summary.boundingBox())!.height).toBeLessThan(40);
  await summary.click();
  await root.locator(".mrp-data-content button").click();
  await expect(root.locator(".mrp-cell-focus")).toHaveText("");
  await root.getByRole("button", { name: "设置", exact: true }).click();
  const settings = root.getByRole("dialog", { name: "设置", exact: true });
  await settings.locator(".mrp-print-settings summary").click();
  const horizontal = settings.getByRole("spinbutton", { name: "水平偏移（mm）", exact: true });
  await horizontal.fill("1.2"); await horizontal.press("Tab");
  await expect(horizontal).toHaveValue("1.2");
  await expect(settings.getByRole("button", { name: "打印校准页", exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("print-calibration-settings.png"), fullPage: true });
});

test("label imposition is opt-in in settings and retains all original-size records", async ({ page }, testInfo) => {
  await page.goto("http://localhost:8610/labels.html");
  await expect(page.locator(".mrp-pageinfo")).toContainText("1 / 4");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "设置", exact: true });
  await settings.getByRole("checkbox", { name: /A4 标签拼版/ }).check();
  await settings.getByRole("button", { name: "关闭设置", exact: true }).click();
  await expect(page.locator(".mrp-pageinfo")).toContainText("1 / 1");
  await expect(page.locator(".mrp-page-holder")).toContainText("MR26010001");
  await expect(page.locator(".mrp-page-holder")).toContainText("MR26010002");
  await expect(page.locator(".mrp-record-navigation")).toHaveCount(0);
  const physical = await page.locator(".mrp-page-holder .mr-page").evaluate(element => ({
    width: parseFloat((element as HTMLElement).style.width),
    height: parseFloat((element as HTMLElement).style.height),
  }));
  expect(physical.width).toBeCloseTo(210 * 96 / 25.4, 2);
  expect(physical.height).toBeCloseTo(297 * 96 / 25.4, 2);
  const images = page.locator('.mrp-page-holder img[src^="data:image/png;base64,"]');
  await expect(images).toHaveCount(4);
  expect(await images.evaluateAll(elements => elements.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await expect(page.locator("[role=alert]")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("label-a4-imposition.png"), fullPage: true });
});
