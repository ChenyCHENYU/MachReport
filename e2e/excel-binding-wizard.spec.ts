import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
const xlsxUrl = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/xlsx.ts", import.meta.url))}`;
const coreUrl = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/index.ts", import.meta.url))}`;
async function excelFile(page: Page, large = false) {
  return Buffer.from(
    await page.evaluate(
      async ({ xlsxUrl, coreUrl, large }) => {
        const { renderPlanToXlsx } = (await import(
          /* @vite-ignore */ xlsxUrl
        )) as typeof import("../packages/mach-report/src/xlsx");
        const { paginateTemplate, createTableTemplate } = (await import(
          /* @vite-ignore */ coreUrl
        )) as typeof import("../packages/mach-report/src/index");
        const { workbook } = await renderPlanToXlsx(
          paginateTemplate(
            createTableTemplate({ columns: [{ header: "a", field: "a" }] }),
            { detail: [] },
          ).plan,
        );
        const sheet = workbook.worksheets[0]!;
        sheet.name = "生产模板";
        sheet.mergeCells("A1:C1");
        sheet.getCell("A1").value = "生产日报标题";
        sheet.getCell("A2").value = "炉号";
        sheet.getCell("B2").value = "产重";
        sheet.getCell("C2").value = "总用电量";
        sheet.getCell("A3").value = "TEMPLATE-SAMPLE";
        sheet.getCell("B3").value = 999;
        sheet.getCell("C3").value = 888;
        sheet.getCell("A4").value = "SECOND-SAMPLE";
        sheet.getCell("B4").value = 999;
        sheet.getCell("C4").value = 888;
        if (large)
          for (let row = 5; row <= 500; row++)
            for (let column = 1; column <= 36; column++)
              sheet.getCell(row, column).value = `${row}:${column}`;
        return Array.from(new Uint8Array(await workbook.xlsx.writeBuffer()));
      },
      { xlsxUrl, coreUrl, large },
    ),
  );
}
async function upload(page: Page, large = false) {
  await page.goto("http://localhost:8610/excel-binding.html");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Excel 模板",
  );
  await page
    .getByLabel("选择 Excel 模板", { exact: true })
    .setInputFiles({
      name: "生产日报.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: await excelFile(page, large),
    });
  await expect(page.locator(".mr-binding-grid")).toBeVisible();
}
async function region(page: Page, from: number, to: number, label: string) {
  await page
    .getByRole("button", { name: `选择源行 ${from}`, exact: true })
    .click();
  if (to !== from)
    await page
      .getByRole("button", { name: `选择源行 ${to}`, exact: true })
      .click({ modifiers: ["Shift"] });
  await page
    .getByRole("button", { name: `标记选中行 · ${label}`, exact: true })
    .click();
}
test("Excel graphical binding removes samples, preserves zero/precision, reopens the recipe, and honors read-only", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await upload(page);
  const apply = page.getByRole("button", {
    name: "校验并使用模板",
    exact: true,
  });
  await expect(apply).toBeDisabled();
  await region(page, 1, 1, "标题");
  await region(page, 2, 2, "多层表头");
  await region(page, 3, 4, "样例明细");
  await page
    .getByLabel("业务数据集", { exact: true })
    .selectOption("production");
  await page.getByLabel("稳定业务主键", { exact: true }).selectOption("heat");
  await page
    .getByLabel("Excel 列 A · 业务字段", { exact: true })
    .selectOption("heat");
  await page
    .getByLabel("Excel 列 B · 业务字段", { exact: true })
    .selectOption("weight");
  await page
    .getByLabel("Excel 列 C · 业务字段", { exact: true })
    .selectOption("energy");
  await expect(page.locator(".mr-binding-actions")).toContainText(
    "绑定校验通过",
  );
  await expect(page.locator(".mr-binding-mappings")).toContainText(
    "number · kg · 3位小数 · 契约样例: 0",
  );
  await apply.click();
  await expect(page.locator(".binding-result")).toContainText("LIVE-001");
  await expect(page.locator(".binding-result")).toContainText("0.000");
  await expect(page.locator(".binding-result")).toContainText("64200.125");
  await expect(page.locator(".binding-result")).not.toContainText(
    "TEMPLATE-SAMPLE",
  );
  await page
    .getByLabel("Excel 列 A · 业务字段", { exact: true })
    .selectOption("");
  await expect(apply).toBeDisabled();
  await page
    .getByRole("button", { name: "恢复已保存绑定", exact: true })
    .click();
  await expect(
    page.getByLabel("Excel 列 A · 业务字段", { exact: true }),
  ).toHaveValue("heat");
  await page.getByLabel("只读模式", { exact: true }).check();
  await expect(apply).toBeDisabled();
  await expect(
    page.getByLabel("Excel 列 A · 业务字段", { exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "更换文件", exact: true }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});
test("a large source only mounts a bounded 24×12 window and supports keyboard range selection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await upload(page, true);
  expect(await page.locator(".mr-binding-grid td").count()).toBeLessThanOrEqual(
    24 * 12,
  );
  await page.getByLabel("预览起始行", { exact: true }).fill("450");
  await page.getByLabel("预览起始行", { exact: true }).press("Tab");
  await expect(
    page.getByRole("button", { name: "选择源行 450", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "选择源行 450", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(
    page.getByRole("button", { name: "选择源行 451", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "标记选中行 · 样例明细", exact: true })
    .click();
  await expect(
    page.locator('.mr-binding-region[data-role="detail"]'),
  ).toContainText("A450:AJ451");
  await page.getByLabel("预览起始列", { exact: true }).fill("25");
  await page.getByLabel("预览起始列", { exact: true }).press("Tab");
  await expect(page.locator(".mr-binding-grid thead")).toContainText("Y");
  expect(await page.locator(".mr-binding-grid td").count()).toBeLessThanOrEqual(
    24 * 12,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
});

test("same-Sheet record and repeat regions are selected, mapped, applied and reopened through the product UI", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await upload(page);
  await page.getByRole("button", { name: "多区域绑定", exact: true }).click();
  const panel = page.locator(".mr-binding-multi");
  async function createRegion(row: number, dataset: string, mode: "record" | "repeat"): Promise<void> {
    await page.locator(`td[data-source-cell="${row}:1"]`).click();
    await page.locator(`td[data-source-cell="${row}:3"]`).click({ modifiers: ["Shift"] });
    await panel.getByRole("button", { name: /^创建区域/ }).click();
    await panel.getByLabel("填充方式", { exact: true }).selectOption(mode);
    await panel.getByLabel("业务数据集", { exact: true }).selectOption(dataset);
    await panel.getByLabel("稳定业务主键", { exact: true }).selectOption("heat");
    for (const [column, field] of [["A", "heat"], ["B", "weight"], ["C", "energy"]]) await panel.getByLabel(`Excel 列 ${column} · 业务字段`, { exact: true }).selectOption(field!);
  }
  await createRegion(3, "summary", "record"); await createRegion(4, "production", "repeat");
  await expect(panel.locator(".mr-binding-region-entry")).toHaveCount(2);
  await page.getByRole("button", { name: "校验并使用模板", exact: true }).click();
  await expect(page.locator(".binding-result")).toContainText("SUMMARY-01");
  await expect(page.locator(".binding-result")).toContainText("LIVE-001");
  await expect(page.locator(".binding-result")).toContainText("64200.125");
  await expect(page.locator(".binding-result")).not.toContainText("SAMPLE");
  await panel.getByLabel("Excel 列 A · 业务字段", { exact: true }).selectOption("");
  await page.getByRole("button", { name: "恢复已保存绑定", exact: true }).click();
  await expect(panel.locator(".mr-binding-region-entry")).toHaveCount(2);
  await expect(panel.getByLabel("Excel 列 A · 业务字段", { exact: true })).toHaveValue("heat");
  await testInfo.attach("excel-regions-workbench.png", { body: await page.screenshot(), contentType: "image/png" });
  expect(errors).toEqual([]);
});
