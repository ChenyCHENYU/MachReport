import { expect, test } from "@playwright/test";

test("template editor updates the real preview and persists a versioned draft", async ({ page }, testInfo) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await page.goto("http://localhost:8610/designer.html");
  await expect(page.locator(".mr-designer-preview .mrp-page-holder").first()).toBeVisible();
  await expect(page.locator(".mr-designer-preview")).toContainText("000418");
  await expect(page.locator(".mr-designer-preview").getByRole("button", { name: "导出 PDF", exact: true })).toHaveCount(0);
  await expect(page.locator(".mr-designer-preview [role=alert]")).toHaveCount(0);
  await expect(page.locator(".mr-designer-preview .mrp-toolbar")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  const first = page.locator("fieldset").first();
  await first.getByLabel("表头", { exact: true }).fill("生产炉号");
  await expect(page.locator(".mr-designer-preview")).toContainText("生产炉号");
  await first.getByLabel("正文对齐").selectOption("center");
  await expect(page.locator(".mr-designer-preview td").filter({ hasText: /^000418$/ }).first()).toHaveCSS("text-align", "center");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page.getByText("草稿已保存 · 修订 1")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存草稿" })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("designer.png"), fullPage: true });
  expect(failures).toEqual([]);
});

test("template editor keeps invalid JSON out of the preview and fits narrow screens", async ({ page }) => {
  await page.setViewportSize({ width: 680, height: 1000 });
  await page.goto("http://localhost:8610/designer.html");
  await page.locator("summary").click();
  const json = page.locator(".mr-designer-json");
  await json.fill('{"invalid":true}');
  await page.getByRole("button", { name: "校验并应用 JSON" }).click();
  await expect(page.locator('[role="alert"]')).toBeVisible();
  await expect(page.locator(".mr-designer-preview")).toContainText("000418");
  const width = await page.evaluate(() => ({ body: document.body.scrollWidth, viewport: innerWidth }));
  expect(width.body).toBeLessThanOrEqual(width.viewport);
});
