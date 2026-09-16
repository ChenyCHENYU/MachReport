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
});
