import { expect, test, type Page } from "@playwright/test";
import type { ReportTemplateDocument } from "../packages/mach-report/src/index";
import type { TemplateDraftRecord } from "../packages/mach-report/src/designer/draft-storage";

const designerUrl = "http://localhost:8610/designer.html";
const draftKey = `mach-report:draft:1:${JSON.stringify(["mach-report:designer-demo", "eaf-demo"])}`;

async function openDesigner(page: Page): Promise<void> {
  page.on("dialog", dialog => {
    if (dialog.type() === "beforeunload") void dialog.accept();
    else void dialog.dismiss();
  });
  await page.goto(designerUrl);
  await expect(page.locator(".mr-designer-preview")).toContainText("000418");
  await expect(page.getByLabel("表头", { exact: true })).toBeEnabled();
}

async function openJson(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "高级", exact: true }).click();
  await expect(page.getByLabel("完整模板 JSON", { exact: true })).toBeVisible();
}

async function currentDocument(page: Page): Promise<ReportTemplateDocument> {
  await openJson(page);
  return JSON.parse(await page.getByLabel("完整模板 JSON", { exact: true }).inputValue()) as ReportTemplateDocument;
}

async function flushPagehide(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
  });
}

async function getStoredDraft(page: Page): Promise<TemplateDraftRecord | null> {
  return page.evaluate(key => {
    const raw = sessionStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw) as TemplateDraftRecord;
  }, draftKey);
}

async function injectDraft(page: Page, record: TemplateDraftRecord | string): Promise<void> {
  await page.addInitScript(({ key, value }) => sessionStorage.setItem(key, value), {
    key: draftKey,
    value: typeof record === "string" ? record : JSON.stringify(record),
  });
  await page.reload();
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => ({
    viewport: innerWidth,
    body: document.body.scrollWidth,
    root: document.documentElement.scrollWidth,
  }));
  expect(geometry.body).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.root).toBeLessThanOrEqual(geometry.viewport);
}

test("refresh retains invalid unapplied JSON and requires an explicit recovery choice", async ({ page }, testInfo) => {
  const failures: string[] = [];
  page.on("pageerror", error => failures.push(error.message));
  await openDesigner(page);
  await openJson(page);
  const input = page.getByLabel("完整模板 JSON", { exact: true });
  const pendingJson = '{ "未完成的业务配置": ';
  await input.fill(pendingJson);
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
  await flushPagehide(page);
  await expect.poll(async () => (await getStoredDraft(page))?.json).toBe(pendingJson);
  expect(JSON.stringify(await getStoredDraft(page))).not.toContain('"datasets"');

  await page.reload();
  const banner = page.locator(".mr-recovery-banner").filter({ hasText: "发现未保存草稿" });
  await expect(banner).toBeVisible();
  await expect(page.getByLabel("表头", { exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("draft-recovery-choice.png"), fullPage: true });
  await banner.getByRole("button", { name: "恢复草稿", exact: true }).click();
  await expect(banner).toHaveCount(0);
  await openJson(page);
  await expect(input).toHaveValue(pendingJson);
  await expect(page.locator("div.mr-designer-pending")).toContainText("完整模板 JSON");
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
  await noHorizontalOverflow(page);
  expect(failures).toEqual([]);
});

test("lazy parameter configuration survives refresh and applies through the existing transaction", async ({ page }, testInfo) => {
  await openDesigner(page);
  await page.getByRole("tab", { name: "工具", exact: true }).click();
  await page.getByRole("button", { name: "查询参数", exact: true }).click();
  await page.locator(".mr-param-editor__add").click();
  await page.getByLabel("参数标识", { exact: true }).fill("restored_shift");
  await page.getByLabel("显示名称", { exact: true }).fill("恢复班别");
  await flushPagehide(page);
  await expect.poll(async () => (await getStoredDraft(page))?.tools.params?.value ?? "").toContain("restored_shift");
  await page.reload();
  await page.locator(".mr-recovery-banner").getByRole("button", { name: "恢复草稿", exact: true }).click();
  await expect(page.locator("div.mr-designer-pending")).toContainText("查询参数");
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
  await page.locator("div.mr-designer-pending button").filter({ hasText: "查询参数" }).click();
  await expect(page.getByLabel("参数标识", { exact: true })).toHaveValue("restored_shift");
  await expect(page.getByLabel("显示名称", { exact: true })).toHaveValue("恢复班别");
  await expect(page.locator(".mr-binding")).not.toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("draft-recovered-parameter.png"), fullPage: true });
  await page.getByRole("button", { name: "校验并应用参数", exact: true }).click();
  await expect(page.locator("div.mr-designer-pending")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeEnabled();
  const document = await currentDocument(page);
  expect(document.template.params).toContainEqual(expect.objectContaining({ field: "restored_shift", label: "恢复班别" }));
});

test("a corrupted stored draft can be discarded through the UI without clearing unrelated session state", async ({ page }) => {
  await openDesigner(page);
  await page.evaluate(() => sessionStorage.setItem("mach-report:unrelated-test", "keep"));
  await injectDraft(page, "{broken record");
  const error = page.locator(".mr-recovery-banner.is-error");
  await expect(error).toContainText("草稿暂存失败");
  await expect(page.locator(".mr-designer-preview")).toContainText("000418");
  await error.getByRole("button", { name: "放弃草稿", exact: true }).click();
  await expect(error).toHaveCount(0);
  await expect.poll(() => getStoredDraft(page)).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem("mach-report:unrelated-test"))).toBe("keep");
  await expect(page.getByLabel("表头", { exact: true })).toBeEnabled();
});

for (const width of [1440, 1024]) {
  test(`old-baseline recovery offers independent copy and explicit rebase at ${width}px`, async ({ page }, testInfo) => {
    const failures: string[] = [];
    page.on("pageerror", error => failures.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await openDesigner(page);
    const current = await currentDocument(page);
    const baseline: ReportTemplateDocument = { ...current, name: "旧基线模板", revision: "old-1" };
    const local: ReportTemplateDocument = { ...baseline, name: "待恢复的本地模板" };
    const localJson = JSON.stringify(local, null, 2);
    await injectDraft(page, {
      version: 1, templateId: local.id, savedAt: "2026-10-23T03:00:00.000Z",
      baseline, document: local, json: localJson, appliedJson: localJson, tools: {},
    });
    const banner = page.locator(".mr-recovery-banner").filter({ hasText: "发现未保存草稿" });
    await expect(banner).toContainText("草稿基线已变化");
    await banner.getByRole("button", { name: "恢复草稿", exact: true }).click();
    const conflict = page.locator(".mr-recovery-conflict");
    await expect(conflict).toBeVisible();
    await expect(conflict.locator(".mr-recovery-columns > section")).toHaveCount(2);
    await expect(conflict.locator(".mr-recovery-columns > section").first()).toContainText("待恢复的本地模板");
    await expect(conflict.locator(".mr-recovery-columns > section").last()).toContainText(current.name);
    await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
    await noHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`draft-conflict-${width}.png`), fullPage: true });

    await conflict.getByRole("button", { name: "保留独立副本", exact: true }).click();
    await expect(conflict).toContainText("副本已保留");
    await expect(page.locator(".workbench-status")).toContainText("已保留独立副本");
    await expect(conflict).toBeVisible();
    await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
    await conflict.getByRole("button", { name: "保留本地内容，以最新版本为基线", exact: true }).click();
    await expect(conflict.locator(".mr-recovery-confirm")).toContainText("不合并远端改动");
    await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath(`draft-rebase-confirm-${width}.png`), fullPage: true });
    await conflict.getByRole("button", { name: "确认更新基线", exact: true }).click();
    await expect(conflict).toHaveCount(0);
    await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeEnabled();
    const restored = await currentDocument(page);
    expect(restored.name).toBe(local.name);
    expect(restored.revision).toBe(current.revision);
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(page.locator(".workbench-status")).toContainText("草稿已保存 · 修订 1");
    await noHorizontalOverflow(page);
    expect(failures).toEqual([]);
  });
}
