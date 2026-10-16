import { expect, test } from "@playwright/test";

test("列搜索与批量对齐可一次撤销，默认恢复确认保留未应用 JSON", async ({ page }) => {
  await page.goto("http://localhost:8610/designer.html");
  await expect(page.locator(".mr-designer-preview")).toContainText("000418");
  await page.getByLabel("搜索列名或字段").fill("weight");
  await expect(page.locator("fieldset")).toHaveCount(1);
  await expect(page.locator("fieldset")).toContainText("钢水重量");
  await page.getByRole("button", { name: "选择当前结果", exact: true }).click();
  await page.getByLabel("批量正文对齐", { exact: true }).selectOption("center");
  await expect(page.locator(".mr-designer-preview td").filter({ hasText: /^64200(?:\.0+)?$/ }).first()).toHaveCSS("text-align", "center");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.locator(".mr-designer-preview td").filter({ hasText: /^64200(?:\.0+)?$/ }).first()).toHaveCSS("text-align", "right");
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(page.locator(".mr-designer-preview td").filter({ hasText: /^64200(?:\.0+)?$/ }).first()).toHaveCSS("text-align", "center");
  await page.locator("summary").click();
  await page.getByLabel("完整模板 JSON", { exact: true }).fill("{正在输入");
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "恢复草稿", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "保留当前修改？" });
  await expect(dialog.getByRole("button", { name: "继续编辑", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("完整模板 JSON", { exact: true })).toHaveValue("{正在输入");
  await page.getByRole("button", { name: "恢复草稿", exact: true }).click();
  await dialog.getByRole("button", { name: "丢弃修改并继续", exact: true }).click();
  await expect(page.getByRole("button", { name: "恢复草稿", exact: true })).toBeDisabled();
  await expect(page.locator(".mr-designer-preview td").filter({ hasText: /^64200(?:\.0+)?$/ }).first()).toHaveCSS("text-align", "right");
});
