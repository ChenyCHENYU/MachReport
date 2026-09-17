import { expect, test } from "@playwright/test";

test.describe("Canvas 渲染后端", () => {
  test("位图渲染非空白（像素统计断言）", async ({ page }) => {
    await page.goto("http://localhost:8610");
    await expect(page.getByText("产品出库单")).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: "Canvas 位图渲染" }).click();
    const canvas = page.locator('canvas[data-canvas-render="done"]').first();
    await expect(canvas).toBeVisible({ timeout: 10000 });

    const stats = await page.evaluate(() => {
      const el = document.querySelector('canvas[data-canvas-render="done"]') as HTMLCanvasElement;
      const ctx = el.getContext("2d")!;
      const { width, height } = el;
      const data = ctx.getImageData(0, 0, width, height).data;
      let nonWhite = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i]! < 245 || data[i + 1]! < 245 || data[i + 2]! < 245) nonWhite++;
      }
      return { width, height, nonWhite, total: data.length / 4 };
    });
    expect(stats.width).toBeGreaterThan(500);
    expect(stats.height).toBeGreaterThan(700);
    expect(stats.nonWhite / stats.total).toBeGreaterThan(0.001);
  });
});
