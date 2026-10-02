import { expect, test } from "@playwright/test";

test.describe("federation 宿主动态加载", () => {
  test("setRemote 动态注册 → 远程 reportPreview 渲染成功", async ({ page }) => {
    await page.goto("http://localhost:8611");
    await expect(page.locator("#status")).toHaveText("远程渲染完成", { timeout: 20000 });
    await expect(page.getByText("报表预览")).toBeVisible();
    await expect(page.getByText("联邦宿主渲染验证")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("联邦物料-1", { exact: true })).toBeVisible();
  });

  test("远程组件打印/翻页契约可用", async ({ page }) => {
    await page.goto("http://localhost:8611");
    await expect(page.locator("#status")).toHaveText("远程渲染完成", { timeout: 20000 });
    await expect(page.getByText("报表预览")).toBeVisible();
    const indicator = page.locator(".mrp-pageinfo");
    await expect(indicator).toHaveText(/1 \/ \d+/);
    await page.getByRole("button", { name: "下一页 ›" }).click();
    await expect(indicator).toHaveText(/2 \/ \d+/);
  });
});
