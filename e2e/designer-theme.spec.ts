import { expect, test, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fileURLToPath } from "node:url";

async function audit(page: Page, info: TestInfo, selector: string): Promise<void> {
  const result = await new AxeBuilder({ page }).include(selector).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  await info.attach("theme-accessibility.json", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
  expect(result.violations.map(issue => ({ id: issue.id, nodes: issue.nodes.map(node => ({ target: node.target, reason: node.failureSummary })) }))).toEqual([]);
}

test("主题贯通设计器与预览，切换不重置字段修改和撤销", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://localhost:8610/designer.html");
  const root = page.locator(".mr-designer");
  await expect(root.locator(".mr-designer-preview")).toContainText("000418");
  const header = root.getByLabel("表头", { exact: true });
  const original = await header.inputValue();
  await header.fill("主题检查炉号");
  await page.getByRole("button", { name: "深色界面", exact: true }).click();
  await expect(root).toHaveCSS("background-color", "rgb(23, 34, 53)");
  await expect(root).toHaveCSS("color", "rgb(226, 232, 240)");
  await expect(root).toHaveCSS("color-scheme", "dark");
  await expect(header).toHaveValue("主题检查炉号");
  await expect(root.locator(".mrp-toolbar")).toHaveCSS("background-color", "rgb(23, 34, 53)");
  const save = root.locator(".mr-designer-save");
  await expect(save).toBeEnabled();
  await save.hover();
  await expect(save).toHaveCSS("color", "rgb(11, 18, 32)");
  await expect(save).toHaveCSS("background-color", "rgb(147, 197, 253)");
  const paper = root.locator(".mrp-page-holder").first();
  await expect(paper).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(paper.getByText("000418", { exact: true })).toHaveCSS("color", "rgb(0, 0, 0)");
  await audit(page, info, ".mr-designer");
  await page.screenshot({ path: info.outputPath("designer-dark.png"), animations: "disabled", fullPage: true });
  await root.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(header).toHaveValue(original);
  await root.getByRole("button", { name: "设计", exact: true }).click();
  await expect(root.locator(".mr-canvas-paper")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(root.locator(".mr-canvas-paper")).toHaveCSS("color-scheme", "light");
  await page.getByRole("button", { name: "深色界面", exact: true }).click();
  await expect(root).toHaveCSS("background-color", "rgb(255, 255, 255)");
  expect(errors).toEqual([]);
});

test("标签工作台只配置一次主题，设计与打印预览连续且纸面不变色", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://localhost:8610/labels.html");
  const root = page.locator(".mr-label-studio");
  await expect(root.locator(".mrp-page-holder").first()).toContainText("S304H3");
  const code = root.locator('.mrp-page-holder img[src^="data:image/png;base64,"]').first();
  await expect(code).toBeVisible();
  const originalCode = await code.getAttribute("src");
  await page.getByRole("button", { name: "深色界面", exact: true }).click();
  await expect(root).toHaveCSS("color-scheme", "dark");
  await expect(root.locator(".mr-label-context")).toHaveCSS("background-color", "rgb(11, 18, 32)");
  await expect(root.locator(".mrp-toolbar")).toHaveCSS("background-color", "rgb(23, 34, 53)");
  await expect(root.locator(".mrp-page-holder").first()).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(code).toHaveAttribute("src", originalCode!);
  await audit(page, info, ".mr-label-studio");
  await root.getByRole("button", { name: "设计标签", exact: true }).click();
  await expect(root.locator(".mr-designer")).toHaveCSS("background-color", "rgb(23, 34, 53)");
  await expect(root.locator(".mr-canvas-paper")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(root.locator('.mr-canvas-component[aria-label$=" qrcode"]').first()).toBeVisible();
  await page.screenshot({ path: info.outputPath("label-designer-dark.png"), animations: "disabled", fullPage: true });
  await root.locator(".mr-label-bar").getByRole("button", { name: "打印预览", exact: true }).click();
  await expect(root.locator(".mrp-pagination")).toContainText("1 / 4");
  await page.getByRole("button", { name: "深色界面", exact: true }).click();
  await expect(root.locator(".mrp-toolbar")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  expect(errors).toEqual([]);
});

test("独立模板库、批量生成和参数规则面板自动继承应用主题", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://localhost:8610");
  await expect(page.getByText("产品出库单")).toBeVisible();
  await page.evaluate(async ({ core, vueEntry, designer, themeEntry }) => {
    const source = await fetch("/src/main.ts").then(response => response.text());
    const runtimeUrl = source.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)?.[1];
    if (!runtimeUrl) throw new Error("Missing shared Vue runtime");
    const { createApp, h, ref } = await import(runtimeUrl) as typeof import("vue");
    const { createTableTemplate, defineReportTemplate, createLocalTemplateCatalog } = await import(core) as typeof import("../packages/mach-report/src/index");
    const { machReportPlugin } = await import(vueEntry) as typeof import("../packages/mach-report/src/vue/index");
    const { ReportTemplateLibrary, ReportBatchPanel, ParamEditor, RuleEditor } = await import(designer) as typeof import("../packages/mach-report/src/designer");
    const { darkDemoTheme } = await import(themeEntry) as typeof import("../examples/minimal/src/demo-theme");
    const template = createTableTemplate({ columns: [{ header: "编号", field: "id" }] });
    template.params = [{ field: "plant", label: "厂别", type: "text" }];
    const documentValue = defineReportTemplate({ id: "theme-standalone", name: "主题独立接入", template });
    const list = template.pages[0]!.components.find(component => component.kind === "list")!;
    if (list.kind !== "list") throw new Error("Missing list component");
    const dark = ref(true);
    const target = document.createElement("div");
    target.id = "standalone-theme";
    target.style.cssText = "position:absolute;inset:0;z-index:9999;background:#fff;padding:20px;display:grid;gap:24px";
    document.body.append(target);
    createApp({ render: () => h("div", [
      h("button", { type: "button", onClick: () => { dark.value = !dark.value; } }, "切换工具主题"),
      h(ReportTemplateLibrary, { provider: createLocalTemplateCatalog([{ document: documentValue }]) }),
      h(ReportBatchPanel, { paramDefs: template.params!, initialCases: [{ id: "first", params: { plant: "YTS0" } }], execute: async () => { throw new Error("示例校验失败"); } }),
      h(ParamEditor, { document: documentValue, accept: () => true }),
      h(RuleEditor, { list }),
    ]) }).use(machReportPlugin, { config: { defaults: { get theme() { return dark.value ? darkDemoTheme : {}; } } }, globalComponent: false }).mount(target);
  }, {
    core: `/@fs${fileURLToPath(new URL("../packages/mach-report/src/index.ts", import.meta.url))}`,
    vueEntry: `/@fs${fileURLToPath(new URL("../packages/mach-report/src/vue/index.ts", import.meta.url))}`,
    designer: `/@fs${fileURLToPath(new URL("../packages/mach-report/src/designer.ts", import.meta.url))}`,
    themeEntry: "/src/demo-theme.ts",
  });
  const root = page.locator("#standalone-theme");
  for (const selector of [".mr-library", ".mr-batch", ".mr-param-editor", ".mr-rule-editor"]) {
    await expect(root.locator(selector)).toBeVisible();
    await expect(root.locator(selector)).toHaveCSS("background-color", "rgb(23, 34, 53)");
    await expect(root.locator(selector)).toHaveCSS("color", "rgb(226, 232, 240)");
    await expect(root.locator(selector)).toHaveCSS("color-scheme", "dark");
  }
  await root.getByRole("button", { name: "切换工具主题", exact: true }).click();
  await expect(root.locator(".mr-library")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(root.locator(".mr-batch")).toHaveCSS("color", "rgb(51, 65, 85)");
  await audit(page, info, "#standalone-theme");
  await root.getByRole("button", { name: "切换工具主题", exact: true }).click();
  await expect(root.locator(".mr-batch .is-primary")).toBeEnabled();
  await root.locator(".mr-batch .is-primary").click();
  await expect(root.locator(".mr-batch__row-error")).toContainText("示例校验失败");
  await expect(root.locator(".mr-batch__row-error")).toHaveCSS("color", "rgb(252, 165, 165)");
  await audit(page, info, "#standalone-theme");
  await page.screenshot({ path: info.outputPath("standalone-tools-dark.png"), animations: "disabled", fullPage: true });
  expect(errors).toEqual([]);
});
