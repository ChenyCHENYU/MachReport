import { expect, test } from "@playwright/test";

test("查询前同源校验、浅色字段反馈和中文输入法确认，使用侧无需自建表单", async ({ page }) => {
  await page.goto("http://localhost:8610");
  await expect(page.getByText("产品出库单")).toBeVisible();
  await page.evaluate(async () => {
    const source = await fetch("/src/main.ts").then((response) => response.text());
    const vueUrl = source.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)?.[1];
    const reportUrl = source.match(/from ["']([^"']*mach-report\/src\/vue\/index\.ts[^"']*)["']/)?.[1];
    if (!vueUrl || !reportUrl) throw new Error("Missing demo module URLs");
    const { createApp, h } = await import(vueUrl) as typeof import("vue");
    const { ReportPreview, provideMachReportConfig } = await import(reportUrl) as typeof import("../packages/mach-report/src/vue/index");
    const target = document.createElement("div"); target.id = "params-workflow"; target.style.cssText = "position:fixed;inset:0;z-index:9999"; document.body.append(target);
    const requests: Array<Record<string, string>> = [];
    (window as Window & { mrParamRequests?: typeof requests }).mrParamRequests = requests;
    createApp({ setup() {
      provideMachReportConfig({ theme: { toolbarBg: "#ffffff", toolbarFg: "#334155" } });
      return () => h(ReportPreview, { reportId: "params-demo", showExport: false, showPdfWindow: false, height: "100vh", paramDefs: [
        { field: "plant", label: "厂别", type: "select", required: true, options: [{ label: "厂A", value: "A" }] },
        { field: "qty", label: "数量", type: "number", min: 1, max: 20, defaultValue: "2" },
        { field: "shift", label: "班别", type: "select", options: [{ label: "甲班", value: "A" }] },
        { field: "note", label: "备注", maxLength: 2 }
      ], fetcher: async ({ params }: { params: Record<string, string> }) => {
        requests.push({ ...params });
        return { schemaVersion: "fixture", pages: [{ pageWidthMm: 210, pageHeightMm: 100, components: [{ kind: "text", text: "查询结果已生成", leftMm: 10, topMm: 10, widthMm: 80, heightMm: 10 }] }] };
      } });
    } }).mount(target);
  });
  const root = page.locator("#params-workflow");
  await expect(root.getByText("请先完善查询条件", { exact: true })).toBeVisible();
  const plant = root.getByLabel("厂别", { exact: false });
  const qty = root.getByLabel("数量", { exact: true });
  const note = root.getByLabel("备注", { exact: true });
  await expect(qty).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await root.getByRole("button", { name: "查 询", exact: true }).click();
  await expect(plant).toBeFocused();
  await expect(plant).toHaveAttribute("aria-invalid", "true");
  await plant.selectOption("A");
  await qty.fill("0");
  await root.getByRole("button", { name: "查 询", exact: true }).click();
  await expect(qty).toBeFocused();
  await expect(root.locator(".mrp-param-error").filter({ hasText: "数量：不能小于 1" })).toBeVisible();
  await qty.fill("1.5");
  await note.fill("钢");
  await note.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  expect(await page.evaluate(() => (window as Window & { mrParamRequests?: unknown[] }).mrParamRequests!.length)).toBe(0);
  await note.press("Enter");
  await expect(root.getByText("查询结果已生成", { exact: true })).toBeVisible();
  const shift = root.getByLabel("班别", { exact: true });
  await shift.selectOption("A"); await shift.selectOption("");
  await root.getByRole("button", { name: "查 询", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as Window & { mrParamRequests?: Array<Record<string, string>> }).mrParamRequests)).toEqual([
    { plant: "A", qty: "1.5", note: "钢" }, { plant: "A", qty: "1.5", note: "钢" }
  ]);
});
