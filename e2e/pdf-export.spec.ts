import { expect, test } from "@playwright/test";

test.describe("PDF 前端直出", () => {
  test("点击导出 PDF 触发下载且为合法 PDF", async ({ page }) => {
    await page.goto("http://localhost:8610");
    await expect(page.getByText("产品出库单")).toBeVisible({ timeout: 10000 });

    const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
    await page.getByRole("button", { name: "导出 PDF（前端直出）" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("mach-report.pdf");

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);
    expect(buffer.length).toBeGreaterThan(5000);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("预览工具栏导出真正的 Excel 工作簿", async ({ page }) => {
    test.setTimeout(90000);
    await page.goto("http://localhost:8610");
    await expect(page.getByText("产品出库单")).toBeVisible({ timeout: 10000 });
    const downloadPromise = page.waitForEvent("download", { timeout: 70000 });
    await page.getByRole("button", { name: "导出 Excel" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("mach-report.xlsx");
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const buffer = Buffer.concat(chunks);
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 2).toString()).toBe("PK");
  });

  test("PDF 窗口打开 PDF 文件而非 HTML 打印页", async ({ page }) => {
    await page.goto("http://localhost:8610");
    await expect(page.getByText("产品出库单")).toBeVisible({ timeout: 10000 });
    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("button", { name: "PDF 窗口" }).click();
    const popup = await popupPromise;
    const viewer = popup.locator('iframe[title="PDF 预览"]');
    await expect(viewer).toHaveAttribute("src", /^blob:/, { timeout: 30000 });
    const url = await viewer.getAttribute("src");
    const result = await page.evaluate(async (url) => {
      const response = await fetch(url);
      const bytes = new Uint8Array(await response.arrayBuffer());
      return { type: response.headers.get("content-type"), magic: String.fromCharCode(...bytes.slice(0, 5)) };
    }, url!);
    expect(result.type).toContain("application/pdf");
    expect(result.magic).toBe("%PDF-");
    await popup.close();
  });
});
