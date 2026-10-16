import { expect, test } from "@playwright/test";
import type { MachReportHandle } from "../packages/mach-report/src/vue/controller";
type FixtureWindow = Window & { __product: { report: MachReportHandle; calls: number } };

test.beforeEach(async ({ page }) => {
  await page.goto("http://localhost:8610"); await expect(page.getByText("产品出库单")).toBeVisible();
  await page.evaluate(async () => {
    const source = await fetch("/src/main.ts").then((response) => response.text());
    const vueUrl = source.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)?.[1];
    const reportUrl = source.match(/from ["']([^"']*mach-report\/src\/vue\/index\.ts[^"']*)["']/)?.[1];
    if (!vueUrl || !reportUrl) throw new Error("Missing demo module URLs");
    const { createApp, h } = await import(vueUrl) as typeof import("vue");
    const { ReportPreview, useMachReport, provideMachReportConfig } = await import(reportUrl) as typeof import("../packages/mach-report/src/vue/index");
    const target = document.createElement("div"); target.id = "product-fixture"; target.style.cssText = "position:fixed;inset:0;z-index:9999"; document.body.append(target);
    createApp({ setup() {
      const report = useMachReport(); const state = { report, calls: 0 }; (window as FixtureWindow).__product = state;
      provideMachReportConfig({ theme: { shellBg: "#f6f8fc", shellFg: "#213547", toolbarBg: "#fff", toolbarFg: "#213547" } });
      return () => h(ReportPreview, { ref: report.ref, reportId: "product", height: "100vh", editable: true, showExport: false, showPdfWindow: false, fetcher: async ({ params }) => {
        state.calls++;
        if (params.slow === "yes") await new Promise((resolve) => setTimeout(resolve, 700));
        return { schemaVersion: "product", pages: [{ pageWidthMm: 210, pageHeightMm: 100, components: [{ kind: "rect", leftMm: 10, topMm: 10, widthMm: 60, heightMm: 15, grid: { cells: [[{ text: "5", value: 5, valueType: "number" }]] } }] }] };
      } });
    } }).mount(target);
  });
});

test("修改保护保留活动输入，焦点受控，确认后才替换本地草稿", async ({ page }) => {
  const root = page.locator("#product-fixture"); const cell = root.locator("td[data-mr-row-index]"); await expect(cell).toBeVisible();
  await cell.dblclick(); const input = root.locator(".mrp-cell-editor"); await input.fill("9");
  await page.evaluate(() => { void (window as FixtureWindow).__product.report.reload(); });
  const dialog = root.getByRole("alertdialog"); await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "继续编辑", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab"); await expect(dialog.getByRole("button", { name: "放弃修改并继续", exact: true })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(input).toBeFocused(); await expect(input).toHaveValue("9");
  expect(await page.evaluate(() => (window as FixtureWindow).__product.calls)).toBe(1);
  await input.press("Enter"); await expect(cell).toHaveText("9");
  await page.evaluate(() => { void (window as FixtureWindow).__product.report.reload(); });
  await dialog.getByRole("button", { name: "放弃修改并继续", exact: true }).click();
  await expect(cell).toHaveText("5"); expect(await page.evaluate(() => (window as FixtureWindow).__product.calls)).toBe(2);
});

test("长查询可以取消并重新执行，忽略signal的迟到响应不会闪回", async ({ page }) => {
  const root = page.locator("#product-fixture"); await expect(root.locator("td")).toBeVisible();
  await page.evaluate(() => { void (window as FixtureWindow).__product.report.setParams({ slow: "yes" }); });
  await root.getByRole("button", { name: "取消任务", exact: true }).click();
  await expect(root.locator(".mrp-task-status")).toContainText("任务已取消");
  expect(await page.evaluate(() => (window as FixtureWindow).__product.report.state.loading)).toBe(false);
  await page.evaluate(() => (window as FixtureWindow).__product.report.setParams({ slow: "" }));
  await expect(root.locator("td")).toHaveText("5");
  await expect.poll(() => page.evaluate(() => (window as FixtureWindow).__product.report.state.task?.status)).toBe("completed");
  expect(await page.evaluate(() => (window as FixtureWindow).__product.calls)).toBe(3);
});
