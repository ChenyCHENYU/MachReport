import { expect, test } from "@playwright/test";

test("product workflow opens a real template, authors parameters, batches generations and reads archived instances", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://localhost:8610/platform.html");
  await expect(page.getByRole("status").first()).toContainText("本地参考适配器");
  await page.getByRole("button", { name: "打开设计器", exact: true }).click();
  await expect(page.locator(".mr-designer-preview")).toContainText("燃气");
  const rows = page.locator(".mr-designer-preview .mrp-page-holder");
  await expect(rows.first()).toBeVisible();
  await page.getByRole("tab", { name: "工具", exact: true }).click();
  await page.getByRole("button", { name: "查询参数", exact: true }).click();
  await expect(page.getByLabel("控件类型", { exact: true })).toHaveValue("month");
  await page.getByRole("button", { name: "批量生成", exact: true }).click();
  await expect(page.locator('.mr-batch input[type="month"]')).toHaveCount(2);
  await page.getByRole("button", { name: "生成全部", exact: true }).click();
  await expect(page.locator(".mr-batch__receipt")).toHaveCount(2);
  await page.locator(".mr-batch__receipt button").first().click();
  await expect(page.locator(".platform-instances aside")).toContainText("2026-10");
  await expect(page.locator(".platform-instances .mrp-page-holder").first()).toContainText("废钢");
  await expect(page.locator(".platform-instances .mrp-page-holder").first()).toContainText("燃气");
  await expect(page.getByText("PDF 字体尚未就绪", { exact: false })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("product-workflow.png"), fullPage: true });
  const downloaded = page.waitForEvent("download", { predicate: download => download.suggestedFilename().endsWith(".pdf") });
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await page.getByRole("menuitem", { name: "导出 PDF", exact: true }).click();
  const artifact = await downloaded;
  expect(await artifact.failure()).toBeNull();
  await artifact.saveAs(testInfo.outputPath("archived-instance.pdf"));
  // The local demo font has only a regular face. Preserve the honest style-fidelity notice.
  await expect(page.locator(".platform-instances [role=alert]")).toContainText("粗体/斜体按该字体自身字形导出");
  await expect(page.locator(".platform-instances [role=alert]")).not.toContainText("导出失败");
  expect(errors).toEqual([]);
});

test("template catalog and batch panel fit narrow viewports without page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 680, height: 900 });
  await page.goto("http://localhost:8610/platform.html");
  await expect(page.getByRole("button", { name: "打开设计器", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "批量生成", exact: true }).click();
  const size = await page.evaluate(() => ({ body: document.body.scrollWidth, viewport: innerWidth }));
  expect(size.body).toBeLessThanOrEqual(size.viewport);
});
