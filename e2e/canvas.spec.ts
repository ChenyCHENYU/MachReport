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

  test("结构化像素断言：已知位置红色块（Y 轴方向与几何换算回归门）", async ({ page }) => {
    await page.goto("http://localhost:8610");
    await expect(page.getByText("产品出库单")).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: "Canvas 校准渲染" }).click();
    const canvas = page.locator('canvas[data-canvas-render="calibration"]').first();
    await expect(canvas).toBeVisible({ timeout: 10000 });

    const probes = await page.evaluate(() => {
      const el = document.querySelector('canvas[data-canvas-render="calibration"]') as HTMLCanvasElement;
      const ctx = el.getContext("2d")!;
      const px = (mm: number) => Math.round(mm * (96 / 25.4));
      // 红色块：left=20mm, top=20mm, w=30mm, h=12mm（A4 794x1123 @96dpi）
      const read = (xmm: number, ymm: number) => {
        const d = ctx.getImageData(px(xmm), px(ymm), 1, 1).data;
        return [d[0]!, d[1]!, d[2]!] as const;
      };
      return {
        inside: read(35, 26), // 块中心：应为红色
        mirrored: read(35, 271), // 垂直镜像位置（297-26）：应为白色
        right: read(51, 26), // 块右侧 1mm 外：应为白色
        below: read(35, 34) // 块下方 2mm 外：应为白色
      };
    });

    const [r, g, b] = probes.inside;
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(80);
    expect(b).toBeLessThan(80);
    for (const [name, [pr, pg, pb]] of Object.entries({
      mirrored: probes.mirrored,
      right: probes.right,
      below: probes.below
    })) {
      expect(pr, `${name} 应为白色 R`).toBeGreaterThan(240);
      expect(pg, `${name} 应为白色 G`).toBeGreaterThan(240);
      expect(pb, `${name} 应为白色 B`).toBeGreaterThan(240);
    }
  });

  test("窗口化分页器：只实例化窗口内画布 + 滚动复用（内存 O(窗口)）", async ({ page }) => {
    await page.goto("http://localhost:8610");
    await expect(page.getByText("产品出库单")).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: "Canvas 窗口化（大报表）" }).click();
    const viewport = page.locator("[data-pager-viewport]");
    await expect(viewport).toBeVisible({ timeout: 10000 });
    // 等布局稳定（窗口应用后槽位即按页高占位）且首帧画布就绪
    await page.waitForFunction(
      () =>
        !!document.querySelector("[data-pager-viewport] canvas") &&
        (document.querySelector("[data-pager-viewport]") as HTMLElement).scrollHeight > 3000,
      { timeout: 10000 }
    );

    const stats = await page.evaluate(() => {
      const vp = document.querySelector("[data-pager-viewport]") as HTMLElement;
      const canvases = vp.querySelectorAll("canvas");
      const info = document.querySelector("[data-pager-info]")?.textContent ?? "";
      return { canvasCount: canvases.length, info, scrollHeight: vp.scrollHeight };
    });
    // 96 行出库单多页：画布数固定在池大小（远小于总页数），滚动高度为全量
    expect(stats.canvasCount).toBeLessThanOrEqual(6);
    expect(stats.scrollHeight).toBeGreaterThan(3000);
    expect(stats.info).toContain("窗口");

    // 滚动一屏：窗口移动、画布被复用（数量不增长）
    await page.evaluate(() => {
      const vp = document.querySelector("[data-pager-viewport]") as HTMLElement;
      vp.scrollTop = vp.scrollHeight * 0.6;
    });
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => {
      const vp = document.querySelector("[data-pager-viewport]") as HTMLElement;
      const canvases = vp.querySelectorAll("canvas");
      const info = document.querySelector("[data-pager-info]")?.textContent ?? "";
      return { canvasCount: canvases.length, info };
    });
    expect(after.canvasCount).toBeLessThanOrEqual(6);
    expect(after.info).toMatch(/当前渲染窗口/);
  });
});
