import { expect, test, type Page } from "@playwright/test";
import type { MachReportHandle } from "../packages/mach-report/src/vue/controller";
import type { RenderPlan, ReportEditBatch } from "../packages/mach-report/src/index";

interface Fixture { report: MachReportHandle; original: RenderPlan; saves: Array<{ batch: ReportEditBatch; action: string | undefined }>; conflict: boolean; delayMs?: number }
type FixtureWindow = Window & { __mrWorkflow: Fixture };

async function mountWorkflow(page: Page, readonly = false, multiHeader = false): Promise<void> {
  await page.goto("http://localhost:8610");
  await expect(page.getByText("产品出库单")).toBeVisible();
  await page.evaluate(async ({ readonly, multiHeader }) => {
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
    if (multiHeader) {
      const header = plan.pages[0]!.components[0]!;
      header.heightMm = 20;
      header.grid!.cells = [[{ text: "模拟多层表头", colSpan: 4 }], header.grid!.cells[0]!];
      plan.pages = [0, 1].map((index) => {
        const row = structuredClone(plan.pages[0]!.components[index + 1]!);
        row.topMm = 30;
        return { layout: "wide", pageWidthMm: 800, pageHeightMm: 100, components: [structuredClone(header), row] };
      });
    }
    const target = document.createElement("div"); target.id = "workflow-fixture"; target.style.cssText = "position:fixed;inset:0;z-index:9999"; document.body.append(target);
    createApp({ setup() {
      const report = useMachReport();
      const fixture: Fixture = { report, original: structuredClone(plan), saves: [], conflict: false };
      (window as FixtureWindow).__mrWorkflow = fixture;
      const editing = { requireSource: true, saveBatch: async (batch: Readonly<ReportEditBatch>, operation: { action?: string }) => {
        fixture.saves.push({ batch: structuredClone(batch), action: operation.action });
        if (fixture.delayMs) await new Promise((resolve) => setTimeout(resolve, fixture.delayMs));
        return fixture.conflict ? { conflicts: [{ message: "模拟版本冲突，请刷新后重试" }] } : { revision: fixture.saves.length + 1 };
      } };
      return () => h(ReportPreview, { ref: report.ref, reportId: "fixture", fetcher: async () => plan, editable: readonly ? false : editing, interaction: { freezeHeaders: true, frozenColumns: 1 }, height: "100vh", showExport: false, showPdfWindow: false, showPrint: false, messages: { title: "隔离模拟验收 · 单元格交互" } });
    } }).mount(target);
  }, { readonly, multiHeader });
  await expect(page.locator('#workflow-fixture .mrp-page-holder[data-page="1"]').getByText("业务编号", { exact: true })).toBeVisible();
}

test("只读报表保留表头语义，跨片段 Tab 可达且末格允许离开", async ({ page }) => {
  await mountWorkflow(page, true);
  const root = page.locator("#workflow-fixture");
  await expect(root.getByRole("columnheader")).toHaveCount(4);
  await page.evaluate(async () => {
    const report = (window as FixtureWindow).__mrWorkflow.report;
    const after = document.createElement("button"); after.id = "after-report"; after.textContent = "后续业务操作";
    after.style.cssText = "position:fixed;bottom:0;right:0;z-index:10001";
    document.getElementById("workflow-fixture")!.append(after);
    await report.focusCell({ pageIndex: 0, componentIndex: 1, rowIndex: 0, columnIndex: 3 });
  });
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => (window as FixtureWindow).__mrWorkflow.report.getSelection()?.focus)).toEqual({ pageIndex: 0, componentIndex: 2, rowIndex: 0, columnIndex: 0 });
  await page.evaluate(async () => (window as FixtureWindow).__mrWorkflow.report.focusCell({ pageIndex: 0, componentIndex: 120, rowIndex: 0, columnIndex: 3 }));
  await page.keyboard.press("Tab");
  await expect(page.locator("#after-report")).toBeFocused();
  await page.evaluate(async () => (window as FixtureWindow).__mrWorkflow.report.focusCell({ pageIndex: 0, componentIndex: 0, rowIndex: 0, columnIndex: 0 }));
  await page.keyboard.press("Shift+Tab");
  await expect(root.locator(".mrp-body")).toBeFocused();
});

test("搜索支持重新聚焦、Enter导航、Esc退出且忽略IME确认", async ({ page }) => {
  await mountWorkflow(page, true);
  const root = page.locator("#workflow-fixture");
  await root.locator(".mrp-body").focus();
  await page.keyboard.press("Control+f");
  const input = root.getByRole("textbox", { name: "内容搜索", exact: true });
  await expect(input).toBeFocused();
  await input.fill("模拟验收数据");
  await expect(root.locator(".mrp-search-count")).toHaveText("1/120");
  await input.evaluate((element) => element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true })));
  await expect(root.locator(".mrp-search-count")).toHaveText("1/120");
  await input.press("Enter");
  await expect(root.locator(".mrp-search-count")).toHaveText("2/120");
  await input.press("Shift+Enter");
  await expect(root.locator(".mrp-search-count")).toHaveText("1/120");
  await root.locator(".mrp-body").focus();
  await page.keyboard.press("Control+f");
  await expect(input).toBeFocused();
  await input.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(root.getByRole("button", { name: "内容搜索", exact: true })).toBeFocused();
});

test("缩略图是可键盘激活的具名页按钮", async ({ page }) => {
  await mountWorkflow(page, true);
  const root = page.locator("#workflow-fixture");
  await root.getByRole("button", { name: "▦ 缩略图", exact: true }).click();
  const thumbnail = root.getByRole("button", { name: "缩略图 · 1 / 1", exact: true });
  await thumbnail.focus();
  await thumbnail.press("Enter");
  await expect(thumbnail).toBeFocused();
  await expect(thumbnail).toHaveAttribute("aria-current", "page");
});

test("保存失败不会打开设置并把编辑器焦点留在弹窗后方", async ({ page }) => {
  await mountWorkflow(page);
  const root = page.locator("#workflow-fixture");
  await page.evaluate(() => { const fixture = (window as FixtureWindow).__mrWorkflow; fixture.conflict = true; fixture.delayMs = 150; });
  await root.locator('[data-mr-component-index="1"] td[data-mr-column-index="0"]').dblclick();
  const editor = root.getByRole("textbox", { name: "编辑单元格", exact: true });
  await editor.fill("12");
  await root.getByRole("button", { name: "设置", exact: true }).click();
  await expect(root.locator(".mrp-export-error")).toContainText("模拟版本冲突");
  await expect(root.getByRole("dialog")).toHaveCount(0);
  await expect(editor).toBeFocused();
  await expect(editor).toHaveAttribute("aria-invalid", "true");
});

test("多层重复表头不覆盖首行数据，跨页选区复制与粘贴保持业务身份", async ({ page }) => {
  await mountWorkflow(page, false, true);
  const root = page.locator("#workflow-fixture");
  await root.locator('[data-page="1"] [data-mr-component-index="1"] td[data-mr-column-index="0"]').click();
  await page.keyboard.press("Shift+ArrowDown");
  expect(await page.evaluate(() => (window as FixtureWindow).__mrWorkflow.report.getSelection()?.focus)).toEqual({ pageIndex: 1, componentIndex: 1, rowIndex: 0, columnIndex: 0 });
  await page.keyboard.press("Shift+ArrowRight");
  expect(await page.evaluate(() => (window as FixtureWindow).__mrWorkflow.report.copySelection())).toBe("2\t001\r\n3\t002");
  expect(await page.evaluate(() => (window as FixtureWindow).__mrWorkflow.report.pasteSelection("8\t008\r\n9\t009"))).toBe(true);
  expect(await page.evaluate(() => (window as FixtureWindow).__mrWorkflow.saves[0]!.batch.edits.map((edit) => edit.source?.rowKey))).toEqual(["R1", "R1", "R2", "R2"]);
  expect(await page.evaluate(() => (window as FixtureWindow).__mrWorkflow.report.getPlan()!.pages[0]!.components[0]!.grid!.cells.map((row) => row.map((cell) => cell?.text)))).toEqual([["模拟多层表头"], ["数量", "业务编号", "公式", "说明"]]);
});

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
