import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fileURLToPath } from "node:url";
import type { MachReportHandle } from "../packages/mach-report/src/vue/controller";
import type { ReportEditOperation } from "../packages/mach-report/src/vue/editing";
import type { RenderPlan, ReportEditBatch } from "../packages/mach-report/src/index";

interface ConflictFixture {
  report: MachReportHandle;
  saves: Array<{ batch: ReportEditBatch; query: ReportEditOperation["query"] }>;
  queries: Array<Record<string, string>>;
  revision: number;
  serverQty: number;
  serverNote: string;
  extraConflict: boolean;
  rejectValidation: boolean;
  delayQuery: number;
  queryFailures: number;
  cancelledQueries: number;
  holdSave: boolean;
  releaseSave?: () => void;
  approveDiscard: boolean;
}
declare global { interface Window { __conflictReview: ConflictFixture } }

async function mountFixture(page: Page, validation = false): Promise<void> {
  await page.goto("http://localhost:8610"); await expect(page.getByText("产品出库单")).toBeVisible();
  const coreUrl = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/index.ts", import.meta.url))}`;
  await page.evaluate(async ({ coreUrl, validation }) => {
    const source = await fetch("/src/main.ts").then(response => response.text());
    const vueUrl = source.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)?.[1];
    const reportUrl = source.match(/from ["']([^"']*mach-report\/src\/vue\/index\.ts[^"']*)["']/)?.[1];
    if (!vueUrl || !reportUrl) throw new Error("Missing fixture module URLs");
    const { createApp, h } = await import(vueUrl) as typeof import("vue");
    const { ReportPreview, useMachReport, provideMachReportConfig } = await import(reportUrl) as typeof import("../packages/mach-report/src/vue/index");
    const { createReportSource, createTableTemplate } = await import(coreUrl) as typeof import("../packages/mach-report/src/index");
    const template = createTableTemplate({ title: "并发核对验收", columns: [
      { field: "qty", header: "数量", valueType: "number" }, { field: "note", header: "说明" }, { field: "amount", header: "金额" }
    ], params: [{ field: "plant", type: "text", defaultValue: "A" }], listOptions: { rowKey: "id", revisionField: "rev", sourceTokenField: "token",
      computed: [{ field: "amount", expression: { op: "multiply", args: [{ field: "qty" }, { field: "price" }] } }], grandTotal: { fields: ["amount"] } } });
    const target = document.createElement("div"); target.id = "conflict-fixture"; target.style.cssText = "position:fixed;inset:0;z-index:9999"; document.body.append(target);
    createApp({ setup() {
      if (validation) provideMachReportConfig({ theme: { colorScheme: "dark", toolbarBg: "#142237", toolbarFg: "#eef5ff", toolbarBorder: "#39516c", btnFg: "#c3d4ef", btnBorder: "#39516c", btnHoverBg: "#263a55", btnHoverFg: "#ffffff", btnActiveBg: "#9bbfff", btnActiveFg: "#102340", errorFg: "#ffb4c0", warningFg: "#ffda93" } });
      const report = useMachReport();
      const fixture: ConflictFixture = { report, saves: [], queries: [], revision: 1, serverQty: 2, serverNote: "original", extraConflict: false, rejectValidation: false, delayQuery: 0, queryFailures: 0, cancelledQueries: 0, holdSave: false, approveDiscard: false };
      window.__conflictReview = fixture;
      const fetcher = createReportSource({ production: { template, provider: { async query(context) {
        fixture.queries.push({ ...context.params });
        if (fixture.delayQuery) await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, fixture.delayQuery);
          context.signal?.addEventListener("abort", () => { clearTimeout(timer); fixture.cancelledQueries++; reject(new DOMException("Cancelled", "AbortError")); }, { once: true });
        });
        if (fixture.queryFailures) { fixture.queryFailures--; throw new Error("模拟读取失败"); }
        return { revision: String(fixture.revision), sourceToken: `v${fixture.revision}`, datasets: { detail: [
          { id: "a", qty: fixture.serverQty, note: fixture.serverNote, price: 3, rev: String(fixture.revision), token: `v${fixture.revision}` },
          { id: "b", qty: 4, note: "other", price: 2, rev: String(fixture.revision), token: `v${fixture.revision}` }
        ] } };
      } } } });
      const editing = {
        requireSource: true,
        validateBatch(_batch: Readonly<ReportEditBatch>, candidate: RenderPlan) {
          if (validation) {
            const row = candidate.pages.flatMap(page => page.components).find(component => component.table?.source?.rowKey === "a")!;
            return Array.from({ length: 237 }, (_, index) => ({ ruleId: `rule${index}`, severity: index % 2 ? "warning" as const : "error" as const,
              message: `校验问题 ${index}`, sourceScope: row.table!.source!.sourceScope, dataset: index % 2 ? "unknown" : "detail", rowKey: "a", field: "qty" }));
          }
          if (fixture.rejectValidation) return [{ ruleId: "host", severity: "error" as const, message: "模拟整批校验拒绝" }];
        },
        async saveBatch(batch: Readonly<ReportEditBatch>, operation: ReportEditOperation) {
          fixture.saves.push({ batch: structuredClone(batch), query: structuredClone(operation.query) });
          if (fixture.saves.length === 1 || fixture.extraConflict) {
            fixture.extraConflict = false; fixture.revision++; fixture.serverQty = fixture.revision + 1; fixture.serverNote = `server-${fixture.revision}`;
            return { conflicts: [{ message: "模拟并发更新，请核对最新数据" }] };
          }
          if (fixture.holdSave) await new Promise<void>(resolve => { fixture.releaseSave = resolve; });
          if (batch.edits.some(edit => edit.source?.revision !== String(fixture.revision) || edit.source?.sourceToken !== `v${fixture.revision}`)) throw new Error("Fresh source CAS was not used");
          if (operation.query?.sources[0]?.revision !== String(fixture.revision) || operation.query.params.plant !== "A") throw new Error("Fresh query context was not used");
          for (const edit of batch.edits) {
            if (edit.source?.field === "qty") fixture.serverQty = edit.value as number;
            if (edit.source?.field === "note") fixture.serverNote = edit.value as string;
          }
          fixture.revision++;
          return { revision: String(fixture.revision), sourceToken: `v${fixture.revision}` };
        }
      };
      return () => h(ReportPreview, { ref: report.ref, reportId: "production", fetcher, params: { plant: "A" }, editable: editing,
        height: "100vh", beforeDiscard: () => fixture.approveDiscard, showExport: false, showPrint: false, showPdfWindow: false });
    } }).mount(target);
  }, { coreUrl, validation });
  await expect(page.locator("#conflict-fixture").getByRole("gridcell", { name: "original", exact: true })).toBeVisible();
}

async function rejectBatch(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const { report } = window.__conflictReview, baseline = JSON.stringify(report.getPlan());
    await report.focusField({ field: "qty", rowKey: "a" });
    if (await report.pasteSelection("5\tmine")) throw new Error("The initial conflicting batch must fail");
    return baseline;
  });
}

test("冲突整批保留，按原查询参数核对后使用新CAS统一重算提交", async ({ page }) => {
  await mountFixture(page);
  const root = page.locator("#conflict-fixture"), baseline = await rejectBatch(page);
  expect(await page.evaluate(() => JSON.stringify(window.__conflictReview.report.getPlan()))).toBe(baseline);
  expect(await page.evaluate(() => window.__conflictReview.report.getChanges())).toEqual([]);
  await page.evaluate(() => window.__conflictReview.report.setParams({ plant: "B" }, { reload: false }));
  const trigger = root.getByRole("button", { name: "核对保存冲突 · 2", exact: true }); await trigger.click();
  const dialog = root.getByRole("dialog", { name: "核对保存冲突", exact: true }); await expect(dialog.locator("li")).toHaveCount(2);
  expect(await page.evaluate(() => window.__conflictReview.queries)).toEqual([{ plant: "A" }, { plant: "A" }]);
  const rows = dialog.locator("li");
  await rows.nth(0).getByRole("radio").nth(0).check(); await rows.nth(1).getByRole("radio").nth(1).check();
  await expect(dialog.getByRole("button", { name: "校验并提交选择", exact: true })).toBeEnabled();
  const accessibility = await new AxeBuilder({ page }).include("#conflict-fixture .mrp-review-dialog").analyze(); expect(accessibility.violations).toEqual([]);
  await dialog.getByRole("button", { name: "校验并提交选择", exact: true }).click(); await expect(dialog).toHaveCount(0);
  await expect(root.locator(".mrp-body")).toBeFocused();
  const result = await page.evaluate(() => {
    const fixture = window.__conflictReview, plan = fixture.report.getPlan()!;
    const body = plan.pages.flatMap(page => page.components).find(component => component.table?.source?.rowKey === "a")!;
    const total = plan.pages.flatMap(page => page.components).find(component => component.table?.role === "grand-total")!;
    return { saves: fixture.saves, values: body.grid!.cells[0]!.map(cell => cell!.value), total: total.grid!.cells.flat().at(-1)!.value, params: fixture.report.state.params };
  });
  expect(result.saves).toHaveLength(2); expect(result.saves[1]!.batch.edits).toHaveLength(1);
  expect(result.saves[1]!.batch.edits[0]).toMatchObject({ previousValue: 3, value: 5, source: { field: "qty", revision: "2", sourceToken: "v2" } });
  expect(result.values).toEqual([5, "server-2", 15]); expect(result.total).toBe(23); expect(result.params).toEqual({ plant: "A" });
});

test("整批校验失败和第二次冲突保留选择意图，重新核对可仅提交仍需保留的字段", async ({ page }) => {
  await mountFixture(page); await rejectBatch(page);
  const root = page.locator("#conflict-fixture"); await root.getByRole("button", { name: "核对保存冲突 · 2", exact: true }).click();
  const dialog = root.getByRole("dialog", { name: "核对保存冲突", exact: true }); await expect(dialog.locator("li")).toHaveCount(2);
  for (const row of await dialog.locator("li").all()) await row.getByRole("radio").nth(0).check();
  await page.evaluate(() => { window.__conflictReview.rejectValidation = true; });
  await dialog.getByRole("button", { name: "校验并提交选择", exact: true }).click(); await expect(dialog.getByRole("alert")).toContainText("模拟整批校验拒绝");
  expect(await page.evaluate(() => window.__conflictReview.saves.length)).toBe(1);
  await page.evaluate(() => { const fixture = window.__conflictReview; fixture.rejectValidation = false; fixture.extraConflict = true; });
  await dialog.getByRole("button", { name: "读取最新数据", exact: true }).click(); await expect(dialog.locator("li")).toHaveCount(2);
  for (const row of await dialog.locator("li").all()) await row.getByRole("radio").nth(0).check();
  await dialog.getByRole("button", { name: "校验并提交选择", exact: true }).click(); await expect(dialog.getByRole("alert")).toContainText("模拟并发更新");
  await dialog.getByRole("button", { name: "读取最新数据", exact: true }).click(); await expect(dialog.locator("li")).toHaveCount(2);
  await dialog.locator("li").nth(0).getByRole("radio").nth(1).check(); await dialog.locator("li").nth(1).getByRole("radio").nth(0).check();
  await dialog.getByRole("button", { name: "校验并提交选择", exact: true }).click(); await expect(dialog).toHaveCount(0);
  const saved = await page.evaluate(() => { const fixture = window.__conflictReview; return { saves: fixture.saves, qty: fixture.serverQty, note: fixture.serverNote }; });
  expect(saved.saves).toHaveLength(3); expect(saved.saves[2]!.batch.edits).toHaveLength(1);
  expect(saved.saves[2]!.batch.edits[0]).toMatchObject({ value: "mine", source: { field: "note", revision: "3", sourceToken: "v3" } });
  expect(saved.qty).toBe(4); expect(saved.note).toBe("mine");
});

test("失败编辑器进入核对不触发额外保存，取消查询及异常后可恢复并返回触发按钮焦点", async ({ page }) => {
  await mountFixture(page);
  const root = page.locator("#conflict-fixture");
  await root.getByRole("gridcell", { name: "2", exact: true }).dblclick();
  const editor = root.getByRole("textbox", { name: "编辑单元格", exact: true }); await editor.fill("5"); await editor.press("Enter");
  await expect(editor).toBeFocused(); await expect(root.locator(".mrp-conflicts")).toContainText("模拟并发更新");
  await page.evaluate(() => { window.__conflictReview.delayQuery = 5000; });
  const trigger = root.getByRole("button", { name: "核对保存冲突 · 1", exact: true }); await trigger.click();
  const dialog = root.getByRole("dialog", { name: "核对保存冲突", exact: true }); await expect(dialog.getByRole("button", { name: "正在读取最新数据…", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__conflictReview.saves.length)).toBe(1);
  await dialog.locator(":scope > header button").click(); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.__conflictReview.cancelledQueries)).toBe(1);
  await page.evaluate(() => { const fixture = window.__conflictReview; fixture.delayQuery = 0; fixture.queryFailures = 1; });
  await trigger.click(); await expect(dialog.getByRole("alert")).toContainText("模拟读取失败");
  expect(await page.evaluate(() => window.__conflictReview.saves.length)).toBe(1);
  await dialog.getByRole("button", { name: "读取最新数据", exact: true }).click(); await expect(dialog.locator("li")).toHaveCount(1);
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
});

test("真实校验抽屉在深色主题下可检索筛选全部237项，跨页定位只接受当前业务来源", async ({ page }, testInfo) => {
  await mountFixture(page, true); await rejectBatch(page);
  const root = page.locator("#conflict-fixture"); await root.getByRole("button", { name: "数据工具", exact: true }).click();
  await root.getByRole("menuitem", { name: "数据校验 · 237", exact: true }).click();
  const dialog = root.getByRole("dialog", { name: "数据校验", exact: true }), panel = dialog.locator(".mr-validation");
  await expect(panel.locator("li")).toHaveCount(100); await expect(panel).toContainText("匹配 237 项 · 共 237 项");
  await expect(panel).toHaveCSS("background-color", "rgb(20, 34, 55)");
  await panel.getByLabel("问题级别", { exact: true }).selectOption("warning"); await expect(panel).toContainText("匹配 118 项 · 共 237 项");
  await expect(panel.locator("li button").first()).toBeDisabled();
  await panel.getByRole("button", { name: "清除筛选", exact: true }).click();
  const search = panel.getByRole("searchbox", { name: "搜索校验问题", exact: true }); await expect(search).toBeFocused();
  await search.fill("校验问题 236"); await expect(panel.locator("li")).toHaveCount(1); await search.press("Escape"); await expect(dialog).toBeVisible();
  await panel.getByRole("button", { name: "下一页 ›", exact: true }).click(); await panel.getByRole("button", { name: "下一页 ›", exact: true }).click();
  await expect(panel.locator("li")).toHaveCount(37); await expect(panel).toContainText("201–237 / 237");
  const accessibility = await new AxeBuilder({ page }).include("#conflict-fixture .mrp-review-dialog").analyze(); expect(accessibility.violations).toEqual([]);
  await testInfo.attach("validation-panel-dark.png", { body: await page.screenshot(), contentType: "image/png" });
  await panel.locator("li").last().getByRole("button").click(); await expect(dialog).toHaveCount(0);
  await expect(root.locator(".mrp-cell-focus")).toHaveText("2");
});


test("确认重新查询会结束在途冲突核对，迟到保存不恢复旧对话框或旧数据", async ({ page }) => {
  await mountFixture(page); await rejectBatch(page);
  const root = page.locator("#conflict-fixture");
  await root.getByRole("button", { name: "核对保存冲突 · 2", exact: true }).click();
  const dialog = root.getByRole("dialog", { name: "核对保存冲突", exact: true });
  await expect(dialog.locator("li")).toHaveCount(2);
  for (const row of await dialog.locator("li").all()) await row.getByRole("radio").nth(0).check();
  await page.evaluate(() => { window.__conflictReview.holdSave = true; window.__conflictReview.approveDiscard = true; });
  await dialog.getByRole("button", { name: "校验并提交选择", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__conflictReview.saves.length)).toBe(2);
  await page.evaluate(() => window.__conflictReview.report.reload());
  await expect(dialog).toHaveCount(0);
  const snapshot = await page.evaluate(() => JSON.stringify(window.__conflictReview.report.getPlan()));
  await page.evaluate(() => window.__conflictReview.releaseSave?.());
  await expect.poll(() => page.evaluate(() => window.__conflictReview.report.state.saving)).toBe(false);
  expect(await page.evaluate(() => JSON.stringify(window.__conflictReview.report.getPlan()))).toBe(snapshot);
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.__conflictReview.report.state.pendingLocalChanges)).toBe(false);
});
