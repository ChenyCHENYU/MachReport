import { expect, test } from "@playwright/test";

test.describe("MachReport example 真浏览器渲染", () => {
  test("出库单多页渲染 + 虚拟化 + 翻页", async ({ page }) => {
    await page.goto("http://localhost:8610");
    await expect(page.getByText("报表预览")).toBeVisible();

    await expect(page.getByText("产品出库单")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("合金结构钢坯 1", { exact: true })).toBeVisible();

    const holders = page.locator(".mrp-page-holder");
    const holderCount = await holders.count();
    expect(holderCount).toBeGreaterThan(0);
    expect(holderCount).toBeLessThan(20);

    const pageIndicator = page.locator(".mrp-pageinfo");
    await expect(pageIndicator).toHaveText(/1 \/ \d+/);
    const total = Number((await pageIndicator.textContent())!.split("/")[1]!.trim());
    expect(total).toBeGreaterThan(2);

    await page.getByRole("button", { name: "下一页 ›" }).click();
    await expect(pageIndicator).toHaveText(/2 \/ \d+/);
  });

  test("切换模板（工艺卡）与多模板拼接", async ({ page }) => {
    await page.goto("http://localhost:8610");
    await expect(page.getByText("产品出库单")).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: /^工艺卡/ }).click();
    await expect(page.getByText("冶炼浇注工艺卡（LF 精炼）")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("白渣保持", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: /多模板拼接/ }).click();
    await expect(page.getByText("产品出库单")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("冶炼浇注工艺卡（LF 精炼）")).toBeVisible();
  });

  test("缩放按钮切换（transform: scale，零重排）", async ({ page }) => {
    await page.goto("http://localhost:8610");
    await expect(page.getByText("产品出库单")).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: "150%" }).click();
    const inner = page.locator(".mrp-scale-inner");
    await expect(inner).toHaveCSS("transform", "matrix(1.5, 0, 0, 1.5, 0, 0)");
    // 缩放后内容仍可交互：翻页定位不漂移
    await page.getByRole("button", { name: "下一页 ›" }).click();
    await expect(page.locator(".mrp-pageinfo")).toHaveText(/2 \/ \d+/);
  });
});
