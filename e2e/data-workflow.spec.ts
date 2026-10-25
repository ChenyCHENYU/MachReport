import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

function businessRow(page: Page, key: string): Locator {
  return page.locator('.mrp-page-holder [data-mr-component-index]').filter({ has: page.getByRole("gridcell", { name: key, exact: true }) });
}
async function openDemo(page: Page): Promise<void> {
  await page.goto("http://localhost:8610/data-tools.html");
  await expect(page.getByRole("gridcell", { name: "EAF-001", exact: true })).toBeVisible();
  await expect(page.locator(".mr-cell-data-bar")).toHaveCount(2);
  await expect(page.locator(".mrp-error")).toHaveCount(0);
}
async function audit(page: Page, info: TestInfo, name: string): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  await info.attach(`${name}-axe.json`, { body: JSON.stringify(result, null, 2), contentType: "application/json" });
  expect(result.violations.map(issue => ({ id: issue.id, impact: issue.impact, nodes: issue.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }))).toEqual([]);
}
async function openTool(page: Page, tool: "prefill" | "comparison"): Promise<Locator> {
  await page.getByRole("button", { name: "数据工具", exact: true }).click();
  await page.locator(`[data-review-tool="${tool}"]`).click();
  return page.getByRole("dialog", { name: tool === "prefill" ? "安全预填" : "业务数据对比", exact: true });
}

test("原生复合条件默认值、键盘多选和区间校验控制同一次真实报表取数", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await openDemo(page);
  await expect(page.getByRole("combobox", { name: "厂别", exact: true })).toHaveValue("烟台炼钢厂");
  await expect(page.getByRole("combobox", { name: "区域 · 2", exact: true })).toHaveValue("EAF");
  await expect(page.getByLabel("投料范围 · 最小值", { exact: true })).toHaveValue("0");
  await audit(page, info, "native-compound-defaults");
  const plants = page.getByRole("combobox", { name: "厂别", exact: true }); await plants.click();
  await plants.fill("二厂"); await plants.press("Enter"); await plants.press("Escape");
  await page.getByLabel("投料范围 · 最小值", { exact: true }).fill("100");
  await page.getByRole("button", { name: "查 询", exact: true }).click();
  await expect(page.getByRole("gridcell", { name: "EAF-002", exact: true })).toHaveCount(0);
  await expect(page.locator(".product-footer code")).toContainText('"plants":"[\\"YTS0\\",\\"YTS1\\"]"');
  await expect(page.locator(".product-footer code")).toContainText('"range":"[100,200]"');
  await page.getByRole("combobox", { name: "区域 · 2", exact: true }).selectOption("");
  await page.getByRole("button", { name: "查 询", exact: true }).click();
  await expect(page.locator(".mrp-param-error")).toHaveText("区域：请选择完整的末级路径");
  await expect(page.getByRole("combobox", { name: "区域 · 1", exact: true })).toBeFocused();
  await page.getByRole("combobox", { name: "区域 · 2", exact: true }).selectOption("EAF");
  await page.getByRole("button", { name: "查 询", exact: true }).click();
  await expect(page.locator(".mrp-param-error")).toHaveCount(0);
  await page.screenshot({ path: "/private/tmp/mach-report-data-workflow-preview.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("安全预填差异审核、原子应用和撤销，真实零与只读保持，非法填报先校验", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await openDemo(page);
  const second = businessRow(page, "EAF-002"), first = businessRow(page, "EAF-001");
  await expect(second.locator('td[data-mr-column-index="3"]')).toHaveText("0.0");
  await first.locator('td[data-mr-column-index="0"]').dblclick(); await expect(page.locator(".mrp-cell-editor")).toHaveCount(0);
  const comparison = await openTool(page, "comparison"); await comparison.getByRole("button", { name: "读取并对比", exact: true }).click();
  await expect(comparison.getByRole("columnheader", { name: "差额", exact: true })).toBeVisible();
  await expect(comparison.locator("tbody tr").filter({ hasText: "EAF-001" }).filter({ hasText: "出钢重" })).toContainText("2.4");
  await audit(page, info, "business-comparison");
  await page.screenshot({ path: "/private/tmp/mach-report-data-workflow-comparison.png", fullPage: true });
  await comparison.getByRole("button", { name: /^关闭/ }).click();
  const prefill = await openTool(page, "prefill"); await prefill.getByRole("button", { name: "读取参考数据", exact: true }).click();
  await expect(prefill.getByRole("button", { name: /应用预填.*2/ })).toBeEnabled();
  await expect(prefill.locator("tbody tr").filter({ hasText: "EAF-003" })).toContainText("保留已有值");
  await audit(page, info, "safe-prefill-review");
  await page.screenshot({ path: "/private/tmp/mach-report-data-workflow-prefill.png", fullPage: true });
  await prefill.getByRole("button", { name: /应用预填.*2/ }).click();
  await expect(page.getByTestId("save-count")).toContainText("已保存 1 批");
  await expect(prefill).toHaveCount(0);
  await expect(first.locator('td[data-mr-column-index="5"]')).toHaveText("核对称重数据");
  await expect(second.locator('td[data-mr-column-index="3"]')).toHaveText("0.0");
  await expect(businessRow(page, "EAF-003").locator('td[data-mr-column-index="5"]')).toHaveText("已复核");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.getByTestId("save-count")).toContainText("已保存 2 批");
  await expect(first.locator('td[data-mr-column-index="5"]')).toHaveText("");
  const output = first.locator('td[data-mr-column-index="3"]'); await output.dblclick();
  const editor = page.getByRole("textbox", { name: "出钢重", exact: true }); await editor.fill("999"); await editor.press("Enter");
  await expect(page.getByRole("alert")).toHaveText("出钢重不能超过投料重");
  await expect(page.locator(".mrp-cell-editor-hint")).toHaveText("出钢重不能超过投料重");
  await expect(page.getByTestId("save-count")).toContainText("已保存 2 批");
  await page.keyboard.press("Escape"); await expect(output).toHaveText("112.4");
  await page.screenshot({ path: "/private/tmp/mach-report-data-workflow-validation.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("模板原生插入图表、配置同源聚合，并修改列色阶后实际预览", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await openDemo(page); await page.getByRole("button", { name: "模板设计", exact: true }).click();
  await expect(page.locator(".mr-designer-preview")).toContainText("EAF-001");
  await page.getByRole("tab", { name: "组件", exact: true }).click();
  await page.getByRole("combobox", { name: "添加组件", exact: true }).selectOption("chart");
  const inspector = page.locator(".mr-chart-binding"); await expect(inspector).toBeVisible();
  await inspector.getByRole("combobox", { name: "分类字段", exact: true }).selectOption("shift");
  await inspector.getByRole("combobox", { name: "度量与聚合", exact: true }).first().selectOption("output");
  const series = inspector.getByRole("textbox", { name: "系列名称（可选）", exact: true }); await series.fill("出钢重"); await series.press("Tab");
  await inspector.getByLabel("图表标题", { exact: true }).fill("班别出钢 · 可设计");
  await inspector.getByLabel("图表标题", { exact: true }).press("Tab");
  await inspector.getByRole("combobox", { name: "图表", exact: true }).selectOption("line");
  for (const [label, value] of [["左侧", "10"], ["顶部", "116"], ["宽度", "180"], ["高度", "48"]] as const) {
    const dimension = page.getByRole("spinbutton", { name: label, exact: true }); await dimension.fill(value); await dimension.press("Tab");
  }
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await expect(page.locator(".mr-designer-preview").getByText("班别出钢 · 可设计", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "字段", exact: true }).click();
  await page.getByRole("button", { name: "下一字段", exact: true }).click();
  await page.getByRole("button", { name: "下一字段", exact: true }).click();
  await page.getByRole("button", { name: "下一字段", exact: true }).click();
  await page.locator("summary").filter({ hasText: "数据可视化" }).click();
  const visual = page.locator(".mr-column-visual"); await expect(visual.getByRole("checkbox", { name: "启用列可视化", exact: true })).toBeChecked();
  await visual.getByRole("combobox", { name: "呈现方式", exact: true }).selectOption("colorScale");
  await visual.getByLabel("低值颜色", { exact: true }).fill("#f0f7ff");
  await visual.getByLabel("高值颜色", { exact: true }).fill("#8bbcf1");
  await expect(page.locator(".mr-designer-preview .mr-cell-data-bar")).toHaveCount(0);
  await audit(page, info, "designer-visual-column");
  await page.screenshot({ path: "/private/tmp/mach-report-data-workflow-designer.png", fullPage: true });
  expect(errors).toEqual([]);
});
