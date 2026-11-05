import { expect, test, type Locator, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import type { ReportTemplateDocument } from "../packages/mach-report/src/index";
type CanvasWindow = Window & {
  __canvasFixture: {
    readonly document: ReportTemplateDocument;
    readonly changes: number;
    readonly(value: boolean): void;
  };
};
async function acceptAdditionalPage(root: Locator): Promise<void> {
  const confirmation = root.getByRole("alertdialog", { name: "需要新增一个版面", exact: true });
  if (await confirmation.isVisible())
    await confirmation.getByRole("button", { name: "新增版面并添加", exact: true }).click();
}
async function mountCanvas(page: Page) {
  await page.goto("http://localhost:8610");
  await expect(page.getByText("产品出库单")).toBeVisible();
  await page.evaluate(
    async ({ core, designer }) => {
      const source = await fetch("/src/main.ts").then((response) =>
          response.text(),
        ),
        url = source.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)?.[1];
      if (!url) throw new Error("Missing shared Vue runtime");
      const { createApp, h, ref } = (await import(url)) as typeof import("vue");
      const { createTableTemplate, defineReportTemplate } = (await import(
        core
      )) as typeof import("../packages/mach-report/src/index");
      const { ReportTemplateEditor } = (await import(
        designer
      )) as typeof import("../packages/mach-report/src/designer");
      const documentValue = ref(
          defineReportTemplate({
            id: "canvas-e2e",
            name: "设计器验收",
            template: createTableTemplate({
              title: "生产报表",
              layout: "wide",
              columns: [
                { header: "编号", field: "id", widthMm: 40 },
                { header: "重量", field: "weight", widthMm: 40 },
                { header: "电量", field: "energy", widthMm: 40 },
              ],
            }),
          }),
        ),
        readonly = ref(false);
      // Keep room for the keyboard move; a full-width title is correctly clamped at the page edge.
      const title = documentValue.value.template.pages[0]!.components[0]!;
      title.widthMm = 60;
      let changes = 0;
      const target = document.createElement("div");
      target.id = "canvas-test-fixture";
      target.style.cssText =
        "position:fixed;inset:16px;z-index:9999;background:white";
      document.body.append(target);
      createApp({
        render: () =>
          h(ReportTemplateEditor, {
            modelValue: documentValue.value,
            readonly: readonly.value,
            "onUpdate:modelValue": (value: ReportTemplateDocument) => {
              documentValue.value = value;
              changes++;
            },
            datasets: {
              detail: [
                { id: "000418", weight: 64200, energy: 30800, cost: 400 },
                { id: "000419", weight: 5800, energy: 4200, cost: 50 },
              ],
            },
            dataSchemas: {
              detail: {
                fields: [
                  { field: "id", type: "text", label: "编号" },
                  { field: "weight", type: "number", label: "重量" },
                  { field: "energy", type: "number", label: "电量" },
                  { field: "cost", type: "number", label: "成本" },
                ],
              },
            },
            save: async (value: ReportTemplateDocument) => ({
              ...value,
              revision: "1",
            }),
          }),
      }).mount(target);
      (window as CanvasWindow).__canvasFixture = {
        get document() {
          return documentValue.value;
        },
        get changes() {
          return changes;
        },
        readonly(value) {
          readonly.value = value;
        },
      };
    },
    {
      core: `/@fs${fileURLToPath(new URL("../packages/mach-report/src/index.ts", import.meta.url))}`,
      designer: `/@fs${fileURLToPath(new URL("../packages/mach-report/src/designer.ts", import.meta.url))}`,
    },
  );
  const root = page.locator("#canvas-test-fixture");
  await expect(root.locator(".mr-designer-preview")).toContainText("000418");
  await root.getByRole("button", { name: "设计", exact: true }).click();
  return root;
}
test("设计画布选择联动、热拖一笔提交、取消/键盘/尺寸与撤销保持真实模板一致", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const root = await mountCanvas(page),
    text = root.locator('[data-canvas-component="0"]');
  await text.click();
  await expect(
    root.getByRole("tab", { name: "组件", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const before = await page.evaluate(
      () => (window as CanvasWindow).__canvasFixture.changes,
    ),
    bounds = await text.boundingBox();
  if (!bounds) throw new Error("Missing canvas text");
  await page.mouse.move(bounds.x + 10, bounds.y + 10);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 40, bounds.y + 30, { steps: 25 });
  expect(
    await page.evaluate(() => (window as CanvasWindow).__canvasFixture.changes),
  ).toBe(before);
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(() => (window as CanvasWindow).__canvasFixture.changes),
    )
    .toBe(before + 1);
  const moved = await page.evaluate(
    () =>
      (window as CanvasWindow).__canvasFixture.document.template.pages[0]!
        .components[0]!.leftMm,
  );
  await text.focus();
  await page.keyboard.press("ArrowRight");
  expect(
    await page.evaluate(
      () =>
        (window as CanvasWindow).__canvasFixture.document.template.pages[0]!
          .components[0]!.leftMm,
    ),
  ).toBe(moved + 0.5);
  await root.getByRole("button", { name: "撤销", exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (window as CanvasWindow).__canvasFixture.document.template.pages[0]!
          .components[0]!.leftMm,
    ),
  ).toBe(moved);
  const previous = await page.evaluate(
      () => (window as CanvasWindow).__canvasFixture.changes,
    ),
    box = await text.boundingBox();
  if (!box) throw new Error("Missing moved component");
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 30);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(
    await page.evaluate(() => (window as CanvasWindow).__canvasFixture.changes),
  ).toBe(previous);
  await root.getByLabel("文本内容", { exact: true }).fill("画布标题");
  await root.getByLabel("宽度", { exact: true }).click();
  await expect(text).toContainText("画布标题");
  await root.getByLabel("宽度", { exact: true }).fill("80");
  await root.getByLabel("顶部", { exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (window as CanvasWindow).__canvasFixture.document.template.pages[0]!
          .components[0]!.widthMm,
    ),
  ).toBe(80);
  await root.getByRole("button", { name: "预览", exact: true }).click();
  await expect(root.locator(".mr-designer-preview")).toContainText("画布标题");
  await page.screenshot({
    path: testInfo.outputPath("canvas-real-preview.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("设计器列排序/显隐/拖宽、多层表头合并拆分与组件命令真实生效", async ({
  page,
}, testInfo) => {
  const root = await mountCanvas(page),
    list = root.locator('[data-canvas-component="1"]');
  await list.locator(".is-header>div").first().click();
  await root.getByRole("button", { name: "向后移动列", exact: true }).click();
  expect(
    await page.evaluate(() =>
      (
        window as CanvasWindow
      ).__canvasFixture.document.template.pages[0]!.components.find(
        (c) => c.kind === "list",
      )!.columns.map((c) => c.field),
    ),
  ).toEqual(["weight", "id", "energy"]);
  await root.getByLabel("显示此列", { exact: true }).uncheck();
  await root.getByRole("button", { name: "预览", exact: true }).click();
  await expect(root.locator(".mr-designer-preview")).not.toContainText(
    "000418",
  );
  await root.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(root.locator(".mr-designer-preview")).toContainText("000418");
  await root.getByRole("button", { name: "设计", exact: true }).click();
  await list.locator(".is-header>div").first().click();
  const handle = list.locator(".mr-canvas-column-handle").first(),
    box = await handle.boundingBox();
  if (!box) throw new Error("Missing width handle");
  const before = await page.evaluate(
    () => (window as CanvasWindow).__canvasFixture.changes,
  );
  await page.mouse.move(box.x + 3, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 33, box.y + 10, { steps: 15 });
  expect(
    await page.evaluate(() => (window as CanvasWindow).__canvasFixture.changes),
  ).toBe(before);
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(() => (window as CanvasWindow).__canvasFixture.changes),
    )
    .toBe(before + 1);
  await root.getByRole("tab", { name: "组件", exact: true }).click();
  await root.locator(".mr-header-editor summary").click();
  await root.getByRole("button", { name: "添加分组行", exact: true }).click();
  await root.getByRole("button", { name: "合并所选表头", exact: true }).click();
  await expect(list.locator(".mr-canvas-merged>div")).toHaveCount(5);
  await root.getByRole("button", { name: "拆分表头", exact: true }).click();
  await expect(list.locator(".mr-canvas-merged>div")).toHaveCount(6);
  await root.getByRole("button", { name: "添加内容", exact: true }).click();
  await root.getByRole("dialog", { name: "添加到当前版面", exact: true })
    .getByRole("button", { name: /^图片或 Logo/ }).click();
  await acceptAdditionalPage(root);
  await expect.poll(() => page.evaluate(() =>
    (window as CanvasWindow).__canvasFixture.document.template.pages
      .reduce((count, page) => count + page.components.length, 0),
  )).toBe(3);
  await expect(root.locator('.mr-canvas-component.is-selected[aria-label$=" image"]')).toBeVisible();
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1EAAAAASUVORK5CYII=";
  const source = root.getByLabel("图片地址或 data URI", { exact: true });
  await source.fill(png);
  await source.press("Tab");
  await expect(root.locator('.mr-canvas-component.is-selected img')).toHaveAttribute("src", png);
  await root.getByRole("button", { name: "复制组件", exact: true }).click();
  await expect.poll(() => page.evaluate(() =>
    (window as CanvasWindow).__canvasFixture.document.template.pages
      .reduce((count, page) => count + page.components.length, 0),
  )).toBe(4);
  await root.getByRole("button", { name: "删除组件", exact: true }).click();
  await expect.poll(() => page.evaluate(() =>
    (window as CanvasWindow).__canvasFixture.document.template.pages
      .reduce((count, page) => count + page.components.length, 0),
  )).toBe(3);
  await page.evaluate(() =>
    (window as CanvasWindow).__canvasFixture.readonly(true),
  );
  await expect(root.getByRole("button", { name: "添加内容", exact: true })).toBeDisabled();
  await page.screenshot({
    path: testInfo.outputPath("canvas-design.png"),
    fullPage: true,
  });
});

test("画布适宽适页、多选对齐与位置锁保持模板和视口一致", async ({ page }, testInfo) => {
  const root = await mountCanvas(page);
  for (const selector of [".mr-insert-trigger", ".mr-designer-guide > button"]) {
    const control = root.locator(selector);
    await expect(control).toHaveCSS("border-top-style", "solid");
    await expect(control).toHaveCSS("border-top-width", "1px");
    await expect(control).toHaveCSS("border-radius", "6px");
    await expect(control).toHaveCSS("font-size", "12px");
  }
  const viewport = root.locator(".mr-canvas-scroll"), paper = root.locator(".mr-canvas-paper");
  await root.getByRole("button", { name: "适宽", exact: true }).click();
  expect(await paper.evaluate(node => node.getBoundingClientRect().width)).toBeLessThanOrEqual((await viewport.evaluate(node => node.clientWidth)) - 39);
  await root.getByRole("button", { name: "适页", exact: true }).click();
  expect(await paper.evaluate(node => node.getBoundingClientRect().height)).toBeLessThanOrEqual((await viewport.evaluate(node => node.clientHeight)) - 39);
  await root.locator('[data-canvas-component="0"]').click({ position: { x: 5, y: 5 } });
  await root.locator('[data-canvas-component="1"]').click({ position: { x: 8, y: 25 }, modifiers: ["Control"] });
  await root.getByRole("tab", { name: "组件", exact: true }).click();
  await expect(root.locator(".mr-canvas-component.is-selected")).toHaveCount(2);
  await root.getByRole("combobox", { name: "对齐选区" }).selectOption("left");
  const lefts = await page.evaluate(() => (window as CanvasWindow).__canvasFixture.document.template.pages[0]!.components.map(item => item.leftMm));
  expect(lefts[0]).toBe(lefts[1]);
  await root.getByRole("button", { name: "锁定位置", exact: true }).click();
  await expect(root.locator(".mr-canvas-component.is-locked")).toHaveCount(2);
  const before = await page.evaluate(() => (window as CanvasWindow).__canvasFixture.changes);
  await root.locator('[data-canvas-component="0"]').focus(); await page.keyboard.press("ArrowRight");
  expect(await page.evaluate(() => (window as CanvasWindow).__canvasFixture.changes)).toBe(before);
  await root.screenshot({ path: testInfo.outputPath("canvas-selection-lock.png") });
});


test("添加字段与说明文字、表尾汇总在同一工作区预览并保持撤销重做", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const root = await mountCanvas(page);
  await root.getByRole("button", { name: "添加内容", exact: true }).click();
  const menu = root.getByRole("dialog", { name: "添加到当前版面", exact: true });
  await menu.getByRole("button", { name: /^添加表格字段/ }).click();
  const fieldSearch = menu.getByRole("textbox", { name: "搜索业务字段", exact: true });
  await expect(fieldSearch).toBeVisible();
  await fieldSearch.fill("成本");
  await menu.getByRole("button", { name: /成本.*cost/ }).click();
  await expect(root.getByLabel("表头", { exact: true })).toHaveValue("成本");
  const totals = root.locator(".mr-totals-editor");
  await expect(totals).not.toHaveAttribute("open");
  await expect(totals.locator("summary")).toContainText("未设置");
  await totals.locator("summary").click();
  await expect(totals.getByRole("combobox", { name: "计算方式", exact: true })).toHaveCSS("border-top-style", "solid");
  await expect(totals.getByRole("combobox", { name: "计算方式", exact: true })).toHaveCSS("border-radius", "6px");
  await totals.getByRole("combobox", { name: "显示位置", exact: true }).selectOption("total");
  await totals.getByRole("combobox", { name: "汇总字段", exact: true }).selectOption("weight");
  await totals.getByRole("combobox", { name: "计算方式", exact: true }).selectOption("sum");
  await totals.getByRole("button", { name: "添加汇总", exact: true }).click();
  await expect(totals.locator("summary")).toContainText("1 项汇总");
  await expect(totals).toContainText("跨页时继续累计");
  await root.getByRole("button", { name: "预览", exact: true }).click();
  const preview = root.locator(".mr-designer-preview .mach-report-preview");
  await expect(preview).toContainText("成本");
  await expect(preview.getByText("70,000", { exact: true })).toBeVisible();
  await root.getByRole("button", { name: "设计", exact: true }).click();
  await root.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(totals.locator("summary")).toContainText("未设置");
  await root.getByRole("button", { name: "重做", exact: true }).click();
  await expect(totals.locator("summary")).toContainText("1 项汇总");
  await root.getByRole("button", { name: "添加内容", exact: true }).click();
  await root.getByRole("dialog", { name: "添加到当前版面", exact: true })
    .getByRole("button", { name: /^说明文字/ }).click();
  await acceptAdditionalPage(root);
  const text = root.getByLabel("文本内容", { exact: true });
  await text.fill("生产口径已核对");
  await text.press("Tab");
  await expect(root.locator(".mr-canvas-component.is-selected")).toContainText("生产口径已核对");
  await root.getByRole("button", { name: "预览", exact: true }).click();
  await expect(preview).toContainText("生产口径已核对");
  await expect(preview.getByText("70,000", { exact: true })).toBeVisible();
  await root.getByRole("button", { name: "设计", exact: true }).click();
  await root.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(root.locator(".mr-canvas-paper")).not.toContainText("生产口径已核对");
  await root.getByRole("button", { name: "重做", exact: true }).click();
  await expect(root.locator(".mr-canvas-paper")).toContainText("生产口径已核对");
  expect(errors).toEqual([]);
  await root.screenshot({ path: testInfo.outputPath("template-continuity-totals.png") });
});

test("新增版面先显示影响，取消保留原模板，确认后一次撤销恢复", async ({ page }) => {
  const root = await mountCanvas(page);
  const before = await page.evaluate(() => (window as CanvasWindow).__canvasFixture.changes);
  await root.getByRole("button", { name: "添加内容", exact: true }).click();
  await root.getByRole("dialog", { name: "添加到当前版面", exact: true })
    .getByRole("button", { name: /^说明文字/ }).click();
  const confirmation = root.getByRole("alertdialog", { name: "需要新增一个版面", exact: true });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText("模板版面 1 → 2");
  await expect(confirmation).toContainText("最终输出页数由明细分页决定");
  const cancel = confirmation.getByRole("button", { name: "取消添加", exact: true });
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(confirmation.getByRole("button", { name: "新增版面并添加", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  expect(await page.evaluate(() => (window as CanvasWindow).__canvasFixture.changes)).toBe(before);
  await expect(root.getByRole("button", { name: "添加内容", exact: true })).toBeFocused();
  await root.getByRole("button", { name: "添加内容", exact: true }).click();
  await root.getByRole("dialog", { name: "添加到当前版面", exact: true })
    .getByRole("button", { name: /^说明文字/ }).click();
  await confirmation.getByRole("button", { name: "新增版面并添加", exact: true }).click();
  expect(await page.evaluate(() => (window as CanvasWindow).__canvasFixture.document.template.pages.length)).toBe(2);
  await root.getByRole("button", { name: "撤销", exact: true }).click();
  expect(await page.evaluate(() => (window as CanvasWindow).__canvasFixture.document.template.pages.length)).toBe(1);
});
