import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import type { ReportTemplateDocument } from "../packages/mach-report/src/index";
type ReviewWindow = Window & {
  __reviewFixture: {
    readonly document: ReportTemplateDocument;
    readonly changes: number;
    readonly(value: boolean): void;
  };
};
async function mountReview(page: Page) {
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
            id: "review-e2e",
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
      target.id = "review-test-fixture";
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
      (window as ReviewWindow).__reviewFixture = {
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
  const root = page.locator("#review-test-fixture");
  await expect(root.locator(".mr-designer-preview")).toContainText("000418");
  await root.getByRole("button", { name: "设计", exact: true }).click();
  return root;
}
test("发布检查展示变更、字段错误与样例，定位回属性且不会自动发布", async ({page}, testInfo) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const root = await mountReview(page);
  await root.getByLabel("业务字段", {exact:true}).fill("missing_source");
  await root.getByLabel("表头", {exact:true}).click();
  await root.getByRole("tab", {name:"工具",exact:true}).click();
  await root.getByRole("button", {name:"发布检查",exact:true}).click();
  const panel=root.locator(".mr-template-review");
  await panel.getByRole("button", {name:"运行检查",exact:true}).click();
  await expect(panel.getByRole("heading", {name:/模板变更/})).toBeVisible();
  const issue=panel.locator(".mr-review-list li").filter({hasText:"数据集 detail 缺少字段 missing_source"});
  await expect(issue).toHaveCount(1);
  await expect(panel.getByRole("heading", {name:"样例结果",exact:true})).toBeVisible();
  await expect(panel).toContainText(/1 行 · 1 页/);
  await expect(root.getByRole("button", {name:"发布",exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>(window as ReviewWindow).__reviewFixture.document.revision)).toBeUndefined();
  await page.screenshot({path:testInfo.outputPath("template-review-field-issue.png"),fullPage:true});
  await issue.getByRole("button", {name:"定位",exact:true}).click();
  await expect(root.getByRole("tab", {name:"字段",exact:true})).toHaveAttribute("aria-selected","true");
  await expect(root.getByLabel("业务字段", {exact:true})).toHaveValue("missing_source");
  await expect(root.locator(".mr-canvas-component.is-selected")).toHaveCount(1);
  await root.getByLabel("业务字段", {exact:true}).fill("id");
  await root.getByLabel("表头", {exact:true}).click();
  await root.getByRole("tab", {name:"工具",exact:true}).click();
  await panel.getByRole("button", {name:"运行检查",exact:true}).click();
  await expect(panel.locator(".mr-review-summary")).toContainText("0 错误");
  await expect(panel.getByRole("heading", {name:"样例结果",exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as ReviewWindow).__reviewFixture.document.revision)).toBeUndefined();
  await page.screenshot({path:testInfo.outputPath("template-review-clear.png"),fullPage:true});
  expect(errors).toEqual([]);
});
