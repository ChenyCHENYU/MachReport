import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fileURLToPath } from "node:url";
import type { MachReportHandle } from "../packages/mach-report/src/vue/controller";

interface UxRegressionFixture { reports: MachReportHandle[]; snapshot(): string[] }
declare global { interface Window { __uxRegression: UxRegressionFixture } }

type FixtureMode = "unicode" | "reviews" | "pagination";
async function mountFixture(page: Page, mode: FixtureMode): Promise<void> {
  await page.goto("http://localhost:8610");
  await expect(page.getByText("产品出库单")).toBeVisible();
  const coreUrl = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/index.ts", import.meta.url))}`;
  await page.evaluate(async ({ coreUrl, mode }) => {
    const source = await fetch("/src/main.ts").then(response => response.text());
    const vueUrl = source.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)?.[1];
    const reportUrl = source.match(/from ["']([^"']*mach-report\/src\/vue\/index\.ts[^"']*)["']/)?.[1];
    if (!vueUrl || !reportUrl) throw new Error("Missing public fixture module URLs");
    const { createApp, h } = await import(vueUrl) as typeof import("vue");
    const { ReportPreview, useMachReport, provideMachReportConfig } = await import(reportUrl) as typeof import("../packages/mach-report/src/vue/index");
    const { createTableTemplate, createReportSource } = await import(coreUrl) as typeof import("../packages/mach-report/src/index");
    const target = document.createElement("div"); target.id = "ux-regressions-fixture";
    target.style.cssText = `position:fixed;inset:0;z-index:9999;background:#fff;display:grid;grid-template-columns:${mode === "reviews" ? "repeat(2,minmax(0,1fr))" : "minmax(0,1fr)"}`;
    document.body.append(target);
    createApp({ setup() {
      if (mode === "pagination") provideMachReportConfig({ theme: {
        colorScheme: "dark", shellBg: "#142237", shellFg: "#eef5ff", toolbarBg: "#142237", toolbarFg: "#eef5ff", toolbarBorder: "#39516c",
        btnFg: "#c3d4ef", btnBorder: "#39516c", btnHoverBg: "#263a55", btnHoverFg: "#ffffff", btnActiveBg: "#9bbfff", btnActiveFg: "#102340", errorFg: "#ffb4c0", warningFg: "#ffda93"
      } });
      const common = { height: "100vh", showExport: false, showPrint: false, showPdfWindow: false };
      const template = (title: string) => createTableTemplate({ title, columns: [{ field: "id", header: "编号", widthMm: 25 }, { field: "value", header: "内容", widthMm: 80 }], listOptions: { rowKey: "id" } });
      const reports = Array.from({ length: mode === "reviews" ? 2 : 1 }, () => useMachReport());
      window.__uxRegression = { reports, snapshot: () => reports.map(report => JSON.stringify(report.getPlan())) };
      if (mode === "reviews") {
        const definitions = ["first", "second"].map(id => {
          const sourceScope = `ux-${id}`;
          const fetcher = createReportSource({ [id]: { sourceScope, template: template(`核对工作区 ${id}`), datasets: { detail: [{ id: `ROW-${id}`, value: "" }] } } });
          const source = { sourceScope, datasetId: "detail", fields: [{ field: "value" }], load: () => [{ rowKey: `ROW-${id}`, values: { value: "reference" } }] };
          return { id, fetcher, ...(id === "first" ? { editable: true, prefill: source } : { dataComparison: source }) };
        });
        return () => definitions.map((definition, index) => h("section", { id: `ux-${definition.id}`, "aria-label": `Report ${definition.id}`, style: "min-width:0;height:100vh;border-right:1px solid #dbe5f1" }, [h(ReportPreview, { ...common, ...definition, reportId: definition.id, ref: reports[index]!.ref })]));
      }
      if (mode === "pagination") {
        const ids = ["page-one", "page-two", "page-three"];
        const fetcher = createReportSource(Object.fromEntries(ids.map(id => [id, { template: template(`分页校验 ${id}`), datasets: { detail: [{ id, value: "业务内容" }] } }])));
        return () => h(ReportPreview, { ...common, reportId: ids, fetcher, ref: reports[0]!.ref });
      }
      const fetcher = createReportSource({ unicode: { template: template("搜索字符验收"), datasets: { detail: [
        { id: "ROW-1", value: "İXA" }, { id: "ROW-2", value: "İDATA" }, { id: "ROW-3", value: "İDATA" }, { id: "ROW-4", value: "İİ" }
      ] } } });
      return () => h(ReportPreview, { ...common, reportId: "unicode", fetcher, ref: reports[0]!.ref });
    } }).mount(target);
  }, { coreUrl, mode });
  await expect(page.locator("#ux-regressions-fixture .mrp-page-holder .mr-page").first()).toBeVisible();
}

test("Unicode搜索使用原文范围，高亮、总数与上下个导航保持一致", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await mountFixture(page, "unicode");
  const root = page.locator("#ux-regressions-fixture");
  const baseline = await page.evaluate(() => window.__uxRegression.snapshot());
  await root.getByRole("button", { name: "内容搜索", exact: true }).click();
  const search = root.getByRole("textbox", { name: "内容搜索", exact: true });
  await search.fill("x"); await expect(root.locator(".mrp-search-count")).toHaveText("1/1");
  await expect(root.locator("mark.mrp-hit")).toHaveText(["X"]);
  await expect(root.locator("td").filter({ hasText: /^İXA$/u })).toHaveText("İXA");
  await search.fill("data"); await expect(root.locator(".mrp-search-count")).toHaveText("1/2");
  await expect(root.locator("mark.mrp-hit")).toHaveText(["DATA", "DATA"]);
  await search.press("Enter"); await expect(root.locator(".mrp-search-count")).toHaveText("2/2");
  await search.press("Shift+Enter"); await expect(root.locator(".mrp-search-count")).toHaveText("1/2");
  await search.fill("İ"); await expect(root.locator(".mrp-search-count")).toHaveText("1/5");
  await expect(root.locator("mark.mrp-hit")).toHaveText(["İ", "İ", "İ", "İ", "İ"]);
  await search.press("Shift+Enter"); await expect(root.locator(".mrp-search-count")).toHaveText("5/5");
  await search.press("Enter"); await expect(root.locator(".mrp-search-count")).toHaveText("1/5");
  expect(await root.locator("mark.mrp-hit").evaluateAll(marks => marks.every(mark => !!mark.textContent))).toBe(true);
  await root.getByRole("button", { name: "清除搜索", exact: true }).click(); await expect(root.locator("mark.mrp-hit")).toHaveCount(0);
  await expect(root.getByRole("gridcell", { name: "İXA", exact: true })).toHaveText("İXA");
  await expect(root.getByRole("gridcell", { name: "İDATA", exact: true })).toHaveCount(2);
  await expect(root.getByRole("gridcell", { name: "İİ", exact: true })).toHaveText("İİ");
  expect(await page.evaluate(() => window.__uxRegression.snapshot())).toEqual(baseline);
  expect(errors).toEqual([]);
});

test("并排报表各自打开核对，Tab与Escape只作用于当前弹窗并返回所属入口", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await mountFixture(page, "reviews");
  const first = page.locator("#ux-first"), second = page.locator("#ux-second");
  const firstTrigger = first.getByRole("button", { name: "数据工具", exact: true });
  const secondTrigger = second.getByRole("button", { name: "数据工具", exact: true });
  await firstTrigger.click(); await first.getByRole("menuitem", { name: "安全预填", exact: true }).click();
  const firstDialog = first.getByRole("dialog", { name: "安全预填", exact: true }); await expect(firstDialog).toBeVisible();
  await secondTrigger.click(); await second.getByRole("menuitem", { name: "业务数据对比", exact: true }).click();
  const secondDialog = second.getByRole("dialog", { name: "业务数据对比", exact: true }); await expect(secondDialog).toBeVisible();
  await expect(firstDialog).toBeVisible();
  const secondClose = secondDialog.getByRole("button", { name: "关闭数据核对", exact: true });
  const secondLoad = secondDialog.getByRole("button", { name: "读取并对比", exact: true });
  await expect(secondClose).toBeFocused();
  await secondClose.press("Shift+Tab"); await expect(secondLoad).toBeFocused();
  await secondLoad.press("Tab"); await expect(secondClose).toBeFocused();
  await secondClose.press("Escape"); await expect(secondDialog).toHaveCount(0);
  await expect(firstDialog).toBeVisible(); await expect(secondTrigger).toBeFocused();
  const firstClose = firstDialog.getByRole("button", { name: "关闭数据核对", exact: true });
  await firstClose.focus(); await firstClose.press("Escape"); await expect(firstDialog).toHaveCount(0);
  await expect(firstTrigger).toBeFocused();
  expect(errors).toEqual([]);
});

test("深色分页错误继承主题，实际三页查询与WCAG检查保持可用", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await mountFixture(page, "pagination");
  const root = page.locator("#ux-regressions-fixture"), pagination = root.getByRole("navigation", { name: "报表分页", exact: true });
  await expect(pagination.locator(".mrp-pageinfo")).toHaveText("1 / 3");
  const jump = pagination.getByRole("textbox", { name: "跳至页", exact: true });
  await jump.fill("0"); await jump.press("Enter");
  const alert = pagination.getByRole("alert"); await expect(alert).toHaveText("请输入有效页码");
  await expect(alert).toHaveCSS("color", "rgb(255, 180, 192)");
  await expect(jump).toHaveCSS("border-top-color", "rgb(255, 180, 192)");
  const results = await new AxeBuilder({ page }).include("#ux-regressions-fixture").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations).toEqual([]);
  await root.screenshot({ path: testInfo.outputPath("dark-pagination-feedback.png") });
  await jump.fill("3"); await jump.press("Enter"); await expect(pagination.locator(".mrp-pageinfo")).toHaveText("3 / 3");
  await expect(alert).toHaveCount(0); await expect(pagination.getByRole("button", { name: "下一页 ›", exact: true })).toBeDisabled();
  expect(errors).toEqual([]);
});
