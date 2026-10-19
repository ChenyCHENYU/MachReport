import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

test("中文列目录区分同名字段，定位第二空表明细的最右列表头", async ({ page }) => {
  await page.goto("http://localhost:8610");
  await expect(page.getByText("产品出库单")).toBeVisible();
  const sourceUrl = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/index.ts", import.meta.url))}`;
  await page.evaluate(async (sourceUrl) => {
    const source = await fetch("/src/main.ts").then((response) => response.text());
    const vueUrl = source.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)?.[1];
    const reportUrl = source.match(/from ["']([^"']*mach-report\/src\/vue\/index\.ts[^"']*)["']/)?.[1];
    if (!vueUrl || !reportUrl) throw new Error("Missing fixture module URLs");
    const { createApp, h } = await import(vueUrl) as typeof import("vue");
    const { ReportPreview } = await import(reportUrl) as typeof import("../packages/mach-report/src/vue/index");
    const { createTableTemplate, paginateTemplate } = await import(sourceUrl) as typeof import("../packages/mach-report/src/index");
    const columns = Array.from({ length: 82 }, (_, index) => ({ header: index === 81 ? "总产重" : `指标${index + 1}`, field: `c${index}`, widthMm: 30 }));
    const plans = ["第一明细", "第二明细"].map((title, index) => {
      const plan = paginateTemplate(createTableTemplate({ title, layout: "wide", columns }), { detail: [] }).plan;
      for (const page of plan.pages) for (const component of page.components) if (component.table) {
        component.table.id += `:area${index}`; component.table.source = { datasetId: `area${index}` };
      }
      return plan;
    });
    const plan = { ...plans[0]!, pages: plans.flatMap((plan) => plan.pages) };
    const target = document.createElement("div"); target.id = "directory-fixture"; target.style.cssText = "position:fixed;inset:0;z-index:9999"; document.body.append(target);
    createApp({ render: () => h(ReportPreview, { reportId: "directory", fetcher: async () => plan, height: "100vh", showExport: false, showPrint: false, showPdfWindow: false }) }).mount(target);
  }, sourceUrl);
  const root = page.locator("#directory-fixture");
  await root.locator(".mrp-directory-trigger").click();
  await root.getByRole("combobox", { name: "搜索列名或字段", exact: true }).fill("总产重");
  const matches = root.locator(".mrp-column-directory section button");
  await expect(matches).toHaveCount(2);
  await matches.last().click();
  await expect(root.locator('[data-page="2"] .mrp-cell-focus')).toHaveText("总产重");
  await expect.poll(() => root.locator(".mrp-body").evaluate((element) => element.scrollLeft)).toBeGreaterThan(6000);
  await expect(root.locator(".mrp-column-directory")).toHaveCount(0);
});
