import { expect, test, type Locator, type Page } from "@playwright/test";

// Real wl-ui-produce baseline: native forms contribute 12px below the jump group.
const actualHostBaseline = `
  body { font-family: Arial, sans-serif; font-size: 13px; line-height: 1.5; }
  form { margin: 0 0 12px; }
  input, button, textarea { color: inherit; font: inherit; }
  img, svg, iframe { display: block; vertical-align: middle; }
`;
const additionalHostFormStyles = `
  form { padding: 6px; box-sizing: content-box; }
  label { margin: 0 11px 8px 0; padding: 4px; font: 700 17px/34px serif; }
  button { margin: 3px 5px; line-height: 36px; box-sizing: content-box; }
  input { margin: 2px 4px; padding: 3px; font-size: 17px; line-height: 31px; box-sizing: content-box; }
  footer { padding: 8px; margin-bottom: 4px; line-height: 30px; }
`;

async function mountPagination(page: Page, calculations: boolean): Promise<Locator> {
  await page.goto("http://localhost:8610");
  await expect(page.getByText("产品出库单")).toBeVisible();
  await page.evaluate(async (calculations) => {
    const source = await fetch("/src/main.ts").then((response) => response.text());
    const vueUrl = source.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)?.[1];
    const reportUrl = source.match(/from ["']([^"']*mach-report\/src\/vue\/index\.ts[^"']*)["']/)?.[1];
    if (!vueUrl || !reportUrl) throw new Error("Missing shared example runtime");
    const { createApp, h } = await import(vueUrl) as typeof import("vue");
    const { ReportPreview } = await import(reportUrl) as typeof import("../packages/mach-report/src/vue/index");
    const plan = { schemaVersion: "pagination-geometry", pages: Array.from({ length: 2 }, (_, index) => ({ pageWidthMm: 210, pageHeightMm: 297, components: [{ kind: "text" as const, leftMm: 10, topMm: 10, widthMm: 190, heightMm: 10, text: `分页对齐验收 ${index + 1}` }] })) };
    const target = document.createElement("div"); target.id = "pagination-fixture"; target.style.cssText = "position:fixed;inset:0;z-index:9999"; document.body.append(target);
    createApp({ render: () => h(ReportPreview, { reportId: "pagination-alignment", fetcher: async () => plan, height: "100vh", interaction: { calculations }, showExport: false, showPrint: false, showPdfWindow: false }) }).mount(target);
  }, calculations);
  const root = page.locator("#pagination-fixture");
  await expect(root.locator(".mrp-pagination")).toBeVisible();
  return root;
}

async function geometry(root: Locator) {
  return root.evaluate((root) => {
    const describe = (selector: string) => [...root.querySelectorAll<HTMLElement>(selector)].map((element) => {
      const box = element.getBoundingClientRect(), style = getComputedStyle(element);
      return { tag: element.tagName, centerY: box.top + box.height / 2, right: box.right, height: box.height, margin: style.margin, padding: style.padding, lineHeight: style.lineHeight, fontSize: style.fontSize, boxSizing: style.boxSizing };
    });
    return { footer: describe(".mrp-footer")[0]!, pagination: describe(".mrp-pagination")[0]!, controls: describe(".mrp-pageinfo,.mrp-page-buttons > button,.mrp-page-jump,.mrp-page-jump label,.mrp-page-jump label > span,.mrp-page-jump input,.mrp-page-jump > button,.mrp-pagination button > svg"), calculation: describe(".mrp-calculation-toggle") };
  });
}

async function expectAligned(root: Locator, calculations: boolean) {
  const current = await geometry(root), centers = current.controls.map((control) => control.centerY);
  expect(Math.max(...centers) - Math.min(...centers), JSON.stringify(current)).toBeLessThanOrEqual(1);
  for (const control of current.controls.filter((control) => ["FORM", "LABEL", "BUTTON", "INPUT"].includes(control.tag))) expect(control.margin).toBe("0px");
  expect(current.pagination.height).toBe(48);
  expect(current.footer.height).toBe(49);
  const lastButtonRight = Math.max(...current.controls.filter((control) => control.tag === "BUTTON").map((control) => control.right));
  expect(current.pagination.right - lastButtonRight).toBe(14);
  expect(current.calculation).toHaveLength(calculations ? 1 : 0);
  if (calculations) expect(Math.abs(current.calculation[0]!.centerY - centers[0]!)).toBeLessThanOrEqual(1);
  return current;
}

for (const width of [1024, 1440]) {
  for (const calculations of [false, true]) {
    test(`${width}px 宿主form样式不偏移分页中心线${calculations ? "（含左侧计算）" : ""}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 800 });
      const root = await mountPagination(page, calculations);
      await page.addStyleTag({ content: actualHostBaseline });
      const actualHost = await expectAligned(root, calculations);
      await page.addStyleTag({ content: additionalHostFormStyles });
      const stressedHost = await expectAligned(root, calculations);
      const jump = root.getByRole("textbox", { name: "跳至页", exact: true });
      await jump.fill("2"); await jump.press("Enter");
      await expect(root.locator(".mrp-pageinfo")).toHaveText("2 / 2");
      await expect(root.getByRole("button", { name: "下一页 ›", exact: true })).toBeDisabled();
      await expectAligned(root, calculations);
      await testInfo.attach("pagination-geometry.json", { body: JSON.stringify({ actualHost, stressedHost }, null, 2), contentType: "application/json" });
      await page.screenshot({ path: testInfo.outputPath("pagination-aligned.png"), fullPage: true });
    });
  }
}
