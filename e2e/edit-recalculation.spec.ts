import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const ExcelJSRuntime = createRequire(new URL("../packages/mach-report/package.json", import.meta.url))("exceljs") as { Workbook: new () => Awaited<ReturnType<typeof import("../packages/mach-report/src/xlsx/render-xlsx")["renderPlanToXlsx"]>>["workbook"] };
import type { MachReportHandle } from "../packages/mach-report/src/vue/controller";
import type { ReportEditBatch } from "../packages/mach-report/src/index";
interface RecalculationFixture { report: MachReportHandle; saves: Array<{ batch: ReportEditBatch; action?: string }>; sourceQty: number }
type RecalculationWindow = Window & { __mrRecalculation: RecalculationFixture };

test("真实来源报表编辑联动计算、样式、汇总、隐藏行历史和实际Excel输出", async ({ page }) => {
  await page.goto("http://localhost:8610"); await expect(page.getByText("产品出库单")).toBeVisible();
  await page.evaluate(async () => {
    const moduleSource = await fetch("/src/main.ts").then((response) => response.text());
    const vueUrl = moduleSource.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)?.[1];
    const reportUrl = moduleSource.match(/from ["']([^"']*mach-report\/src\/vue\/index\.ts[^"']*)["']/)?.[1];
    if (!vueUrl || !reportUrl) throw new Error("Missing demo modules");
    const { createApp, h } = await import(vueUrl) as typeof import("vue");
    const { ReportPreview, useMachReport, createTableTemplate, createReportSource } = await import(reportUrl) as typeof import("../packages/mach-report/src/vue/index");
    const template = createTableTemplate({ layout: "wide", title: "Source calculation report", columns: [
      { field: "id", header: "ID" }, { field: "qty", header: "Qty", valueType: "number" }, { field: "price", header: "Price" },
      { field: "amount", header: "Amount", rules: [{ when: { field: "amount", op: ">", value: 10 }, style: { color: "#ff0000" } }] }
    ], listOptions: { rowKey: "id", revisionField: "rev", sourceTokenField: "token", rowVisibleWhen: { field: "qty", op: ">", value: 0 }, computed: [{ field: "amount", expression: { op: "multiply", args: [{ field: "qty" }, { field: "price" }] } }], grandTotal: { fields: ["amount"] } } });
    const datasets = { detail: [{ id: "001", qty: 2, price: 3, rev: "1", token: "v1" }, { id: "002", qty: 3, price: 4, rev: "1", token: "v1" }] };
    const fetcher = createReportSource({ source: { template, datasets } });
    const target = document.createElement("div"); target.id = "source-recalculation-fixture"; target.style.cssText = "position:fixed;inset:0;z-index:9999"; document.body.append(target);
    createApp({ setup() {
      const report = useMachReport(), saves: RecalculationFixture["saves"] = [];
      (window as RecalculationWindow).__mrRecalculation = { report, saves, get sourceQty() { return datasets.detail[0]!.qty; } };
      return () => h(ReportPreview, { ref: report.ref, reportId: "source", fetcher, height: "100vh", showPdfWindow: false, showPrint: false, editable: {
        requireSource: true,
        saveBatch: async (batch, operation) => { saves.push({ batch: JSON.parse(JSON.stringify(batch)), action: operation.action }); return { revision: String(saves.length + 1), sourceToken: `v${saves.length + 1}` }; }
      } });
    } }).mount(target);
  });
  const root = page.locator("#source-recalculation-fixture");
  const qty = root.locator('[data-mr-component-index="2"] td[data-mr-column-index="1"]');
  const amount = root.locator('[data-mr-component-index="2"] td[data-mr-column-index="3"]');
  await expect(qty).toHaveText("2");
  await qty.dblclick(); const editor = root.getByRole("textbox", { name: "编辑单元格", exact: true });
  await editor.fill("5"); await editor.press("Enter");
  await expect(qty).toHaveText("5"); await expect(amount).toHaveText("15"); await expect(amount).toHaveCSS("color", "rgb(255, 0, 0)");
  expect(await page.evaluate(() => (window as RecalculationWindow).__mrRecalculation.sourceQty)).toBe(2);
  await root.getByRole("button", { name: "撤销", exact: true }).click(); await expect(amount).toHaveText("6");
  await root.getByRole("button", { name: "重做", exact: true }).click(); await expect(amount).toHaveText("15");
  await qty.dblclick(); await editor.fill("0"); await editor.press("Enter");
  await expect(root.locator(".mrp-cell-modified")).toHaveCount(0);
  expect(await page.evaluate(() => (window as RecalculationWindow).__mrRecalculation.report.getSelection())).toBeNull();
  expect(await page.evaluate(() => (window as RecalculationWindow).__mrRecalculation.report.getPlan()!.pages.flatMap((item) => item.components).filter((item) => item.table?.role === "body").map((item) => item.table!.source!.rowKey))).toEqual(["002"]);
  await root.getByRole("button", { name: "撤销", exact: true }).click(); await expect(qty).toHaveText("5"); await expect(amount).toHaveText("15");
  expect(await page.evaluate(() => (window as RecalculationWindow).__mrRecalculation.saves.map((save) => save.action))).toEqual(["edit", "undo", "redo", "edit", "undo"]);
  const downloading = page.waitForEvent("download");
  await page.evaluate(async () => (window as RecalculationWindow).__mrRecalculation.report.exportAs("xlsx"));
  const download = await downloading, file = await download.path(); if (!file) throw new Error("Missing XLSX download");
  const workbook = new ExcelJSRuntime.Workbook(); await workbook.xlsx.load(await readFile(file));
  const sheet = workbook.worksheets[0]!;
  expect(workbook.worksheets).toHaveLength(1); expect(sheet.rowCount).toBe(5);
  expect(sheet.getCell("B3").value).toBe(5); expect(sheet.getCell("D3").value).toBe(15); expect(sheet.getCell("D4").value).toBe(12); expect(sheet.getCell("D5").value).toBe(27);
});
