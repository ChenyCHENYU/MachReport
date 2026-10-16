import { expect, test } from "@playwright/test";
import type { MachReportHandle } from "../packages/mach-report/src/vue/controller";
import type { RenderPlan, ReportCellEdit } from "../packages/mach-report/src/index";

type TypedWindow = Window & { __typedReport: { report: MachReportHandle; saves: ReportCellEdit[] } };

test("类型编辑器提供单位约束、准确值、主题继承及只读保护", async ({ page }) => {
  await page.goto("http://localhost:8610"); await expect(page.getByText("产品出库单")).toBeVisible();
  await page.evaluate(async () => {
    const source = await fetch("/src/main.ts").then((response) => response.text());
    const vueUrl = source.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)?.[1];
    const reportUrl = source.match(/from ["']([^"']*mach-report\/src\/vue\/index\.ts[^"']*)["']/)?.[1];
    if (!vueUrl || !reportUrl) throw new Error("Missing demo module URLs");
    const { createApp, h } = await import(vueUrl) as typeof import("vue");
    const { ReportPreview, useMachReport, provideMachReportConfig } = await import(reportUrl) as typeof import("../packages/mach-report/src/vue/index");
    const target = document.createElement("div"); target.id = "typed-fixture"; target.style.cssText = "position:fixed;inset:0;z-index:9999"; document.body.append(target);
    const plan: RenderPlan = { schemaVersion: "typed", pages: [{ layout: "wide", pageWidthMm: 300, pageHeightMm: 100, components: [{
      kind: "rect", leftMm: 10, topMm: 10, widthMm: 280, heightMm: 12,
      table: { id: "orders", rowIndex: 0, role: "body", columnKeys: ["qty", "enabled", "status", "date", "protected"], source: { datasetId: "orders", rowKey: "R1" } },
      grid: { colWidthsMm: [56, 56, 56, 56, 56], cells: [[{ value: 3, text: "3", valueType: "number" }, { value: false, text: "否" }, { value: "open", text: "open" }, { value: "2026-10-16", text: "2026-10-16" }, { value: "2026-10-16", text: "2026-10-16", editable: false }]] }
    }] }] };
    createApp({ setup() {
      const report = useMachReport(); const saves: ReportCellEdit[] = []; (window as TypedWindow).__typedReport = { report, saves };
      provideMachReportConfig({ theme: { shellBg: "#f7f8fa", shellFg: "#123456", toolbarBg: "#ffffff", toolbarFg: "#123456" } });
      return () => h(ReportPreview, { ref: report.ref, reportId: "typed", fetcher: async () => plan, height: "100vh", editable: {
        fields: { qty: { type: "number", label: "净重", hint: "录入实际净重", unit: "吨", min: 0, max: 10, precision: 2 }, enabled: { type: "boolean", label: "启用" }, status: { type: "enum", label: "状态", options: [{ value: "open", label: "进行中" }, { value: "done", label: "已完成" }] }, date: { type: "date", label: "业务日期", min: "2026-01-01", max: "2026-12-31" }, protected: { type: "date" } },
        save: async (edit) => { saves.push(structuredClone(edit)); }
      } });
    } }).mount(target);
  });
  const root = page.locator("#typed-fixture");
  const cell = (index: number) => root.locator(`td[data-mr-column-index="${index}"]`);
  await expect(cell(0)).toBeVisible(); await cell(0).dblclick();
  const number = root.getByRole("textbox", { name: "净重", exact: true }); await expect(number).toBeFocused();
  await expect(root.locator(".mrp-cell-editor-hint")).toContainText("录入实际净重 · 吨");
  expect(await number.evaluate((input) => getComputedStyle(input).backgroundColor)).toBe("rgb(255, 255, 255)");
  await number.fill("10.01"); await number.press("Enter"); await expect(number).toHaveAttribute("aria-invalid", "true");
  await expect(root.locator(".mrp-cell-editor-hint")).toHaveText("净重不能大于 10");
  expect(await page.evaluate(() => (window as TypedWindow).__typedReport.saves.length)).toBe(0);
  await number.fill("0"); await number.press("Tab"); await expect(root.locator(".mrp-cell-editor")).toHaveCount(0);
  await cell(1).dblclick(); const bool = root.getByRole("combobox", { name: "启用", exact: true }); await bool.selectOption({ label: "是" }); await bool.press("Enter");
  await cell(2).dblclick(); const status = root.getByRole("combobox", { name: "状态", exact: true }); await status.selectOption({ label: "已完成" }); await status.press("Enter");
  await cell(3).dblclick(); const date = root.getByLabel("业务日期", { exact: true }); await date.fill("2026-11-01"); await date.press("Enter");
  expect(await page.evaluate(() => (window as TypedWindow).__typedReport.saves.map((edit) => edit.value))).toEqual([0, true, "done", "2026-11-01"]);
  await cell(4).dblclick(); await expect(root.locator(".mrp-cell-editor")).toHaveCount(0);
});
