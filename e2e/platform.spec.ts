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
  await page.getByRole("button", { name: /^生成待处理/ }).click();
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
  await page.getByRole("button", { name: "批量生成", exact: true }).click();
  await expect(page.locator(".mr-batch__receipt")).toHaveCount(2);
  await expect(page.locator(".mr-batch").getByRole("button", { name: /^生成待处理/ })).toBeDisabled();
  await page.getByRole("button", { name: "模板设计", exact: true }).click();
  await page.getByLabel("表头", { exact: true }).fill("新发布口径");
  await page.getByRole("button", { name: "发布当前草稿", exact: true }).click();
  await expect(page.locator(".platform-status")).toContainText("已发布模板");
  await page.getByRole("button", { name: "批量生成", exact: true }).click();
  await expect(page.locator(".platform-batch-context")).toContainText("绑定发布修订 2");
  await expect(page.locator(".mr-batch__receipt")).toHaveCount(2);
  await page.getByRole("button", { name: "使用最新发布版创建新批次", exact: true }).click();
  await expect(page.locator(".platform-batch-context")).toContainText("绑定发布修订 4");
  await expect(page.locator(".mr-batch__receipt")).toHaveCount(0);
  await page.locator(".mr-batch").getByRole("button", { name: /^生成待处理/ }).click();
  await expect(page.locator(".mr-batch__receipt")).toHaveCount(2);
  await page.getByRole("button", { name: "报表实例", exact: true }).click();
  await expect(page.locator(".platform-instances aside button")).toHaveCount(4);
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


test("saved draft reopens at its latest revision while published view stays separate and read only", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://localhost:8610/platform.html");
  await page.getByRole("button", { name: "打开设计器", exact: true }).click();
  const header = page.getByLabel("表头", { exact: true });
  const original = await header.inputValue();
  await header.fill("草稿保留验证");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "模板库", exact: true }).click();
  await expect(page.locator(".mr-library-state")).toHaveText("草稿待发布");
  await page.getByRole("button", { name: "查看发布版", exact: true }).click();
  await expect(header).toHaveValue(original); await expect(header).toBeDisabled();
  await page.getByRole("button", { name: "返回编辑草稿", exact: true }).click();
  await expect(header).toHaveValue("草稿保留验证"); await expect(header).toBeEnabled();
  await header.fill("草稿再次保存验证");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "模板库", exact: true }).click();
  await page.getByRole("button", { name: "继续编辑草稿", exact: true }).click();
  await expect(header).toHaveValue("草稿再次保存验证");
  await expect(page.getByText("模板已变化，请重新读取后提交", { exact: false })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("draft-lifecycle.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("unapplied parameter controls stay reachable from preview and locate their field errors", async ({ page }, testInfo) => {
  await page.goto("http://localhost:8610/platform.html");
  await page.getByRole("button", { name: "打开设计器", exact: true }).click();
  await page.getByRole("tab", { name: "工具", exact: true }).click();
  await page.getByRole("button", { name: "查询参数", exact: true }).click();
  const params = page.locator(".mr-param-editor");
  await params.getByLabel("参数标识", { exact: true }).fill("");
  await expect(params.locator(".has-errors")).toHaveCount(1);
  await page.getByRole("tab", { name: "字段", exact: true }).click();
  const pending = page.locator(".mr-designer-pending");
  await expect(pending).toContainText("查询参数");
  await pending.getByRole("button", { name: /查询参数/ }).click();
  await params.getByRole("button", { name: "定位首个问题", exact: true }).click();
  await expect(params.getByLabel("参数标识", { exact: true })).toBeFocused();
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("parameter-feedback.png"), fullPage: true });
});

test("long template identities and generation receipts fit a phone viewport", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("http://localhost:8610/platform.html");
  await page.getByRole("button", { name: "复制模板", exact: true }).click();
  await page.getByLabel("新模板编号", { exact: true }).fill("long-template-" + "x".repeat(170));
  await page.getByLabel("新模板名称", { exact: true }).fill("跨厂区成本及能源综合核对".repeat(16));
  await page.getByRole("button", { name: "创建副本", exact: true }).click();
  await expect(page.locator(".mr-designer")).toBeVisible();
  await page.getByRole("button", { name: "模板库", exact: true }).click();
  const size = await page.evaluate(() => ({ body: document.body.scrollWidth, viewport: innerWidth }));
  expect(size.body).toBeLessThanOrEqual(size.viewport);
  await page.screenshot({ path: testInfo.outputPath("long-template-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "继续编辑草稿", exact: true }).click();
  await page.getByRole("button", { name: "发布当前草稿", exact: true }).click();
  await page.getByRole("button", { name: "批量生成", exact: true }).click();
  await page.locator(".mr-batch").getByRole("button", { name: /^生成待处理/ }).click();
  await expect(page.locator(".mr-batch__receipt")).toHaveCount(2);
  expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("long-receipt-mobile.png"), fullPage: true });
});
