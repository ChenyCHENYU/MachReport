import { expect, test, type Page } from "@playwright/test";
import type {
  ListComponent,
  ReportTemplateDocument,
} from "../packages/mach-report/src/index";

test("列搜索与批量对齐可一次撤销，默认恢复确认保留未应用 JSON", async ({
  page,
}) => {
  await page.goto("http://localhost:8610/designer.html");
  await expect(page.locator(".mr-designer-preview")).toContainText("000418");
  await page.locator(".mr-designer-field-trigger").click();
  await page.getByLabel("搜索列名或字段").fill("weight");
  await expect(page.locator("fieldset")).toHaveCount(1);
  await expect(page.getByLabel("表头", { exact: true })).toHaveValue("炉号");
  await expect(page.locator(".mr-designer-column-row")).toHaveCount(1);
  await page.getByRole("button", { name: "选择当前结果", exact: true }).click();
  await page.getByLabel("批量正文对齐", { exact: true }).selectOption("center");
  await expect(
    page
      .locator(".mr-designer-preview td")
      .filter({ hasText: /^64200(?:\.0+)?$/ })
      .first(),
  ).toHaveCSS("text-align", "center");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(
    page
      .locator(".mr-designer-preview td")
      .filter({ hasText: /^64200(?:\.0+)?$/ })
      .first(),
  ).toHaveCSS("text-align", "right");
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(
    page
      .locator(".mr-designer-preview td")
      .filter({ hasText: /^64200(?:\.0+)?$/ })
      .first(),
  ).toHaveCSS("text-align", "center");
  await page.getByRole("tab", { name: "高级", exact: true }).click();
  await page.getByLabel("完整模板 JSON", { exact: true }).fill("{正在输入");
  await expect(
    page.getByRole("button", { name: "保存草稿", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "恢复草稿", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "保留当前修改？" });
  await expect(
    dialog.getByRole("button", { name: "继续编辑", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("完整模板 JSON", { exact: true })).toHaveValue(
    "{正在输入",
  );
  await page.getByRole("button", { name: "恢复草稿", exact: true }).click();
  await dialog
    .getByRole("button", { name: "丢弃修改并继续", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "恢复草稿", exact: true }),
  ).toBeDisabled();
  await expect(
    page
      .locator(".mr-designer-preview td")
      .filter({ hasText: /^64200(?:\.0+)?$/ })
      .first(),
  ).toHaveCSS("text-align", "right");
});

async function openTools(page: Page, name: string) {
  await page.getByRole("tab", { name: "工具", exact: true }).click();
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
  const panels: Record<string, string> = {
    结构大纲: ".mr-outline",
    片段与样式: '.mr-product-panel[aria-label="片段与样式"]',
    发布检查: ".mr-template-review",
  };
  const selector = panels[name];
  if (selector) await expect(page.locator(selector)).toBeVisible();
  await expect(
    page.locator(".mr-designer-tool-content .mr-binding"),
  ).toBeHidden();
}
async function currentDocument(page: Page): Promise<ReportTemplateDocument> {
  await page.getByRole("tab", { name: "高级", exact: true }).click();
  return JSON.parse(
    await page.getByLabel("完整模板 JSON", { exact: true }).inputValue(),
  ) as ReportTemplateDocument;
}
async function assertContained(page: Page) {
  const layout = await page.locator(".mr-designer").evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
    body: document.body.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(layout.scroll).toBeLessThanOrEqual(layout.client + 1);
  expect(layout.body).toBeLessThanOrEqual(layout.viewport + 1);
}

test("结构大纲跨页定位，改名先展示公式引用并守卫保存", async ({ page }) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await page.goto("http://localhost:8610/designer.html");
  await expect(page.locator(".mr-designer-preview")).toContainText("000418");
  const document = await currentDocument(page);
  const list = document.template.pages[0]!.components.find(
    (component) => component.kind === "list",
  ) as ListComponent;
  list.computed = [{ field: "energy_copy", expression: { field: "energy" } }];
  document.template.pages.push({
    widthMm: 210,
    heightMm: 297,
    meta: { title: "验收附页" },
    components: [
      {
        kind: "text",
        leftMm: 10,
        topMm: 10,
        widthMm: 100,
        heightMm: 10,
        text: "跨页定位验证",
      },
    ],
  });
  await page
    .getByLabel("完整模板 JSON", { exact: true })
    .fill(JSON.stringify(document));
  await page
    .getByRole("button", { name: "校验并应用 JSON", exact: true })
    .click();
  await openTools(page, "结构大纲");
  await page.getByPlaceholder("搜索版面、组件、字段或引用").fill("验收附页");
  await page.locator(".mr-outline-tree button").click();
  await expect(page.locator(".mr-canvas-sheet-info strong")).toHaveText(
    "验收附页",
  );
  await expect(page.locator(".mr-canvas-content")).toContainText(
    "跨页定位验证",
  );
  await openTools(page, "结构大纲");
  await page.getByPlaceholder("搜索版面、组件、字段或引用").fill("energy");
  await page
    .locator(".mr-outline-tree button")
    .filter({ hasText: "总用电量 (kWh) · energy" })
    .click();
  await expect(page.locator(".mr-outline")).toBeVisible();
  await page.getByRole("tab", { name: "字段", exact: true }).click();
  await page.getByLabel("业务字段", { exact: true }).fill("energy_new");
  await page.getByLabel("业务字段", { exact: true }).press("Tab");
  const impact = page.getByRole("alertdialog", {
    name: "确认字段映射变化",
    exact: true,
  });
  await expect(impact).toContainText("computed[0].expression.field");
  await expect(
    page.getByRole("button", { name: "保存草稿", exact: true }),
  ).toBeDisabled();
  await impact.getByRole("button", { name: "取消", exact: true }).click();
  const checked = await currentDocument(page);
  const checkedList = checked.template.pages[0]!.components.find(
    (component) => component.kind === "list",
  ) as ListComponent;
  expect(
    checkedList.columns.find((column) => column.field === "energy"),
  ).toBeDefined();
  expect(checkedList.computed![0]!.expression).toEqual({ field: "energy" });
  expect(failures).toEqual([]);
});

test("共享片段独立插入，内容样式实际改变表头且正文数据不变", async ({
  page,
}) => {
  await page.goto("http://localhost:8610/designer.html");
  await expect(page.locator(".mr-designer-preview")).toContainText("000418");
  await openTools(page, "片段与样式");
  await expect(
    page
      .getByRole("combobox")
      .filter({ has: page.locator('option[value="report-heading"]') }),
  ).toHaveCount(1);
  await expect(
    page
      .getByRole("combobox")
      .filter({ has: page.locator('option[value="report-heading"]') }),
  ).toHaveValue("report-heading");
  await expect(
    page
      .getByRole("combobox")
      .filter({ has: page.locator('option[value="brand-header"]') }),
  ).toHaveValue("brand-header");
  await page.getByRole("button", { name: "插入独立副本", exact: true }).click();
  await expect(page.locator('.mr-product-panel[aria-label="片段与样式"]')).toBeVisible();
  await expect(page.locator(".mr-canvas")).toBeVisible();
  const inserted = await currentDocument(page);
  const components = inserted.template.pages[0]!.components;
  expect(components).toHaveLength(3);
  expect(components[2]!.meta?.fragment).toMatchObject({
    id: "report-heading",
    revision: "1",
  });
  expect(components[2]).not.toHaveProperty("nid");
  await openTools(page, "结构大纲");
  await page.getByPlaceholder("搜索版面、组件、字段或引用").fill("list");
  await page.locator(".mr-outline-tree button").click();
  await openTools(page, "片段与样式");
  await page
    .getByRole("button", { name: "应用到当前组件", exact: true })
    .click();
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await expect(
    page
      .locator(".mr-designer-preview td")
      .filter({ hasText: /^炉号$/ })
      .first(),
  ).toHaveCSS("background-color", "rgb(234, 242, 251)");
  await expect(page.locator(".mr-designer-preview")).toContainText("000418");
  const styled = await currentDocument(page);
  const list = styled.template.pages[0]!.components.find(
    (component) => component.kind === "list",
  ) as ListComponent;
  expect(list.columns[0]!.headerStyle).toMatchObject({
    align: "center",
    backgroundColor: "#eaf2fb",
  });
});

for (const width of [1024, 1440]) {
  test(`命名样例逐组检查与基线对照 ${width}px，无主工作区溢出`, async ({
    page,
  }, testInfo) => {
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("http://localhost:8610/designer.html");
    await expect(page.locator(".mr-designer-preview")).toContainText("000418");
    await openTools(page, "发布检查");
    await page.getByRole("button", { name: "运行检查", exact: true }).click();
    await expect(page.locator(".mr-review-sample")).toHaveCount(3);
    await expect(page.locator(".mr-review-sample").first()).toContainText(
      "正常实绩与真实零值",
    );
    await page
      .getByRole("button", { name: "对比基线与草稿", exact: true })
      .first()
      .click();
    await expect(page.locator(".mr-fixture-previews article")).toHaveCount(2);
    await expect(
      page.locator(".mr-fixture-previews article").first(),
    ).toContainText("000418");
    await expect(
      page.locator(".mr-fixture-previews article").last(),
    ).toContainText("000418");
    await assertContained(page);
    await page.screenshot({
      path: testInfo.outputPath(`named-fixtures-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
    await openTools(page, "结构大纲");
    await assertContained(page);
    await page.screenshot({
      path: testInfo.outputPath(`outline-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
    await openTools(page, "片段与样式");
    await expect(page.locator(".mr-canvas")).toBeVisible();
    await expect(page.getByLabel("选择组件", { exact: true })).toBeVisible();
    await assertContained(page);
    await page.screenshot({
      path: testInfo.outputPath(`fragments-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
    expect(failures).toEqual([]);
  });
}
