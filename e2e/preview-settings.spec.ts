import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

test("设置工具开关的真实checked状态、恢复默认和宿主权限边界", async ({ page }) => {
  await page.goto("http://localhost:8610");
  await expect(page.getByText("产品出库单")).toBeVisible();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "设置", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: "工具", exact: true }).click();
  const html = dialog.getByRole("checkbox", { name: "导出 HTML", exact: true });
  await expect(html).toBeChecked();
  await html.uncheck();
  await expect(html).not.toBeChecked();
  await expect(page.locator(".mrp-toolbar").getByRole("button", { name: "导出 HTML", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "关闭设置", exact: true }).click();
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "导出 HTML", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await dialog.getByRole("tab", { name: "工具", exact: true }).click();
  await dialog.getByRole("checkbox", { name: "内容搜索", exact: true }).uncheck();
  await expect(page.locator(".mrp-toolbar").getByRole("button", { name: "内容搜索", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("checkbox", { name: /编辑单元格/ })).toBeDisabled();
  await expect(dialog.getByRole("checkbox", { name: "导入 Excel 模板", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "恢复默认", exact: true }).click();
  await expect(html).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "内容搜索", exact: true })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "设置", exact: true })).toBeFocused();
});

test("82列零行：保留真实表头，SVG空态在左右滚动的可见视口内", async ({ page }, testInfo) => {
  await page.goto("http://localhost:8610");
  await expect(page.getByText("产品出库单")).toBeVisible();
  const sourceUrl = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/index.ts", import.meta.url))}`;
  await page.evaluate(async (sourceUrl) => {
    const source = await fetch("/src/main.ts").then((response) => response.text());
    const vueUrl = source.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)?.[1];
    const reportUrl = source.match(/from ["']([^"']*mach-report\/src\/vue\/index\.ts[^"']*)["']/)?.[1];
    if (!vueUrl || !reportUrl) throw new Error("未找到当前示例的Vue/预览模块");
    const { createApp, h } = await import(vueUrl) as typeof import("vue");
    const { ReportPreview } = await import(reportUrl) as typeof import("../packages/mach-report/src/vue/index");
    const { createTableTemplate, paginateTemplate } = await import(/* @vite-ignore */ sourceUrl);
    const template = createTableTemplate({ layout: "wide", title: "空实绩报表", columns: Array.from({ length: 82 }, (_, index) => ({ header: `字段${index + 1}`, field: `c${index}`, widthMm: 30 })) });
    const { plan } = paginateTemplate(template, { detail: [] });
    localStorage.removeItem("mach-report:ui:wide");
    const target = document.createElement("div");
    target.id = "empty-wide-fixture";
    target.style.cssText = "position:fixed;inset:0;z-index:9999";
    document.body.append(target);
    createApp({ render: () => h(ReportPreview, { reportId: "empty", fetcher: async () => plan, height: "100vh", showExport: false, showPrint: false, showPdfWindow: false,
      emptyState: { title: "暂无实绩明细", description: "YTS0 · 2026-10-15 · 0 条，请核对厂别和日期" } }) }).mount(target);
  }, sourceUrl);
  const root = page.locator("#empty-wide-fixture");
  await expect(root.locator(".mrp-page-holder").getByText("字段1", { exact: true })).toBeVisible();
  const empty = root.locator(".mrp-empty");
  const viewport = root.locator(".mrp-body");
  await expect(empty.getByText("暂无实绩明细", { exact: true })).toBeVisible();
  await expect(empty.locator("svg")).toBeVisible();
  for (const scroll of [0, 8000]) {
    await viewport.evaluate((element, left) => { element.scrollLeft = left; }, scroll);
    const bounds = await viewport.boundingBox();
    const card = await empty.boundingBox();
    expect(card!.x).toBeGreaterThanOrEqual(bounds!.x);
    expect(card!.x + card!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
    expect(card!.y + card!.height).toBeLessThan(bounds!.y + bounds!.height);
  }
  await testInfo.attach("wide-empty-svg.png", { body: await page.screenshot(), contentType: "image/png" });
});
