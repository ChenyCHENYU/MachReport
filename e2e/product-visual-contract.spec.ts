import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import type { ReportTemplateDocument } from "../packages/mach-report/src/index";
import { expectContained, expectPaint, expectReadable } from "./fixtures/visual-contract";

type Scene = "designer" | "binding" | "preview";
async function mountScene(page: Page, scene: Scene, dark: boolean) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("http://localhost:8610");
  await expect(page.getByText("产品出库单")).toBeVisible();
  await page.evaluate(async ({ scene, dark, core, designer, vueEntry }) => {
    const text = await fetch("/src/main.ts").then(response => response.text());
    const runtime = text.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)?.[1];
    if (!runtime) throw new Error("Missing shared example runtime");
    const { createApp, h, ref } = await import(runtime) as typeof import("vue");
    const { createTableTemplate, defineReportTemplate } = await import(core) as typeof import("../packages/mach-report/src/index");
    const { ReportTemplateEditor, ExcelBindingWizard } = await import(designer) as typeof import("../packages/mach-report/src/designer");
    const { ReportPreview, machReportPlugin, defineMachReportConfig } = await import(vueEntry) as typeof import("../packages/mach-report/src/vue/index");
    const themeEntry = "/src/demo-theme.ts";
    const { darkDemoTheme } = await import(themeEntry) as typeof import("../examples/minimal/src/demo-theme");
    const fields = Array.from({ length: 2048 }, (_, index) => ({ field: `f${index}`, label: `Metric ${index}`, type: "number" as const, unit: "kg" }));
    const documentValue = ref(defineReportTemplate({ id: "visual-contract", name: "Material report", template: createTableTemplate({ layout: "wide", title: "MATERIAL / QUALITY", columns: fields.slice(0, 3).map((field, index) => ({ field: field.field, header: field.label, widthMm: 25 + index * 10 })) }) }));
    const template = createTableTemplate({ columns: [{ field: "f0", header: "Metric" }] });
    template.pages = [{ widthMm: 60, heightMm: 80, layout: "wide", components: [{ kind: "rect", leftMm: 0, topMm: 0, widthMm: 60, heightMm: 24, meta: { xlsxSheet: "Quality", xlsxRange: "A1:B4" }, grid: { colWidthsMm: [30, 30], rowHeightsMm: [6, 6, 6, 6], cells: Array.from({ length: 4 }, (_, row) => [{ text: `Heat ${row}` }, { text: String(row) }]) } }] }];
    const diagnostics = Array.from({ length: 25 }, (_, index) => ({ code: "formula-cached" as const, severity: "warning" as const, message: `Cached formula ${index}: read only`, sheet: "Quality", cell: "B4", row: 4, column: 2 }));
    const session = { version: "1.0" as const, identity: { id: "visual-binding", name: "Quality template" }, recipe: { version: "1.0" as const, sheet: "Quality", dataset: "detail", rowKey: "f0", regions: { header: "A1:B1", detail: "A2:B4" }, fields: ["f0", "f1"] }, source: { template, warnings: [], diagnostics, diagnosticSummary: { total: 25, counts: { "formula-cached": 25 }, entries: diagnostics, omitted: 0 }, sheets: [{ name: "Quality", index: 1, range: "A1:B4", rowCount: 4, columnCount: 2, pageStart: 0, pageCount: 1 }] } };
    const plan = { schemaVersion: "visual-preview", pages: Array.from({ length: 2 }, (_, index) => ({ pageWidthMm: 210, pageHeightMm: 297, components: [{ kind: "text" as const, leftMm: 10, topMm: 10, widthMm: 180, heightMm: 15, text: `MATERIAL / PAGE ${index + 1}` }] })) };
    const target = document.createElement("div"); target.id = "product-visual-fixture"; target.style.cssText = "position:fixed;inset:12px;z-index:99999;background:white;overflow:hidden"; document.body.append(target);
    createApp({ render: () => scene === "designer" ? h(ReportTemplateEditor, { modelValue: documentValue.value, dataSchemas: { detail: { fields } }, datasets: { detail: [{ f0: 1, f1: 0, f2: 2 }] }, "onUpdate:modelValue": (next: ReportTemplateDocument) => { documentValue.value = next; } }) : scene === "binding" ? h(ExcelBindingWizard, { datasets: [{ id: "detail", fields }], session }) : h(ReportPreview, { reportId: "visual-preview", fetcher: async () => plan, height: "100%", showExport: false, showPrint: false, showPdfWindow: false }) }).use(machReportPlugin, { config: defineMachReportConfig({ defaults: { theme: dark ? darkDemoTheme : {} } }), globalComponent: false }).mount(target);
  }, {
    scene, dark,
    core: `/@fs${fileURLToPath(new URL("../packages/mach-report/src/index.ts", import.meta.url))}`,
    designer: `/@fs${fileURLToPath(new URL("../packages/mach-report/src/designer.ts", import.meta.url))}`,
    vueEntry: `/@fs${fileURLToPath(new URL("../packages/mach-report/src/vue/index.ts", import.meta.url))}`,
  });
  await page.addStyleTag({ content: '@font-face{font-family:MRVisual;src:url("/fonts/mach-report-demo.otf")} #product-visual-fixture,#product-visual-fixture button,#product-visual-fixture input,#product-visual-fixture select{font-family:MRVisual,sans-serif!important}' });
  await page.evaluate(async () => { await document.fonts.load("12px MRVisual"); await document.fonts.ready; });
  return page.locator("#product-visual-fixture");
}

for (const dark of [false, true]) {
  const palette = dark ? { surface: [23, 34, 53], selected: [37, 58, 86] } : { surface: [255, 255, 255], selected: [237, 243, 255] };
  test(`visual contract: bounded field picker and atomic batch controls (${dark ? "dark" : "light"})`, async ({ page }, info) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    const root = await mountScene(page, "designer", dark);
    const field = root.getByRole("combobox", { name: "业务字段", exact: true });
    await field.focus(); await field.press("End");
    const popup = root.locator(".mr-field-popup"), selected = popup.locator('[role="option"][aria-selected="true"]');
    await expect(selected).toContainText("f2047");
    expect(await popup.getByRole("option").count()).toBeLessThanOrEqual(100);
    const inputBox = await field.boundingBox(), popupBox = await popup.boundingBox();
    expect(Math.abs(inputBox!.x - popupBox!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(inputBox!.width - popupBox!.width)).toBeLessThanOrEqual(1);
    await expectContained(popup, root);
    await expectPaint(page, selected, palette.selected, info, "field-selected");
    await expectReadable(selected);
    await field.press("Escape");
    await root.locator(".mr-designer-field-trigger").click();
    const rows = root.locator(".mr-designer-column-row");
    await rows.nth(0).getByRole("checkbox").check(); await rows.nth(1).getByRole("checkbox").check();
    const batch = root.locator(".mr-column-batch"), apply = batch.getByRole("button", { name: "应用到所选字段", exact: true });
    await expect(batch.locator('[data-mr-control="batch-width"]')).toHaveAttribute("placeholder", "混合值");
    await batch.locator('[data-mr-control="batch-width"]').fill("40");
    await batch.locator('[data-mr-control="batch-bold"]').selectOption("true");
    await expect(apply).toBeEnabled(); await expectContained(apply, root.locator(".mr-designer-directory"));
    const controls = await batch.locator("input,select").evaluateAll(elements => elements.map(element => { const box = element.getBoundingClientRect(), style = getComputedStyle(element); return { tag: element.tagName, control: element.getAttribute("data-mr-control"), width: box.width, height: box.height, minHeight: style.minHeight, declaredHeight: style.height, appearance: style.appearance, padding: style.padding, lineHeight: style.lineHeight, fontSize: style.fontSize }; }));
    for (const control of controls) { expect(control.height, JSON.stringify(control)).toBeGreaterThanOrEqual(24); expect(control.height).toBeLessThanOrEqual(36); expect(control.width).toBeGreaterThan(80); }
    await expectPaint(page, apply, palette.selected, info, "batch-apply"); await expectReadable(apply);
    await apply.click(); await root.getByRole("button", { name: "撤销", exact: true }).click();
    expect(errors).toEqual([]);
  });

  test(`visual contract: bounded import diagnostics retain readable source navigation (${dark ? "dark" : "light"})`, async ({ page }, info) => {
    const root = await mountScene(page, "binding", dark), diagnostics = root.locator(".mr-import-diagnostics");
    await diagnostics.locator("summary").click();
    await expect(diagnostics.locator("li")).toHaveCount(12);
    const link = diagnostics.locator("li button").first();
    await expectPaint(page, link, palette.surface, info, "import-diagnostic"); await expectReadable(link);
    await link.click();
    await expect(root.locator('td[data-source-cell="4:2"]')).toBeFocused();
    await expect(root.getByLabel("预览起始行", { exact: true })).toHaveValue("4");
    await expect(root.getByLabel("预览起始列", { exact: true })).toHaveValue("2");
  });

  test(`visual contract: footer pager and toolbar keep alignment, paint and contrast (${dark ? "dark" : "light"})`, async ({ page }, info) => {
    const root = await mountScene(page, "preview", dark), pagination = root.locator(".mrp-pagination"), footer = root.locator(".mrp-footer");
    await expect(pagination).toBeVisible();
    await expectPaint(page, pagination, palette.surface, info, "pager-surface");
    await expectContained(pagination, footer);
    const geometry = await pagination.locator(".mrp-pageinfo,.mrp-page-buttons>button,.mrp-page-jump input,.mrp-page-jump>button").evaluateAll(elements => elements.map(element => { const box = element.getBoundingClientRect(); return { center: box.y + box.height / 2, right: box.right }; }));
    expect(Math.max(...geometry.map(box => box.center)) - Math.min(...geometry.map(box => box.center))).toBeLessThanOrEqual(1);
    const pagerBox = await pagination.boundingBox(), footerBox = await footer.boundingBox();
    expect(Math.abs(pagerBox!.y + pagerBox!.height - footerBox!.y - footerBox!.height)).toBeLessThanOrEqual(1);
    const settings = root.getByRole("button", { name: "设置", exact: true });
    await page.mouse.move(0, 0);
    await expect(settings).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expectReadable(settings);
    // Sample inside the 7px rounded border rather than its antialiased corner.
    await expectPaint(page, settings, palette.surface, info, "settings-button", { x: 6, y: 6 });
    await settings.hover();
    await expect(settings).toHaveCSS("background-color", dark ? "rgb(37, 58, 86)" : "rgb(237, 243, 255)");
    await expectPaint(page, settings, palette.selected, info, "settings-hover", { x: 6, y: 6 });
    await expectReadable(settings);
  });
}
