import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import type { ReportTemplateDocument } from "../packages/mach-report/src/index";
import type { TemplateEditorController } from "../packages/mach-report/src/designer";

type WorkspaceWindow = Window & { __workspace: { editor: TemplateEditorController; document: ReportTemplateDocument; changes: number } };
async function mountWorkspace(page: Page, navigate = true) {
  if (navigate) await page.goto("http://localhost:8610");
  await expect(page.getByText("产品出库单")).toBeVisible();
  await page.evaluate(async ({ core, designer }) => {
    const source = await fetch("/src/main.ts").then(response => response.text());
    const vueUrl = source.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)?.[1];
    if (!vueUrl) throw new Error("Shared Vue runtime is unavailable");
    const { createApp, h, ref } = await import(vueUrl) as typeof import("vue");
    const { createTableTemplate, defineReportTemplate } = await import(core) as typeof import("../packages/mach-report/src/index");
    const { ReportTemplateEditor, createTemplateDraftStorage } = await import(designer) as typeof import("../packages/mach-report/src/designer");
    const template = createTableTemplate({ layout: "wide", columns: Array.from({ length: 24 }, (_, index) => ({ field: `field${index}`, header: `字段 ${index + 1}`, widthMm: 25 })) });
    template.pages[0]!.heightMm = 1000;
    for (let index = 0; index < 7; index++) template.pages.unshift({ widthMm: 210, heightMm: 297, meta: { title: `说明页 ${index + 1}` }, components: [{ kind: "text", nid: `page-${index}`, text: `说明 ${index + 1}`, leftMm: 10, topMm: 10, widthMm: 50, heightMm: 10 }] });
    template.pages[7]!.meta = { title: "工作版面" };
    const value = ref(defineReportTemplate({ id: "workspace-e2e", name: "工作位置验收", template }));
    const editor = ref<TemplateEditorController>();
    const draftStorage = { scope: "workspace-e2e:account", adapter: createTemplateDraftStorage(sessionStorage), rememberView: true };
    let changes = 0;
    const target = document.createElement("div"); target.id = "workspace-test-fixture";
    target.style.cssText = "position:fixed;inset:16px;z-index:9999;background:white";
    document.body.append(target);
    createApp({ render: () => h(ReportTemplateEditor, { ref: editor, modelValue: value.value, draftStorage, datasets: { detail: [Object.fromEntries(Array.from({ length: 24 }, (_, index) => [`field${index}`, index]))] }, "onUpdate:modelValue": (next: ReportTemplateDocument) => { value.value = next; changes++; } }) }).mount(target);
    Object.defineProperty(window, "__workspace", { configurable: true, value: { get editor() { return editor.value!; }, get document() { return value.value; }, get changes() { return changes; } } });
  }, { core: `/@fs${fileURLToPath(new URL("../packages/mach-report/src/index.ts", import.meta.url))}`, designer: `/@fs${fileURLToPath(new URL("../packages/mach-report/src/designer.ts", import.meta.url))}` });
  const root = page.locator("#workspace-test-fixture");
  await expect(root.getByRole("button", { name: "操作指引", exact: true })).toBeEnabled();
  return root;
}

test("变更定位进入第八页真实属性，返回检查保留上下文", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const root = await mountWorkspace(page);
  await page.evaluate(() => {
    const fixture = (window as WorkspaceWindow).__workspace;
    const template = JSON.parse(JSON.stringify(fixture.document.template)) as ReportTemplateDocument["template"];
    template.pages[7]!.widthMm += 20;
    if (!fixture.editor.applyTemplate?.(template)) throw new Error("Template transaction was rejected");
    fixture.editor.openPanel?.("review");
  });
  const review = root.locator(".mr-template-review");
  await review.getByRole("button", { name: "运行检查", exact: true }).click();
  await expect(review.locator(".mr-review-summary")).toBeVisible();
  const change = review.locator(".mr-review-list li").filter({ hasText: "pages[7].widthMm" });
  await change.getByRole("button", { name: "定位", exact: true }).click();
  await expect(root.locator('[data-mr-control="page-widthMm"]')).toBeFocused();
  await expect(root.locator(".mr-page-list button").last()).toHaveAttribute("aria-pressed", "true");
  await root.getByRole("button", { name: "返回检查列表", exact: false }).click();
  await expect(change.getByRole("button", { name: "定位", exact: true })).toBeFocused();
  await expect(review.locator(".mr-review-summary")).toBeVisible();
  await root.screenshot({ path: testInfo.outputPath("diagnostic-return.png") });
  expect(errors).toEqual([]);
});

test("刷新后继续第八页画布视角，导航不产生模板修改", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  let root = await mountWorkspace(page);
  await page.evaluate(() => (window as WorkspaceWindow).__workspace.editor.openPanel?.("layout"));
  await root.locator(".mr-page-list button").last().click();
  await root.locator(".mr-canvas-toolbar select").selectOption("1.25");
  await root.locator(".mr-canvas-scroll").evaluate(element => { element.scrollLeft = 140; element.scrollTop = 280; element.dispatchEvent(new Event("scroll")); });
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  expect(await page.evaluate(() => (window as WorkspaceWindow).__workspace.changes)).toBe(0);
  await page.reload(); root = await mountWorkspace(page, false);
  await root.getByRole("button", { name: "继续上次位置", exact: true }).click();
  await expect(root.locator(".mr-canvas-sheet-info strong")).toHaveText("工作版面");
  await expect(root.locator(".mr-canvas-toolbar select")).toHaveValue("1.25");
  await expect.poll(() => root.locator(".mr-canvas-scroll").evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop }))).toEqual({ left: 140, top: 280 });
  expect(await page.evaluate(() => (window as WorkspaceWindow).__workspace.changes)).toBe(0);
  await root.screenshot({ path: testInfo.outputPath("workspace-resumed.png") });
  expect(errors).toEqual([]);
});
