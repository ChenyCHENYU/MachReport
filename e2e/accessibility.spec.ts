import { expect, test, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function audit(page: Page, info: TestInfo, name: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  await info.attach(`${name}-axe.json`, { body: JSON.stringify(results, null, 2), contentType: "application/json" });
  expect(results.violations.map(issue => ({ id: issue.id, impact: issue.impact, help: issue.help, nodes: issue.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }))).toEqual([]);
}

test("预览、搜索、目录及设置的真实可访问树与WCAG自动检查", async ({ page }, info) => {
  await page.goto("http://localhost:8610");
  await expect(page.getByText("产品出库单")).toBeVisible();
  await audit(page, info, "preview");
  await page.getByRole("button", { name: "内容搜索", exact: true }).click();
  await audit(page, info, "search");
  await page.keyboard.press("Escape");
  await page.locator(".mrp-directory-trigger").click();
  await audit(page, info, "directory");
  await page.keyboard.press("Escape");
  const settings = page.getByRole("button", { name: "设置", exact: true });
  await settings.focus(); await settings.press("Enter");
  const dialog = page.getByRole("dialog", { name: "设置", exact: true });
  await expect(dialog).toBeVisible(); await audit(page, info, "settings");
  await page.keyboard.press("Escape"); await expect(settings).toBeFocused();
});

test("设计器各工具上下文保留名称、标签关联及键盘焦点", async ({ page }, info) => {
  await page.goto("http://localhost:8610/designer.html");
  await expect(page.locator(".mr-designer-preview")).toContainText("000418");
  await audit(page, info, "designer");
  for (const name of ["组件", "模板", "工具", "高级"]) {
    const tab = page.getByRole("tab", { name, exact: true });
    await tab.click(); await expect(tab).toHaveAttribute("aria-selected", "true");
    await audit(page, info, `designer-${name}`);
  }
});

test("远程参数加载、选项和提交错误均可被辅助技术识别", async ({ page }, info) => {
  await page.goto("http://localhost:8610/parameters.html");
  const area = page.getByRole("combobox", { name: "区域", exact: true });
  await expect(area).toBeVisible();
  await audit(page, info, "parameters");
  await area.click(); await expect(page.getByRole("option", { name: /一厂 · 炼钢区域/ })).toBeVisible();
  await audit(page, info, "parameter-options");
  await area.press("Escape"); await expect(area).toBeFocused();
  await page.getByRole("button", { name: "查 询", exact: true }).click();
  await expect(area).toHaveAttribute("aria-invalid", "true");
  await audit(page, info, "parameter-error");
});
