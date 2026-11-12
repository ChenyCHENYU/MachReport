import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import type { MachReportHandle } from "../packages/mach-report/src/vue/controller";

interface HardeningFixture {
  reports: MachReportHandle[];
  saves: Array<{ reportId: string; revision?: string; token?: string }>;
  preferences: Array<{ key: string; zoom: number | "fit" | undefined }>;
  releasePreferences?: () => void;
  rows: Record<string, { qty: number; revision: number }>;
}
declare global { interface Window { __hardening: HardeningFixture } }
async function mount(page: Page, dense = false) {
  await page.goto("http://localhost:8610"); await expect(page.getByText("产品出库单")).toBeVisible();
  const coreUrl = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/index.ts", import.meta.url))}`;
  await page.evaluate(async ({ coreUrl, dense }) => {
    const entry = await fetch("/src/main.ts").then(response => response.text());
    const vueUrl = entry.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)?.[1];
    const reportUrl = entry.match(/from ["']([^"']*mach-report\/src\/vue\/index\.ts[^"']*)["']/)?.[1];
    if (!vueUrl || !reportUrl) throw new Error("Missing fixture module URLs");
    const { createApp, h } = await import(vueUrl) as typeof import("vue");
    const { ReportPreview, createProviderEditing, useMachReport, provideMachReportConfig } = await import(reportUrl) as typeof import("../packages/mach-report/src/vue/index");
    const { createReportSource, createTableTemplate, validateReportTemplate } = await import(coreUrl) as typeof import("../packages/mach-report/src/index");
    const root = document.createElement("div"); root.id = "hardening-fixture";
    root.style.cssText = `position:fixed;inset:0;z-index:9999;background:white;display:grid;grid-template-columns:${dense ? "1fr" : "repeat(2,minmax(0,1fr))"}`;
    document.body.append(root);
    createApp({ setup() {
      const reports = Array.from({ length: dense ? 1 : 2 }, () => useMachReport());
      const fixture: HardeningFixture = { reports, saves: [], preferences: [], rows: { A: { qty: 2, revision: 1 }, B: { qty: 3, revision: 1 } } };
      window.__hardening = fixture;
      const common = { height: "100vh", showExport: false, showPrint: false, showPdfWindow: false };
      if (dense) {
        const template = createTableTemplate({ title: "密集搜索验收", layout: "wide", columns: Array.from({ length: 4 }, (_, index) => ({ field: `f${index}`, header: `Col ${index}`, widthMm: 35 })), listOptions: { rowKey: "id", headerEveryPage: false } });
        template.pages[0]!.heightMm = 4500;
        if (!validateReportTemplate(template).ok) throw new Error("Dense search fixture must be a valid template");
        const data = Array.from({ length: 620 }, (_, index) => ({ id: String(index), ...Object.fromEntries(Array.from({ length: 4 }, (_, col) => [`f${col}`, `needle ${index}:${col}`])) }));
        const fetcher = createReportSource({ dense: { template, datasets: { detail: data } } });
        return () => h(ReportPreview, { ...common, reportId: "dense", fetcher, ref: reports[0]!.ref });
      }
      const template = createTableTemplate({ title: "共享配置保存验收", layout: "wide", columns: [{ field: "qty", header: "数量", valueType: "number", widthMm: 30 }, { field: "note", header: "说明", widthMm: 50 }], listOptions: { rowKey: "id", revisionField: "rowRev", sourceTokenField: "rowToken" } });
      const provider: import("../packages/mach-report/src/index").ReportProvider = {
        query({ reportId }) {
          const row = fixture.rows[reportId]!;
          return { revision: `${reportId}-${row.revision}`, sourceToken: `query-${reportId}-${row.revision}`, datasets: { detail: [{ id: "row", qty: row.qty, note: `initial-${reportId}`, rowRev: "row-level", rowToken: "row-token" }] } };
        },
        save(input) {
          const row = fixture.rows[input.reportId]!;
          fixture.saves.push({ reportId: input.reportId, revision: input.expectedRevision, token: input.sourceToken });
          if (input.expectedRevision !== `${input.reportId}-${row.revision}` || input.sourceToken !== `query-${input.reportId}-${row.revision}`) throw new Error("Incorrect view CAS metadata");
          row.qty = input.edits[0]!.value as number; row.revision++;
          return { revision: `${input.reportId}-${row.revision}`, sourceToken: `query-${input.reportId}-${row.revision}` };
        }
      };
      provideMachReportConfig({ defaults: { editable: createProviderEditing(provider, { canEdit: cell => cell.source?.field === "qty" }) } });
      const fetcher = createReportSource({ A: { template, provider }, B: { template, provider } });
      let held = false;
      const adapter: import("../packages/mach-report/src/vue/tools").ReportPreferencesAdapter = {
        load: () => null,
        async save(key, value) {
          fixture.preferences.push({ key, zoom: value.wideZoomMode ?? value.zoomMode });
          if (!held && key === "prefs-A") { held = true; await new Promise<void>(resolve => { fixture.releasePreferences = resolve; }); }
        }
      };
      return () => ["A", "B"].map((id, index) => h("section", { id: `hardening-${id}`, style: "min-width:0;height:100vh" }, [h(ReportPreview, { ...common, reportId: id, fetcher, ref: reports[index]!.ref, preferences: { key: `prefs-${id}`, adapter } })]));
    } }).mount(root);
  }, { coreUrl, dense });
  await expect(page.locator("#hardening-fixture .mr-page").first()).toBeVisible();
}

test("应用级共享编辑配置在A/B/A交替保存及重新查询后保持各自CAS", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await mount(page);
  await expect(page.locator("#hardening-B").getByRole("gridcell", { name: "initial-B", exact: true })).toBeVisible();
  const saved = await page.evaluate(async () => {
    const fixture = window.__hardening;
    for (const [index, qty] of [[0, 5], [1, 6], [0, 7]]) {
      const report = fixture.reports[index!]!;
      await report.focusField({ field: "qty", rowKey: "row" });
      if (!await report.pasteSelection(String(qty))) return false;
    }
    await fixture.reports[0]!.reload();
    await fixture.reports[0]!.focusField({ field: "qty", rowKey: "row" });
    return fixture.reports[0]!.pasteSelection("8");
  });
  expect(saved).toBe(true);
  const result = await page.evaluate(() => ({ saves: window.__hardening.saves, rows: window.__hardening.rows }));
  expect(result.saves.map(value => value.revision)).toEqual(["A-1", "B-1", "A-2", "A-3"]);
  expect(result.saves.map(value => value.token)).toEqual(["query-A-1", "query-B-1", "query-A-2", "query-A-3"]);
  expect(result.rows).toEqual({ A: { qty: 8, revision: 4 }, B: { qty: 6, revision: 2 } });
  expect(errors).toEqual([]);
});

test("慢偏好存储合并连续缩放，搜索仍可用且最终偏好正确", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await mount(page); const root = page.locator("#hardening-A");
  await root.getByRole("button", { name: "150%", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__hardening.preferences.length)).toBe(1);
  await root.getByRole("button", { name: "100%", exact: true }).click();
  await root.getByRole("button", { name: "150%", exact: true }).click();
  await root.getByRole("button", { name: "100%", exact: true }).click();
  await root.getByRole("button", { name: "内容搜索", exact: true }).click();
  await root.getByRole("textbox", { name: "内容搜索", exact: true }).fill("initial-A");
  await expect(root.locator(".mrp-search-count")).toHaveText("1/1");
  expect(await page.evaluate(() => window.__hardening.preferences)).toEqual([{ key: "prefs-A", zoom: 150 }]);
  await page.evaluate(() => window.__hardening.releasePreferences?.());
  await expect.poll(() => page.evaluate(() => window.__hardening.preferences)).toEqual([{ key: "prefs-A", zoom: 150 }, { key: "prefs-A", zoom: 100 }]);
  expect(errors).toEqual([]);
});

test("密集命中超过索引窗口后仍能精确定位中部并清空", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await mount(page, true); const root = page.locator("#hardening-fixture");
  await root.getByRole("button", { name: "内容搜索", exact: true }).click();
  const input = root.getByRole("textbox", { name: "内容搜索", exact: true });
  const baseline = await page.evaluate(() => JSON.stringify(window.__hardening.reports[0]!.getPlan()));
  await input.fill("needle"); await expect(root.locator(".mrp-search-count")).toHaveText("1/2480");
  await input.evaluate(element => { for (let index = 0; index < 1199; index++) element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
  await expect(root.locator(".mrp-search-count")).toHaveText("1200/2480");
  const cell = root.locator("td").filter({ hasText: /^needle 299:3$/u });
  await expect(cell).toBeVisible();
  await expect.poll(async () => {
    const box = await cell.boundingBox(), view = await root.locator(".mrp-body").boundingBox();
    return !!box && !!view && box.y >= view.y - 2 && box.y + box.height <= view.y + view.height + 2;
  }).toBe(true);
  await root.getByRole("button", { name: "清除搜索", exact: true }).click();
  await expect(root.locator("mark.mrp-hit")).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify(window.__hardening.reports[0]!.getPlan()))).toBe(baseline);
  expect(errors).toEqual([]);
});
