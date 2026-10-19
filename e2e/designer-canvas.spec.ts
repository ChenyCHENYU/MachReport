import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import type { ReportTemplateDocument } from "../packages/mach-report/src/index";
type CanvasWindow = Window & {
  __canvasFixture: {
    readonly document: ReportTemplateDocument;
    readonly changes: number;
    readonly(value: boolean): void;
  };
};
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
              detail: [{ id: "000418", weight: 64200, energy: 30800 }],
            },
            dataSchemas: {
              detail: {
                fields: [
                  { field: "id", type: "text", label: "编号" },
                  { field: "weight", type: "number", label: "重量" },
                  { field: "energy", type: "number", label: "电量" },
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
  await root.getByLabel("添加组件", { exact: true }).selectOption("image");
  await expect(root.locator("[data-canvas-component]")).toHaveCount(3);
  await expect(root.locator('[data-canvas-component="2"] img')).toBeVisible();
  await root.getByRole("button", { name: "复制组件", exact: true }).click();
  await expect(root.locator("[data-canvas-component]")).toHaveCount(4);
  await root.getByRole("button", { name: "删除组件", exact: true }).click();
  await expect(root.locator("[data-canvas-component]")).toHaveCount(3);
  await page.evaluate(() =>
    (window as CanvasWindow).__canvasFixture.readonly(true),
  );
  await expect(root.getByLabel("添加组件", { exact: true })).toBeDisabled();
  await page.screenshot({
    path: testInfo.outputPath("canvas-design.png"),
    fullPage: true,
  });
});
