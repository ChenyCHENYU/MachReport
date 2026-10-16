import { expect, test, type Page } from "@playwright/test";
import type { MachReportHandle } from "../packages/mach-report/src/vue/controller";
import type { RenderPlan, ReportEditBatch } from "../packages/mach-report/src/index";

interface Fixture { report: MachReportHandle; original: RenderPlan; saves: Array<{ batch: ReportEditBatch; action: string | undefined }>; conflict: boolean }
type FixtureWindow = Window & { __mrWorkflow: Fixture };

async function mountWorkflow(page: Page): Promise<void> {
  await page.goto("http://localhost:8610");
  await expect(page.getByText("产品出库单")).toBeVisible();
  await page.evaluate(async () => {
    const source = await fetch("/src/main.ts").then((response) => response.text());
    const vueUrl = source.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)?.[1];
    const reportUrl = source.match(/from ["']([^"']*mach-report\/src\/vue\/index\.ts[^"']*)["']/)?.[1];
    if (!vueUrl || !reportUrl) throw new Error("Missing demo module URLs");
    const { createApp, h } = await import(vueUrl) as typeof import("vue");
    const { ReportPreview, useMachReport } = await import(reportUrl) as typeof import("../packages/mach-report/src/vue/index");
    const plan: RenderPlan = { schemaVersion: "fixture", pages: [{ layout: "wide", pageWidthMm: 800, pageHeightMm: 1000, components: [
      { kind: "rect", leftMm: 10, topMm: 10, widthMm: 780, heightMm: 10, style: { backgroundColor: "#e8eff8" }, table: { id: "orders", rowIndex: -1, role: "header", columnKeys: ["qty", "code", "formula", "note"], title: "模拟订单" }, grid: { colWidthsMm: [50, 100, 100, 530], cells: [[{ text: "数量" }, { text: "业务编号" }, { text: "公式" }, { text: "说明" }]] } },
      ...Array.from({ length: 120 }, (_, index) => ({ kind: "rect" as const, leftMm: 10, topMm: 20 + index * 8, widthMm: 780, heightMm: 8, table: { id: "orders", rowIndex: index, role: "body" as const, columnKeys: ["qty", "code", "formula", "note"], source: { datasetId: "orders", rowKey: `R${index + 1}`, revision: 1 } }, grid: { colWidthsMm: [50, 100, 100, 530], cells: [[{ value: index + 2, text: String(index + 2), valueType: "number" as const }, { value: `00${index + 1}`, text: `00${index + 1}` }, { value: 4, text: "4", formula: "A1*2" }, { value: "模拟验收数据", text: "模拟验收数据" }]] } }))
    ] }] };
    const target = document.createElement("div"); target.id = "workflow-fixture"; target.style.cssText = "position:fixed;inset:0;z-index:9999"; document.body.append(target);
    createApp({ setup() {
      const report = useMachReport();
      const fixture: Fixture = { report, original: structuredClone(plan), saves: [], conflict: false };
      (window as FixtureWindow).__mrWorkflow = fixture;
      const editing = { requireSource: true, saveBatch: async (batch: Readonly<ReportEditBatch>, operation: { action?: string }) => {
        fixture.saves.push({ batch: structuredClone(batch), action: operation.action });
        return fixture.conflict ? { conflicts: [{ message: "模拟版本冲突，请刷新后重试" }] } : { revision: fixture.saves.length + 1 };
      } };
      return () => h(ReportPreview, { ref: report.ref, reportId: "fixture", fetcher: async () => plan, editable: editing, interaction: { freezeHeaders: true, frozenColumns: 1 }, height: "100vh", showExport: false, showPdfWindow: false, showPrint: false, messages: { title: "隔离模拟验收 · 单元格交互" } });
    } }).mount(target);
  });
  await expect(page.locator("#workflow-fixture .mrp-page-holder").getByText("业务编号", { exact: true })).toBeVisible();
}

test("真实键盘选区、矩形粘贴、原子校验、保存型撤销及冲突反馈", async ({ page }) => {
  await mountWorkflow(page);
  const root = page.locator("#workflow-fixture");
  const first = root.locator('[data-mr-component-index="1"] td[data-mr-column-index="0"]');
  await first.click();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(root.locator(".mrp-cell-selected")).toHaveCount(2);
  expect(await page.evaluate(() => (window as FixtureWindow).__mrWorkflow.report.copySelection())).toBe("2\t001");
  await first.evaluate((element) => { const data = new DataTransfer(); data.setData("text/plain", "8\t0008\r\n9\t0009"); element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: data })); });
  await expect(root.locator(".mrp-cell-modified")).toHaveCount(4);
  expect(await page.evaluate(() => (window as FixtureWindow).__mrWorkflow.saves[0]?.batch.edits.map((edit) => edit.source?.rowKey))).toEqual(["R1", "R1", "R2", "R2"]);
  await root.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(root.locator(".mrp-cell-modified")).toHaveCount(0);
  expect(await page.evaluate(() => (window as FixtureWindow).__mrWorkflow.saves.at(-1)?.action)).toBe("undo");
  await root.getByRole("button", { name: "重做", exact: true }).click();
  await expect(root.locator(".mrp-cell-modified")).toHaveCount(4);
  await page.evaluate(() => { (window as FixtureWindow).__mrWorkflow.conflict = true; });
  await root.getByRole("button", { name: "恢复来源值", exact: true }).click();
  await expect(root.locator(".mrp-conflicts")).toContainText("模拟版本冲突");
  await expect(root.locator(".mrp-cell-modified")).toHaveCount(4);
  await page.evaluate(() => { (window as FixtureWindow).__mrWorkflow.conflict = false; });
  await root.getByRole("button", { name: "恢复来源值", exact: true }).click();
  await expect(root.locator(".mrp-cell-modified")).toHaveCount(0);
  await first.dblclick();
  const editor = root.getByRole("textbox", { name: "编辑单元格", exact: true });
  await editor.fill("12"); await editor.press("Tab");
  await expect(root.locator(".mrp-cell-focus")).toContainText("001");
  await expect(root.locator(".mrp-cell-modified")).toHaveCount(1);
  expect(await page.evaluate(() => (window as FixtureWindow).__mrWorkflow.original.pages[0]!.components[1]!.grid!.cells[0]![0]!.value)).toBe(2);
});

test("宽表冻结表头和身份列仅作用屏幕，关闭后恢复原几何", async ({ page }, testInfo) => {
  await mountWorkflow(page);
  const root = page.locator("#workflow-fixture");
  const viewport = root.locator(".mrp-body");
  const before = await page.evaluate(() => JSON.stringify((window as FixtureWindow).__mrWorkflow.report.getPlan()));
  await viewport.evaluate((element) => { element.scrollLeft = 400; element.scrollTop = 160; });
  await expect.poll(async () => root.locator('[data-mr-component-index="0"]').evaluate((element) => (element as HTMLElement).style.transform)).toContain("translateY");
  const header = await root.locator('[data-mr-component-index="0"] td[data-mr-column-index="0"]').boundingBox();
  const bounds = await viewport.boundingBox();
  expect(header!.x).toBeGreaterThanOrEqual(bounds!.x - 2);
  expect(header!.x).toBeLessThan(bounds!.x + 4);
  expect(header!.y).toBeGreaterThanOrEqual(bounds!.y - 2);
  expect(header!.y).toBeLessThan(bounds!.y + 4);
  expect(await page.evaluate(() => JSON.stringify((window as FixtureWindow).__mrWorkflow.report.getPlan()))).toBe(before);
  await testInfo.attach("screen-only-frozen-panes.png", { body: await page.screenshot(), contentType: "image/png" });
  await root.getByRole("button", { name: "设置", exact: true }).click();
  const dialog = root.getByRole("dialog", { name: "设置", exact: true });
  await dialog.getByRole("checkbox", { name: "冻结表头", exact: true }).uncheck();
  await dialog.getByRole("spinbutton", { name: "冻结前列", exact: true }).fill("0");
  await dialog.getByRole("spinbutton", { name: "冻结前列", exact: true }).press("Tab");
  await page.keyboard.press("Escape");
  await expect.poll(async () => root.locator('[data-mr-component-index="0"]').evaluate((element) => getComputedStyle(element).transform)).toBe("none");
  await expect(root.locator(".mrp-cell-frozen")).toHaveCount(0);
});
