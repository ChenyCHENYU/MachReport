/* eslint-disable vue/one-component-per-file -- 两个独立浏览器夹具，各自挂载并由页面生命周期清理 */
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const coreUrl = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/index.ts", import.meta.url))}`;
const xlsxUrl = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/xlsx.ts", import.meta.url))}`;

interface ImportFixture {
  exportExcel(): Promise<void>;
  enableImport(value: boolean): void;
  fileBytes(): number[];
  importEvents(): number;
}

type SaveMode = "immediate" | "reject" | "pending";
interface EditingFixture {
  enable(value: boolean): void;
  setSaveMode(value: SaveMode): void;
  resolveSave(): void;
  reload(quantity: number): Promise<void>;
  exportExcel(): Promise<void>;
  snapshot(): {
    changes: number;
    errors: string[];
    cells: Array<{ text?: string; value?: string | number | boolean | null }>;
    sourceQuantity: number | null;
    saving: boolean;
    dirty: boolean;
  };
}

declare global {
  interface Window {
    mrImportFixture: ImportFixture;
    mrEditingFixture: EditingFixture;
  }
}

async function mountEditingFixture(page: Page) {
  await openExample(page);
  await page.evaluate(async (coreUrl) => {
    const moduleSource = await fetch("/src/main.ts").then((response) => response.text());
    const vueUrl = moduleSource.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)?.[1];
    const reportUrl = moduleSource.match(/from ["']([^"']*mach-report\/src\/vue\/index\.ts[^"']*)["']/)?.[1];
    if (!vueUrl || !reportUrl) throw new Error("未找到当前示例的 Vue / 预览模块");
    const { createApp, h, nextTick, ref } = await import(vueUrl) as typeof import("vue");
    const { ReportPreview } = await import(reportUrl) as typeof import("../packages/mach-report/src/vue/index");
    const { createTableTemplate, paginateTemplate } = await import(/* @vite-ignore */ coreUrl) as typeof import("../packages/mach-report/src/index");
    const template = createTableTemplate({
      layout: "wide", title: "可编辑报表", columns: [
        { header: "文本编号", field: "code" },
        { header: "数量", field: "quantity", format: { kind: "number", digits: 3 } }
      ]
    });
    const makePlan = (quantity: number) => paginateTemplate(template, { detail: [{ code: "00123", quantity }] }).plan;
    const initialPlan = makePlan(12.5);
    let sourcePlan = initialPlan;
    const enabled = ref(false);
    const preview = ref<InstanceType<typeof ReportPreview> | null>(null);
    const errors: string[] = [];
    let saveMode: SaveMode = "immediate";
    let releaseSave: (() => void) | undefined;
    const editing = {
      validate: (edit: { value: unknown }) => edit.value === -1 ? "数量不能为 -1" : undefined,
      save: async () => {
        if (saveMode === "reject") throw new Error("保存被业务接口拒绝");
        if (saveMode === "pending") await new Promise<void>((resolve) => { releaseSave = resolve; });
      }
    };
    const target = document.createElement("div");
    target.id = "editing-feature-fixture";
    target.style.cssText = "position:fixed;inset:0;z-index:9999";
    document.body.append(target);
    await new Promise<void>((resolve) => {
      createApp({ render: () => h(ReportPreview, {
        ref: preview, reportId: "edit-fixture", fetcher: async () => sourcePlan,
        editable: enabled.value ? editing : false,
        height: "100vh", showExport: false, showPrint: false, showPdfWindow: false,
        onError: (message: string) => errors.push(message),
        onLoaded: async () => { await nextTick(); resolve(); }
      }) }).mount(target);
    });
    window.mrEditingFixture = {
      enable: (value) => { enabled.value = value; },
      setSaveMode: (value) => { saveMode = value; },
      resolveSave: () => { releaseSave?.(); },
      reload: async (quantity) => { sourcePlan = makePlan(quantity); await preview.value!.reload(); },
      exportExcel: async () => { await preview.value!.exportAs("xlsx"); },
      snapshot: () => {
        const plan = preview.value!.getPlan();
        const cells = plan?.pages.flatMap((page) => page.components.flatMap((component) => component.grid?.cells.flatMap((row) => row
          .filter((cell) => cell !== null).map((cell) => ({ text: cell!.text, value: cell!.value }))) ?? [])) ?? [];
        const initialBody = initialPlan.pages.flatMap((page) => page.components).find((component) => component.table?.role === "body");
        return { changes: preview.value!.getChanges().length, errors: [...errors], cells,
          sourceQuantity: initialBody?.grid?.cells[0]?.[1]?.value as number | null,
          saving: preview.value!.state.saving, dirty: preview.value!.state.dirty };
      }
    };
  }, coreUrl);
}

test("编辑默认关闭；双击、Esc、Enter 保持文本编号与数值 0，计划与 Excel 导出同步", async ({ page }) => {
  await mountEditingFixture(page);
  const root = page.locator("#editing-feature-fixture");
  const cell = (text: RegExp) => root.locator("td").filter({ hasText: text });
  await cell(/^00123$/).dblclick();
  await expect(root.locator(".mrp-cell-editor")).toHaveCount(0);
  await page.evaluate(() => window.mrEditingFixture.enable(true));
  await cell(/^文本编号$/).dblclick();
  await expect(root.locator(".mrp-cell-editor")).toHaveCount(0);
  await cell(/^00123$/).dblclick();
  const editor = root.getByRole("textbox", { name: "编辑单元格" });
  await expect(editor).toHaveValue("00123");
  await editor.fill("00000");
  await editor.press("Escape");
  await expect(cell(/^00123$/)).toBeVisible();
  await cell(/^00123$/).dblclick();
  await editor.fill("00999");
  await editor.press("Enter");
  await expect(cell(/^00999$/)).toBeVisible();
  await cell(/^12\.500$/).dblclick();
  await editor.fill("0");
  await editor.press("Enter");
  await expect(cell(/^0\.000$/)).toBeVisible();
  const state = await page.evaluate(() => window.mrEditingFixture.snapshot());
  expect(state.changes).toBe(2);
  expect(state.dirty).toBe(true);
  expect(state.sourceQuantity).toBe(12.5);
  expect(state.cells).toEqual(expect.arrayContaining([{ text: "00999", value: "00999" }, { text: "0.000", value: 0 }]));
  const downloadPromise = page.waitForEvent("download", { predicate: (download) => download.suggestedFilename().endsWith(".xlsx") });
  await page.evaluate(() => window.mrEditingFixture.exportExcel());
  const download = await downloadPromise;
  const saved = await readFile((await download.path())!);
  const values = await page.evaluate(async ({ bytes, xlsxUrl }) => {
    const { importExcelTemplate } = await import(/* @vite-ignore */ xlsxUrl) as typeof import("../packages/mach-report/src/xlsx");
    const { template } = await importExcelTemplate(new Uint8Array(bytes));
    return template.pages.flatMap((page) => page.components.flatMap((component) => "grid" in component && component.grid
      ? component.grid.cells.flatMap((row) => row.flatMap((cell) => cell ? [cell.value] : [])) : []));
  }, { bytes: Array.from(saved), xlsxUrl });
  expect(values).toContain(0);
  expect(values).toContain("00999");
});

test("业务校验或保存失败不更新计划，异步保存不会覆盖重新加载的报表", async ({ page }) => {
  await mountEditingFixture(page);
  const root = page.locator("#editing-feature-fixture");
  const quantity = root.locator("td").filter({ hasText: /^12\.500$/ });
  const editor = root.getByRole("textbox", { name: "编辑单元格" });
  await page.evaluate(() => window.mrEditingFixture.enable(true));
  await quantity.dblclick();
  await editor.fill("-1");
  await editor.press("Enter");
  await expect.poll(() => page.evaluate(() => window.mrEditingFixture.snapshot().errors.join(" "))).toContain("数量不能为 -1");
  expect((await page.evaluate(() => window.mrEditingFixture.snapshot())).changes).toBe(0);
  await editor.press("Escape");
  await page.evaluate(() => window.mrEditingFixture.setSaveMode("reject"));
  await quantity.dblclick();
  await editor.fill("21");
  await editor.press("Enter");
  await expect.poll(() => page.evaluate(() => window.mrEditingFixture.snapshot().errors.join(" "))).toContain("保存被业务接口拒绝");
  expect((await page.evaluate(() => window.mrEditingFixture.snapshot())).changes).toBe(0);
  await editor.press("Escape");
  await page.evaluate(() => window.mrEditingFixture.setSaveMode("pending"));
  await quantity.dblclick();
  await editor.fill("99");
  await editor.press("Enter");
  await expect.poll(() => page.evaluate(() => window.mrEditingFixture.snapshot().saving)).toBe(true);
  await page.evaluate(() => { void window.mrEditingFixture.reload(7); });
  await root.getByRole("alertdialog").getByRole("button", { name: "放弃修改并继续", exact: true }).click();
  await expect(root.locator("td").filter({ hasText: /^7\.000$/ })).toBeVisible();
  await page.evaluate(() => window.mrEditingFixture.resolveSave());
  await expect.poll(() => page.evaluate(() => window.mrEditingFixture.snapshot().saving)).toBe(false);
  const state = await page.evaluate(() => window.mrEditingFixture.snapshot());
  expect(state.changes).toBe(0);
  expect(state.cells).toContainEqual({ text: "7.000", value: 7 });
  expect(state.cells.some((cell) => cell.value === 99)).toBe(false);
});

async function openExample(page: Page): Promise<void> {
  await page.goto("http://localhost:8610");
  await expect(page.getByText("产品出库单")).toBeVisible({ timeout: 10000 });
}

async function mountImportedWorkbook(page: Page, editable = false) {
  await openExample(page);
  return page.evaluate(async ({ coreUrl, xlsxUrl, editable }) => {
    const moduleSource = await fetch("/src/main.ts").then((response) => response.text());
    const vueUrl = moduleSource.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)?.[1];
    const reportUrl = moduleSource.match(/from ["']([^"']*mach-report\/src\/vue\/index\.ts[^"']*)["']/)?.[1];
    if (!vueUrl || !reportUrl) throw new Error("未找到当前示例的 Vue / 预览模块");
    const { createApp, h, nextTick, ref } = await import(vueUrl) as typeof import("vue");
    const { ReportPreview } = await import(reportUrl) as typeof import("../packages/mach-report/src/vue/index");
    const { paginateTemplate, RENDER_PLAN_SCHEMA_VERSION } = await import(/* @vite-ignore */ coreUrl) as typeof import("../packages/mach-report/src/index");
    const { importExcelTemplate, renderPlanToXlsx } = await import(/* @vite-ignore */ xlsxUrl) as typeof import("../packages/mach-report/src/xlsx");
    const { workbook } = await renderPlanToXlsx({ schemaVersion: RENDER_PLAN_SCHEMA_VERSION, pages: [] });
    const sheet = workbook.addWorksheet("编辑模板");
    sheet.columns = [{ width: 22 }, { width: 14 }, { width: 18 }];
    sheet.mergeCells("A1:C1");
    sheet.getCell("A1").value = "导入合并标题";
    sheet.getCell("A1").font = { name: "Arial", bold: true, size: 16, color: { argb: "FF173A5E" } };
    sheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
    sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F1FC" } };
    sheet.getRow(1).height = 28;
    sheet.addRow(["00123", 0, { formula: "1+1", result: 2 }]);
    sheet.getCell("B2").numFmt = "0.000";
    sheet.getCell("C2").numFmt = "0.00";
    sheet.addRow(["<img src=x onerror=alert(1)>", false, "保留文本"]);
    const wide = workbook.addWorksheet("完整宽表");
    for (let column = 1; column <= 82; column++) {
      wide.getColumn(column).width = 12;
      wide.getCell(1, column).value = `字段${column}`;
    }
    for (let row = 2; row <= 2001; row++) {
      for (let column = 1; column <= 82; column++) wide.getCell(row, column).value = `${row}:${column}`;
    }
    wide.getCell(2001, 82).value = "导入末端目标2001";
    const input = new Uint8Array(await workbook.xlsx.writeBuffer());
    const started = performance.now();
    const result = await importExcelTemplate(input, { maxRowsPerPage: 80 });
    const { plan } = paginateTemplate(result.template, {});
    const target = document.createElement("div");
    target.id = "import-feature-fixture";
    target.style.cssText = "position:fixed;inset:0;z-index:9999";
    document.body.append(target);
    const preview = ref<InstanceType<typeof ReportPreview> | null>(null);
    const importEnabled = ref(false);
    let imports = 0;
    await new Promise<void>((resolve) => {
      createApp({ render: () => h(ReportPreview, {
        ref: preview, reportId: "import-fixture", fetcher: async () => plan,
        editable, excelImport: importEnabled.value, height: "100vh", showExport: false, showPrint: false, showPdfWindow: false,
        onTemplateImport: () => { imports++; },
        onLoaded: async () => {
          await nextTick();
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }
      }) }).mount(target);
    });
    window.mrImportFixture = {
      exportExcel: async () => { await preview.value!.exportAs("xlsx"); },
      enableImport: (value) => { importEnabled.value = value; },
      fileBytes: () => Array.from(input),
      importEvents: () => imports
    };
    return { sheets: result.sheets, warnings: result.warnings, pages: plan.pages.length, importAndPaintMs: performance.now() - started };
  }, { coreUrl, xlsxUrl, editable });
}

test("Excel 导入保留多 Sheet、合并样式与原始类型，完整宽表可搜索到最右下角", async ({ page }, testInfo) => {
  const result = await mountImportedWorkbook(page);
  const root = page.locator("#import-feature-fixture");
  expect(result.sheets.map((sheet) => ({ name: sheet.name, rows: sheet.rowCount, columns: sheet.columnCount }))).toEqual([
    { name: "编辑模板", rows: 3, columns: 3 },
    { name: "完整宽表", rows: 2001, columns: 82 }
  ]);
  expect(result.warnings.join(" ")).toContain("公式");
  const title = root.locator("td").filter({ hasText: /^导入合并标题$/ });
  await expect(title).toHaveAttribute("colspan", "3");
  await expect(title).toHaveCSS("text-align", "center");
  await expect(title).toHaveCSS("background-color", "rgb(232, 241, 252)");
  await expect(root.locator("td").filter({ hasText: /^00123$/ })).toBeVisible();
  await expect(root.locator("td").filter({ hasText: /^0\.000$/ })).toBeVisible();
  await expect(root.locator("td").filter({ hasText: /^2\.00$/ })).toBeVisible();
  await root.locator("td").filter({ hasText: /^00123$/ }).dblclick();
  await expect(root.locator(".mrp-cell-editor")).toHaveCount(0);
  expect(await root.locator("img[src='x']").count()).toBe(0);
  await root.getByRole("button", { name: "内容搜索" }).click();
  await root.locator(".mrp-search-input").fill("导入末端目标2001");
  await expect(root.locator(".mrp-search-count")).toHaveText("1/1");
  const hit = root.locator("mark.mrp-hit");
  await expect(hit).toHaveText("导入末端目标2001");
  const viewport = root.locator(".mrp-body");
  const viewportBox = (await viewport.boundingBox())!;
  const hitBox = (await hit.boundingBox())!;
  expect(hitBox.x).toBeGreaterThanOrEqual(viewportBox.x);
  expect(hitBox.x + hitBox.width).toBeLessThanOrEqual(viewportBox.x + viewportBox.width);
  expect(await root.locator(".mrp-page-holder").count()).toBeLessThanOrEqual(4);
  await testInfo.attach("excel-import-metrics.json", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
  await testInfo.attach("excel-import-wide.png", { body: await page.screenshot(), contentType: "image/png" });
});

test("导入默认只读；开启编辑后公式缓存格仍只读；导出保持两张完整 Sheet", async ({ page }) => {
  await mountImportedWorkbook(page, true);
  const root = page.locator("#import-feature-fixture");
  await root.locator("td").filter({ hasText: /^2\.00$/ }).dblclick();
  await expect(root.locator(".mrp-cell-editor")).toHaveCount(0);
  const downloadPromise = page.waitForEvent("download", { predicate: (download) => download.suggestedFilename().endsWith(".xlsx") });
  // If encoding fails, surface its actual diagnostic instead of masking it with a download timeout.
  void downloadPromise.catch(() => {});
  await page.evaluate(() => window.mrImportFixture.exportExcel());
  expect(await root.locator(".mrp-export-error").allTextContents()).toEqual([]);
  const download = await downloadPromise;
  expect(await download.failure()).toBeNull();
  const saved = await readFile((await download.path())!);
  const roundtrip = await page.evaluate(async ({ bytes, xlsxUrl }) => {
    const { importExcelTemplate } = await import(/* @vite-ignore */ xlsxUrl) as typeof import("../packages/mach-report/src/xlsx");
    const result = await importExcelTemplate(new Uint8Array(bytes));
    return {
      sheets: result.sheets.map(({ name, rowCount, columnCount }) => ({ name, rowCount, columnCount })),
      cells: result.template.pages.flatMap((page) => page.components.flatMap((component) => "grid" in component && component.grid
        ? component.grid.cells.flatMap((row) => row.filter((cell) => cell !== null && ["00123", 0, 2, "导入末端目标2001"].includes(cell!.value as string | number)).map((cell) => ({ text: cell!.text, value: cell!.value }))) : []))
    };
  }, { bytes: Array.from(saved), xlsxUrl });
  expect(roundtrip.sheets).toEqual([
    { name: "编辑模板", rowCount: 3, columnCount: 3 },
    { name: "完整宽表", rowCount: 2001, columnCount: 82 }
  ]);
  expect(roundtrip.cells).toEqual(expect.arrayContaining([
    { text: "00123", value: "00123" }, { text: "0.000", value: 0 },
    { text: "2.00", value: 2 }, { text: "导入末端目标2001", value: "导入末端目标2001" }
  ]));
});

test("Excel 模板导入入口默认关闭，开启后选文件即替换预览并通知宿主", async ({ page }) => {
  await mountImportedWorkbook(page);
  const root = page.locator("#import-feature-fixture");
  const button = root.getByRole("button", { name: "导入 Excel 模板" });
  await expect(button).toHaveCount(0);
  await expect(root.locator(".mrp-import-input")).toHaveCount(0);
  await page.evaluate(() => window.mrImportFixture.enableImport(true));
  await expect(button).toBeVisible();
  const bytes = await page.evaluate(() => window.mrImportFixture.fileBytes());
  await root.locator(".mrp-import-input").setInputFiles({
    name: "工作簿模板.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(bytes)
  });
  await expect.poll(() => page.evaluate(() => window.mrImportFixture.importEvents())).toBe(1);
  await expect(root.locator("td").filter({ hasText: /^导入合并标题$/ })).toBeVisible();
  await page.evaluate(() => window.mrImportFixture.enableImport(false));
  await expect(button).toHaveCount(0);
});

test("82 列横向滚动与 150% 缩放后编辑框仍贴合真实单元格", async ({ page }, testInfo) => {
  await mountImportedWorkbook(page, true);
  const root = page.locator("#import-feature-fixture");
  await root.getByRole("button", { name: "150%", exact: true }).click();
  await root.getByRole("button", { name: "内容搜索" }).click();
  await root.locator(".mrp-search-input").fill("导入末端目标2001");
  await expect(root.locator(".mrp-search-count")).toHaveText("1/1");
  const cell = root.locator("td").filter({ hasText: /^导入末端目标2001$/ });
  await expect.poll(() => root.locator(".mrp-body").evaluate((viewport) => viewport.scrollLeft)).toBeGreaterThan(1000);
  await cell.dblclick();
  const editor = root.getByRole("textbox", { name: "编辑单元格" });
  await expect(editor).toHaveValue("导入末端目标2001");
  const cellBox = (await cell.boundingBox())!;
  const editorBox = (await editor.boundingBox())!;
  expect(Math.abs(editorBox.x - cellBox.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(editorBox.y - cellBox.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(editorBox.width - cellBox.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(editorBox.height - cellBox.height)).toBeLessThanOrEqual(2);
  await testInfo.attach("wide-import-editor-150.png", { body: await page.screenshot(), contentType: "image/png" });
  await editor.fill("导入末端已修订");
  await editor.press("Enter");
  await expect(root.locator("td").filter({ hasText: /^导入末端已修订$/ })).toBeVisible();
});
