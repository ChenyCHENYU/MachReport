import { expect, test, type Page } from "@playwright/test";
import type { ListComponent, ReportTemplateDocument } from "../packages/mach-report/src/index";

async function readDocument(page: Page): Promise<ReportTemplateDocument> {
  await page.getByRole("tab", { name: "高级", exact: true }).click();
  return JSON.parse(await page.getByLabel("完整模板 JSON", { exact: true }).inputValue()) as ReportTemplateDocument;
}
async function applyDocument(page: Page, document: ReportTemplateDocument): Promise<void> {
  await page.getByRole("tab", { name: "高级", exact: true }).click();
  await page.getByLabel("完整模板 JSON", { exact: true }).fill(JSON.stringify(document));
  await page.getByRole("button", { name: "校验并应用 JSON", exact: true }).click();
}

test("真实图表设计、多选整体操作与双视角在同一会话中连续工作", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://localhost:8610/designer.html");
  await expect(page.locator(".mr-designer-preview")).toContainText("000418");
  const document = await readDocument(page);
  document.template.pages = [{ widthMm: 500, heightMm: 200, components: [
    { kind: "text", leftMm: 10, topMm: 10, widthMm: 30, heightMm: 10, text: "连续设计 A" },
    { kind: "text", leftMm: 60, topMm: 30, widthMm: 30, heightMm: 10, text: "连续设计 B" },
    { kind: "ellipse", leftMm: 100, topMm: 10, widthMm: 30, heightMm: 20, style: { backgroundColor: "#dbeafe", borderColor: "#2563eb", borderTop: false, borderRight: false, borderBottom: false, borderLeft: false } },
    { kind: "chart", leftMm: 140, topMm: 10, widthMm: 110, heightMm: 60, chartBinding: { dataset: "detail", categoryField: "grade", type: "bar", measures: [{ field: "weight", op: "sum" }], showValues: true } },
  ] }];
  await applyDocument(page, document);
  await page.getByRole("button", { name: "设计", exact: true }).click();
  const canvas = page.locator(".mr-canvas"), first = canvas.locator('[data-canvas-component="0"]'), second = canvas.locator('[data-canvas-component="1"]');
  await expect(canvas.locator('[data-canvas-component="3"] .mr-kind-rect').first()).toBeVisible();
  await expect(canvas.locator(".mr-canvas-primitive-sample")).toHaveText("样例 · 3 / 3");
  await expect(canvas.locator('[data-canvas-component="2"] .mr-shape')).toHaveCSS("border-radius", "50%");
  await expect(canvas.locator('[data-canvas-component="2"] .mr-kind-ellipse')).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(canvas.locator('[data-canvas-component="2"] .mr-shape')).toHaveCSS("background-color", "rgb(219, 234, 254)");
  await first.click(); await second.click({ modifiers: ["Control"] });
  await expect(canvas.locator(".is-selected")).toHaveCount(2);
  const before = await first.boundingBox(), peerBefore = await second.boundingBox();
  await page.mouse.move(before!.x + 10, before!.y + 10); await page.mouse.down(); await page.mouse.move(before!.x + 40, before!.y + 30, { steps: 12 }); await page.mouse.up();
  await expect(canvas.locator(".is-selected")).toHaveCount(2);
  const after = await first.boundingBox(), peerAfter = await second.boundingBox();
  expect(after!.x - before!.x).toBeCloseTo(peerAfter!.x - peerBefore!.x, 0);
  expect(after!.y - before!.y).toBeCloseTo(peerAfter!.y - peerBefore!.y, 0);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(canvas.locator(".is-selected")).toHaveCount(2);
  await expect.poll(async () => (await first.boundingBox())!.x).toBeCloseTo(before!.x, 0);
  await first.focus(); await first.press("Control+d");
  await expect(canvas.locator(".is-selected")).toHaveCount(2);
  await expect(canvas.locator("[data-canvas-component]")).toHaveCount(6);
  const duplicate = canvas.locator('[data-canvas-component="4"]'); await duplicate.focus(); await duplicate.press("ArrowRight"); await duplicate.press("Delete");
  await expect(canvas.locator("[data-canvas-component]")).toHaveCount(4);
  await canvas.getByLabel("缩放", { exact: true }).selectOption("1.25");
  await canvas.locator(".mr-canvas-scroll").evaluate(element => { element.scrollLeft = 93; element.scrollTop = 57; });
  await page.getByRole("button", { name: "预览", exact: true }).click(); await expect(canvas).toBeHidden();
  await page.getByRole("button", { name: "设计", exact: true }).click();
  await expect(canvas.getByLabel("缩放", { exact: true })).toHaveValue("1.25");
  await expect.poll(() => canvas.locator(".mr-canvas-scroll").evaluate(element => [element.scrollLeft, element.scrollTop])).toEqual([93, 57]);
  await page.screenshot({ path: testInfo.outputPath("continuous-designer.png"), animations: "disabled", fullPage: true });
  expect(errors).toEqual([]);
});

test("批量字段先说明宽度影响，统一添加并一次撤销", async ({ page }) => {
  await page.goto("http://localhost:8610/designer.html"); await expect(page.locator(".mr-designer-preview")).toContainText("000418");
  const document = await readDocument(page), list = document.template.pages[0]!.components.find(item => item.kind === "list") as ListComponent;
  list.columns = list.columns.filter(column => ["heat", "weight"].includes(column.field));
  list.widthMm = list.columns.reduce((sum, column) => sum + column.widthMm, 0);
  await applyDocument(page, document);
  await page.getByRole("button", { name: "添加内容", exact: true }).click(); await page.locator(".mr-insert-field").click();
  await page.getByRole("checkbox", { name: "选择字段 钢种", exact: true }).check();
  await page.getByRole("checkbox", { name: "选择字段 总用电量", exact: true }).check();
  await page.getByRole("button", { name: "添加选中项", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "确认添加字段", exact: true });
  await expect(dialog).toContainText("添加 2 个字段"); await expect(dialog).toContainText("表格宽度");
  await dialog.getByRole("button", { name: "确认添加", exact: true }).click();
  let result = await readDocument(page);
  const columns = (value: ReportTemplateDocument) => (value.template.pages[0]!.components.find(item => item.kind === "list") as ListComponent).columns.map(column => column.field);
  expect(columns(result)).toEqual(["heat", "weight", "grade", "energy"]);
  await page.getByRole("button", { name: "撤销", exact: true }).click(); result = await readDocument(page); expect(columns(result)).toEqual(["heat", "weight"]);
  await page.getByRole("button", { name: "重做", exact: true }).click(); result = await readDocument(page); expect(columns(result)).toEqual(["heat", "weight", "grade", "energy"]);
});
