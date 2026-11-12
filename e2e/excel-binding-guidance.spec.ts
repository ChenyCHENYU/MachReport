import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

async function mountRegionGuidance(page: Page) {
  await page.goto("http://localhost:8610");
  await expect(page.getByText("产品出库单")).toBeVisible();
  await page.evaluate(async ({ core, designer }) => {
    const source = await fetch("/src/main.ts").then(response => response.text());
    const vueUrl = source.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)?.[1];
    if (!vueUrl) throw new Error("Missing shared Vue runtime");
    const { createApp, h } = await import(vueUrl) as typeof import("vue");
    const { createTableTemplate } = await import(core) as typeof import("../packages/mach-report/src/index");
    const { ExcelBindingWizard } = await import(designer) as typeof import("../packages/mach-report/src/designer");
    const fields = [
      { field: "id", type: "text" as const },
      { field: "weight", type: "number" as const },
      ...Array.from({ length: 11 }, (_, index) => ({ field: `f${index + 2}`, type: "number" as const })),
    ];
    const template = createTableTemplate({ columns: [{ header: "编号", field: "id" }] });
    template.pages = [{
      widthMm: 780, heightMm: 300, layout: "wide",
      components: [{ kind: "rect", leftMm: 0, topMm: 0, widthMm: 780, heightMm: 240,
        meta: { xlsxSheet: "日报", xlsxRange: "A1:Z40" },
        grid: { colWidthsMm: Array(26).fill(30), rowHeightsMm: Array(40).fill(6),
          cells: Array.from({ length: 40 }, (_, row) => Array.from({ length: 26 }, (_, column) => ({ text: `${row + 1}:${column + 1}` }))),
        },
      }],
    }];
    const session = {
      version: "2.0" as const, identity: { id: "guided-regions", name: "多区域定位验收" },
      source: { warnings: [], template, sheets: [{ name: "日报", index: 1, range: "A1:Z40", rowCount: 40, columnCount: 26, pageStart: 0, pageCount: 1 }] },
      recipe: { version: "2.0" as const, sheet: "日报", regions: [
        { id: "production", range: "A3:B3", mode: "record" as const, dataset: "rows", rowKey: "id", fields: ["id", "weight"] },
        { id: "cost", range: "M30:Y30", mode: "record" as const, dataset: "rows", rowKey: "", fields: fields.map((field, index) => index === 12 ? "" : field.field) },
      ] },
    };
    const target = document.createElement("div");
    target.id = "excel-guidance-fixture";
    target.style.cssText = "position:fixed;inset:16px;z-index:9999;background:white;overflow:hidden";
    document.body.append(target);
    createApp({ render: () => h(ExcelBindingWizard, { datasets: [{ id: "rows", fields }], session }) }).mount(target);
  }, {
    core: `/@fs${fileURLToPath(new URL("../packages/mach-report/src/index.ts", import.meta.url))}`,
    designer: `/@fs${fileURLToPath(new URL("../packages/mach-report/src/designer.ts", import.meta.url))}`,
  });
  return page.locator("#excel-guidance-fixture");
}

test("multi-region diagnostics locate the 13th mapping and row key across bounded windows without manual path matching", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const root = await mountRegionGuidance(page);
  const directory = root.locator(".mr-binding-region-entry");
  await expect(directory).toHaveCount(2);
  await expect(directory.nth(0)).toHaveAttribute("data-state", "ready");
  await expect(directory.nth(1)).toHaveAttribute("data-state", "pending");
  await expect(root.getByRole("button", { name: "校验并使用模板", exact: true })).toBeDisabled();
  await root.getByRole("button", { name: "校验绑定", exact: true }).click();
  await expect(root.locator(".mr-binding-issues")).not.toContainText("$.recipe");
  await root.getByRole("button", { name: "定位并修正 · cost · 逐列映射 Y", exact: true }).click();
  await expect(directory.nth(1)).toHaveClass(/is-active/);
  await expect(root.getByLabel("预览起始行", { exact: true })).toHaveValue("30");
  await expect(root.getByLabel("预览起始列", { exact: true })).toHaveValue("25");
  await expect(root.locator('td[data-source-cell="30:25"]')).toHaveClass(/is-cell-selected/);
  const panel = root.locator(".mr-binding-multi");
  await expect(panel.locator(".mr-binding-map-pages")).toContainText("2/2");
  await expect(panel.locator(".mr-binding-map")).toHaveCount(1);
  const mapping = panel.getByRole("combobox", { name: "Excel 列 Y · 业务字段", exact: true });
  await expect(mapping).toBeFocused();
  await testInfo.attach("mapping-focus-layout.json", { body: JSON.stringify(await mapping.evaluate(element => {
    const ancestors = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const box = node.getBoundingClientRect(), style = getComputedStyle(node);
      ancestors.push({ tag: node.tagName, class: node.className, box: box.toJSON(), clientHeight: node.clientHeight, scrollHeight: node.scrollHeight, scrollTop: node.scrollTop, overflow: [style.overflowX, style.overflowY], padding: style.padding, flex: style.flex, minHeight: style.minHeight });
    }
    return ancestors;
  }), null, 2), contentType: "application/json" });
  await root.screenshot({ path: testInfo.outputPath("mapping-focus-layout.png") });
  await expect(mapping).toBeInViewport({ ratio: 1 });
  const popup = panel.locator(".mr-field-popup");
  await expect(popup).toHaveClass(/is-above/);
  await expect(popup).toBeInViewport({ ratio: 1 });
  const popupBounds = await popup.boundingBox(), inspectorBounds = await root.locator(".mr-binding-inspector").boundingBox();
  expect(popupBounds!.y).toBeGreaterThanOrEqual(inspectorBounds!.y);
  expect(popupBounds!.y + popupBounds!.height).toBeLessThanOrEqual(inspectorBounds!.y + inspectorBounds!.height);
  await mapping.press("End");
  const finalOption = popup.getByRole("option").last();
  await expect(finalOption).toContainText("f12");
  await expect(finalOption).toBeInViewport({ ratio: 1 });
  await root.screenshot({ path: testInfo.outputPath("mapping-popup-above.png") });
  expect(await root.locator(".mr-binding-grid td").count()).toBeLessThanOrEqual(24 * 12);
  await finalOption.click();
  await expect(mapping).toHaveValue("f12");
  await expect(directory.nth(1)).toHaveAttribute("data-state", "pending");
  // Moving elsewhere before the second issue ensures row-key navigation truly changes the active region.
  await directory.nth(0).getByRole("button").first().click();
  await expect(directory.nth(0)).toHaveClass(/is-active/);
  await expect(root.getByLabel("预览起始行", { exact: true })).toHaveValue("3");
  await root.getByRole("button", { name: "校验绑定", exact: true }).click();
  await root.getByRole("button", { name: "定位并修正 · cost · 稳定业务主键", exact: true }).click();
  await expect(directory.nth(1)).toHaveClass(/is-active/);
  await expect(root.getByLabel("预览起始行", { exact: true })).toHaveValue("30");
  await expect(root.getByLabel("预览起始列", { exact: true })).toHaveValue("13");
  const rowKey = panel.getByRole("combobox", { name: "稳定业务主键", exact: true });
  await expect(rowKey).toBeFocused();
  await expect(rowKey).toBeInViewport({ ratio: 1 });
  await rowKey.fill("id"); await rowKey.press("Tab");
  await expect(directory.nth(1)).toHaveAttribute("data-state", "ready");
  await expect(root.locator(".mr-binding-actions")).toContainText("绑定校验通过");
  await expect(root.getByRole("button", { name: "校验并使用模板", exact: true })).toBeEnabled();
  await testInfo.attach("excel-region-guidance.png", { body: await root.screenshot(), contentType: "image/png" });
  expect(errors).toEqual([]);
});
