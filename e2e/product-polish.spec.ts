import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import type { MachReportController } from "../packages/mach-report/src/vue/controller";

declare global {
  interface Window { mrPolishFixture: { snapshot(): string; changes(): unknown[] } }
}

async function mountReadOnlyFixture(page: Page): Promise<void> {
  await page.goto("http://localhost:8610");
  await expect(page.getByText("产品出库单")).toBeVisible();
  const sourceUrl = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/index.ts", import.meta.url))}`;
  await page.evaluate(async (sourceUrl) => {
    const source = await fetch("/src/main.ts").then((response) => response.text());
    const vueUrl = source.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)?.[1];
    const reportUrl = source.match(/from ["']([^"']*mach-report\/src\/vue\/index\.ts[^"']*)["']/)?.[1];
    if (!vueUrl || !reportUrl) throw new Error("Missing example runtime URLs");
    const { createApp, h, nextTick, shallowRef } = await import(vueUrl) as typeof import("vue");
    const { ReportPreview } = await import(reportUrl) as typeof import("../packages/mach-report/src/vue/index");
    const { createTableTemplate, paginateTemplate } = await import(sourceUrl) as typeof import("../packages/mach-report/src/index");
    const template = createTableTemplate({ title: "只读选区分析", layout: "wide", columns: [
      { header: "炉号", field: "heat", widthMm: 35 },
      { header: "产重（吨）", field: "weight", widthMm: 40, align: "right", format: { kind: "number", digits: 2 } }
    ] });
    const { plan } = paginateTemplate(template, { detail: [{ heat: "22W418", weight: 12.5 }, { heat: "22W419", weight: 7.5 }] });
    const controller = shallowRef<MachReportController | null>(null);
    window.mrPolishFixture = {
      snapshot: () => { const current = controller.value?.getPlan(); if (!current) throw new Error("Fixture report is not ready"); return JSON.stringify(current); },
      changes: () => { if (!controller.value?.getChanges) throw new Error("Missing change inspection API"); return controller.value.getChanges(); }
    };
    const target = document.createElement("div"); target.id = "polish-fixture"; target.style.cssText = "position:fixed;inset:0;z-index:9999"; document.body.append(target);
    await new Promise<void>((resolve) => {
      createApp({ render: () => h(ReportPreview, { ref: controller, reportId: "polish", fetcher: async () => plan, height: "100vh", editable: false,
        showExport: false, showPrint: false, showPdfWindow: false, onLoaded: async () => { await nextTick(); requestAnimationFrame(() => resolve()); }
      }) }).mount(target);
    });
  }, sourceUrl);
}

test("分页在真实视口右下，跳页校验与窄屏工具栏均可用", async ({ page }, testInfo) => {
  await page.goto("http://localhost:8610");
  await expect(page.getByText("产品出库单")).toBeVisible();
  const root = page.locator(".mach-report-preview");
  const footer = root.locator(".mrp-footer"), pagination = root.getByRole("navigation", { name: "报表分页", exact: true });
  await expect(pagination).toBeVisible();
  await expect(root.locator(".mrp-toolbar .mrp-pageinfo")).toHaveCount(0);
  const shellBox = (await root.boundingBox())!, footerBox = (await footer.boundingBox())!, pagerBox = (await pagination.boundingBox())!;
  expect(Math.abs(footerBox.y + footerBox.height - (shellBox.y + shellBox.height))).toBeLessThanOrEqual(2);
  expect(Math.abs(pagerBox.x + pagerBox.width - (shellBox.x + shellBox.width))).toBeLessThanOrEqual(2);
  expect(pagerBox.x).toBeGreaterThan(shellBox.x + shellBox.width / 2);
  const exportMenu = root.getByRole("button", { name: "导出", exact: true });
  await exportMenu.press("ArrowDown");
  const formats = root.getByRole("menuitem");
  await expect(formats).toHaveCount(5); await expect(formats.first()).toBeFocused();
  await formats.first().press("End"); await expect(formats.last()).toBeFocused();
  await formats.last().press("Escape"); await expect(formats).toHaveCount(0); await expect(exportMenu).toBeFocused();
  const indicator = pagination.locator(".mrp-pageinfo");
  const total = Number((await indicator.textContent())!.split("/")[1]!.trim());
  expect(total).toBeGreaterThan(2);
  const jump = pagination.getByRole("textbox", { name: "跳至页", exact: true });
  await jump.fill("0"); await jump.press("Enter");
  await expect(pagination.getByRole("alert")).toHaveText("请输入有效页码");
  await expect(indicator).toHaveText(`1 / ${total}`);
  await jump.fill(String(total)); await jump.press("Enter");
  await expect(indicator).toHaveText(`${total} / ${total}`);
  await expect(pagination.getByRole("button", { name: "下一页 ›", exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("product-controls-1440.png"), fullPage: true });
  await page.setViewportSize({ width: 1024, height: 800 });
  const toolbar = root.getByRole("toolbar"), bounds = (await toolbar.boundingBox())!;
  for (const button of await toolbar.getByRole("button").all()) {
    const box = await button.boundingBox(); if (!box) continue;
    expect(box.x).toBeGreaterThanOrEqual(bounds.x);
    expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
  }
  await page.screenshot({ path: testInfo.outputPath("product-controls-1024.png"), fullPage: true });
});

test("内容搜索与字段目录可全键盘导航，清空及Escape保持焦点", async ({ page }, testInfo) => {
  await mountReadOnlyFixture(page);
  const root = page.locator("#polish-fixture");
  const searchToggle = root.getByRole("button", { name: "内容搜索", exact: true });
  await searchToggle.click();
  const search = root.getByRole("textbox", { name: "内容搜索", exact: true });
  await expect(search).toBeFocused();
  await search.fill("22W"); await expect(root.locator(".mrp-search-count")).toHaveText("1/2");
  await search.press("Enter"); await expect(root.locator(".mrp-search-count")).toHaveText("2/2");
  await search.press("Shift+Enter"); await expect(root.locator(".mrp-search-count")).toHaveText("1/2");
  await root.getByRole("button", { name: "清除搜索", exact: true }).click();
  await expect(search).toHaveValue(""); await expect(search).toBeFocused();
  await search.fill("不存在的内容"); await expect(root.locator(".mrp-search-hint")).toHaveText("没有匹配内容");
  await search.press("Escape"); await expect(search).toHaveCount(0); await expect(searchToggle).toBeFocused();
  const directoryToggle = root.locator(".mrp-directory-trigger"); await directoryToggle.click();
  const field = root.getByRole("combobox", { name: "搜索列名或字段", exact: true });
  await expect(field).toBeFocused();
  await field.press("ArrowDown"); await expect(root.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");
  await field.press("ArrowUp"); await expect(root.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await field.fill("weight");
  await expect(root.getByRole("option")).toHaveCount(1);
  await expect(root.getByRole("option")).toContainText("产重（吨）");
  await page.screenshot({ path: testInfo.outputPath("field-directory.png"), fullPage: true });
  await field.press("Escape"); await expect(root.locator(".mrp-column-directory")).toHaveCount(0); await expect(directoryToggle).toBeFocused();
  await directoryToggle.click(); await field.fill("产重"); await field.press("Enter");
  await expect(root.locator(".mrp-cell-focus")).toHaveText("产重（吨）");
  await expect(directoryToggle).toBeFocused();
});

test("只读报表默认关闭高级计算，显式启用后求和/组合公式/除零均不改写Plan", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await mountReadOnlyFixture(page);
  const root = page.locator("#polish-fixture");
  const before = await page.evaluate(() => window.mrPolishFixture.snapshot());
  await expect(root.locator(".mrp-calculation-toggle")).toHaveCount(0);
  await root.getByRole("button", { name: "设置", exact: true }).click();
  const dialog = root.getByRole("dialog", { name: "设置", exact: true });
  await dialog.getByRole("tab", { name: "高级", exact: true }).click();
  const enabled = dialog.getByRole("checkbox", { name: /启用选区计算/ });
  await expect(enabled).not.toBeChecked(); await enabled.check();
  await expect(dialog.getByText("仅本地分析，不写回实绩、不重算原公式。请选取同一单位与量纲的数值。", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "关闭设置", exact: true }).click();
  const cells = root.locator('td[data-mr-column-index="1"]').filter({ hasText: /^\d+\.\d+$/ });
  await expect(cells).toHaveCount(2);
  await cells.first().click(); await cells.last().click({ modifiers: ["Shift"] });
  await expect(root.locator(".mrp-cell-selected")).toHaveCount(2);
  await cells.first().dblclick(); await expect(root.locator(".mrp-cell-editor")).toHaveCount(0);
  // Double click updates the anchor. Re-select the two numeric cells before calculation.
  await cells.first().click(); await cells.last().click({ modifiers: ["Shift"] });
  await root.getByRole("button", { name: "选区计算", exact: true }).click();
  await dialog.getByRole("button", { name: "计算选区", exact: true }).click();
  await expect(dialog.locator("output")).toHaveText("20.00");
  await expect(dialog.locator(".mrp-calculation-result")).toContainText("参与数值 2");
  await expect(dialog.getByRole("combobox")).toHaveAccessibleName("计算方式");
  await dialog.getByRole("combobox", { name: "计算方式", exact: true }).selectOption("expression");
  await dialog.getByRole("textbox", { name: "组合公式", exact: true }).fill("SUM / COUNT + 3");
  await dialog.getByRole("button", { name: "计算选区", exact: true }).click();
  await expect(dialog.locator("output")).toHaveText("13.00");
  await dialog.getByRole("textbox", { name: "组合公式", exact: true }).fill("SUM / (COUNT - COUNT)");
  await dialog.getByRole("button", { name: "计算选区", exact: true }).click();
  await expect(dialog.locator(".mrp-calculation-diagnostic")).toHaveText("除数不能为 0。");
  await expect(dialog.locator("output")).toHaveCount(0);
  expect(await page.evaluate(() => window.mrPolishFixture.snapshot())).toBe(before);
  expect(await page.evaluate(() => window.mrPolishFixture.changes())).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("advanced-calculation.png"), fullPage: true });
});
