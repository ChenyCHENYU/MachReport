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

  test("标准明细自动布局与父页面只读状态", async ({ page }) => {
    let releaseFont!: () => void;
    const fontGate = new Promise<void>((resolve) => { releaseFont = resolve; });
    await page.route("**/fonts/mach-report-demo.otf", async (route) => {
      if (route.request().method() === "GET") await fontGate;
      await route.continue();
    });

    try {
      await page.goto("http://localhost:8610");
      await expect(page.getByText("产品出库单")).toBeVisible({ timeout: 10000 });
      await page.getByRole("button", { name: "标准明细（自动布局）" }).click();
      await expect(page.getByText("出库单", { exact: true })).toBeVisible();
      await expect(page.getByText("合金结构钢坯 1", { exact: true })).toBeVisible();
      await expect(page.getByText("3 支", { exact: true })).toBeVisible();

      const paper = page.locator('.mrp-page-holder[data-page="1"] .mr-page');
      const table = paper.locator(".mr-grid")
        .filter({ has: page.getByText("物料", { exact: true }) })
        .filter({ has: page.getByText("数量", { exact: true }) });
      await expect(table).toHaveCount(1);
      await expect(table.locator("tr").first().locator("td")).toHaveText(["物料", "数量"]);
      const paperBox = (await paper.boundingBox())!;
      const tableBox = (await table.boundingBox())!;
      const cellWidths = await table.locator("tr").first().locator("td").evaluateAll(
        (cells) => cells.map((cell) => cell.getBoundingClientRect().width)
      );
      expect(Math.abs(cellWidths[0]! - cellWidths[1]!)).toBeLessThan(1);
      expect(tableBox.width / paperBox.width).toBeGreaterThan(0.85);
      expect(tableBox.x).toBeGreaterThan(paperBox.x);
      expect(tableBox.x + tableBox.width).toBeLessThan(paperBox.x + paperBox.width);

      const indicator = page.locator(".mrp-pageinfo");
      const total = Number((await indicator.textContent())!.split("/")[1]!.trim());
      expect(total).toBeGreaterThan(1);
      await expect(page.locator(".report-status")).toHaveText(`共 ${total} 页`);
      const exportButton = page.getByRole("button", { name: "导出 PDF（前端直出）" });
      await expect(exportButton).toBeEnabled();
      const downloadPromise = page.waitForEvent("download", {
        predicate: (download) => download.suggestedFilename() === "mach-report.pdf",
        timeout: 30000
      });
      await exportButton.click();
      await expect(exportButton).toBeDisabled();
      releaseFont();
      const download = await downloadPromise;
      expect(await download.failure()).toBeNull();
      await expect(exportButton).toBeEnabled();
      await expect(page.locator(".report-status")).toHaveText(`共 ${total} 页`);
    } finally {
      releaseFont();
    }
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

  test("Ctrl+滚轮缩放与键盘翻页", async ({ page }) => {
    await page.goto("http://localhost:8610");
    await expect(page.getByText("产品出库单")).toBeVisible({ timeout: 10000 });
    const inner = page.locator(".mrp-scale-inner");
    const before = await inner.evaluate((el) => (el as HTMLElement).style.transform);
    await page.locator(".mrp-body").click();
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -120);
    await page.keyboard.up("Control");
    await expect
      .poll(async () => inner.evaluate((el) => (el as HTMLElement).style.transform))
      .not.toBe(before);
    await page.keyboard.press("PageDown");
    await expect(page.locator(".mrp-pageinfo")).toHaveText(/2 \/ \d+/);
  });

  test("预览搜索：命中跳页并高亮", async ({ page }) => {
    await page.goto("http://localhost:8610");
    await expect(page.getByText("产品出库单")).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: "🔍" }).click();
    // 出库单数据里有"钢"字物料；输入后应出现命中计数与高亮标记
    await page.locator(".mrp-search-input").fill("钢");
    await expect(page.locator(".mrp-search-count")).toHaveText(/\d+\/\d+/, { timeout: 5000 });
    await expect(page.locator("mark.mrp-hit").first()).toBeVisible({ timeout: 5000 });
  });

  test("参数面板：声明式查询条件 + 查询刷新", async ({ page }) => {
    await page.goto("http://localhost:8610");
    await expect(page.getByText("产品出库单")).toBeVisible({ timeout: 10000 });
    // 面板按 paramDefs 自动渲染（select + date）
    const panel = page.locator(".mrp-params");
    await expect(panel).toBeVisible();
    await expect(page.locator(".mrp-param")).toHaveCount(2);
    // 切换仓库 → 查询 → 内容仍在（reload 成功，页面不报错）
    await page.locator(".mrp-params select").selectOption("W1");
    await page.getByRole("button", { name: "查 询" }).click();
    await expect(page.getByText("产品出库单")).toBeVisible({ timeout: 10000 });
    // 重置恢复默认
    await page.getByRole("button", { name: "重 置" }).click();
    await expect(page.locator(".mrp-params select")).toHaveValue("ALL");
  });

  test("导出图片与 Word：真实下载事件（出口矩阵）", async ({ page }) => {
    await page.goto("http://localhost:8610");
    await expect(page.getByText("产品出库单")).toBeVisible({ timeout: 10000 });
    // PNG：每页一张（多页连续到达，用谓词精确等待）
    const pngPromise = page.waitForEvent("download", {
      predicate: (d) => d.suggestedFilename().endsWith(".png"),
      timeout: 15000
    });
    await page.getByRole("button", { name: "导出图片" }).click();
    const png = await pngPromise;
    expect(png.suggestedFilename()).toMatch(/^mach-report(-page-\d+)?\.png$/);
    // Word：单个 .doc（谓词过滤，避开仍在到达的 PNG）
    const docPromise = page.waitForEvent("download", {
      predicate: (d) => d.suggestedFilename().endsWith(".doc"),
      timeout: 15000
    });
    await page.getByRole("button", { name: "导出 Word" }).click();
    const doc = await docPromise;
    expect(doc.suggestedFilename()).toBe("mach-report.doc");
  });
});
