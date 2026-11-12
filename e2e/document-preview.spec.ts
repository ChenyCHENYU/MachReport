import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

interface DocumentFixture { calls: number[]; fail: boolean; handle: { gotoPage(page: number): Promise<void>; cancel(): void } }
declare global { interface Window { __documentFixture: DocumentFixture } }
const require = createRequire(new URL("../packages/mach-report/package.json", import.meta.url));
const { PDFDocument } = require("pdf-lib") as typeof import("../packages/mach-report/node_modules/pdf-lib");
test("remote document navigation stays bounded and exports every pinned page", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://localhost:8610");
  await page.evaluate(async ({ vueEntry, pdfEntry }) => {
    const source = await fetch("/src/main.ts").then(response => response.text());
    const vueUrl = source.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)?.[1]; if (!vueUrl) throw Error("Missing Vue module");
    const { createApp, h } = await import(vueUrl) as typeof import("vue");
    const { ReportDocumentPreview } = await import(vueEntry) as typeof import("../packages/mach-report/src/vue/index");
    const { renderPlanToPdf } = await import(pdfEntry) as typeof import("../packages/mach-report/src/pdf");
    const fixture: DocumentFixture = { calls: [], fail: false, handle: undefined! }; window.__documentFixture = fixture;
    const makePage = (index: number) => ({ pageWidthMm: 80, pageHeightMm: 55, components: [{ kind: "text" as const, leftMm: 5, topMm: 5, widthMm: 60, heightMm: 10, text: `Record ${index + 1}` }] });
    const remote = {
      async load({ fromPage, limit }: { fromPage: number; limit: number }) {
        fixture.calls.push(fromPage); await new Promise(resolve => setTimeout(resolve, 20));
        if (fixture.fail) throw Error("Read unavailable");
        const pages = Array.from({ length: Math.min(limit, 50 - fromPage) }, (_, offset) => makePage(fromPage + offset));
        return { manifest: { scope: "demo", id: "document", version: "v1", revision: 51, state: "complete" as const, pageCount: 50, bytes: 5000, plan: { schemaVersion: "2" } }, pages, nextPage: fromPage + pages.length };
      },
      async export({ format }: { format: "pdf" | "xlsx" }) {
        if (format !== "pdf") throw Error("Fixture exports PDF only");
        const output = await renderPlanToPdf({ schemaVersion: "2", pages: Array.from({ length: 50 }, (_, index) => makePage(index)) }, { fidelity: "strict" });
        return { bytes: output.bytes, contentType: "application/pdf", format, stats: { rows: 50, pages: 50, cells: 0, durationMs: 1 }, revisions: {}, diagnostics: [] };
      }
    };
    const target = document.createElement("div"); target.id = "document-preview-fixture"; target.style.cssText = "position:fixed;inset:20px;z-index:99999;background:white"; document.body.append(target);
    createApp({ render: () => h(ReportDocumentPreview, { ref: (value: unknown) => { fixture.handle = value as DocumentFixture["handle"]; }, source: remote, height: "100%" }) }).mount(target);
  }, { vueEntry: `/@fs${fileURLToPath(new URL("../packages/mach-report/src/vue/index.ts", import.meta.url))}`, pdfEntry: `/@fs${fileURLToPath(new URL("../packages/mach-report/src/pdf.ts", import.meta.url))}` });
  const root = page.locator("#document-preview-fixture");
  await expect(root.locator(".mr-page")).toContainText("Record 1"); await expect(root.locator(".mrp-pageinfo")).toHaveText("1 / 50");
  await root.locator(".mrp-body").press("End"); await expect(root.locator(".mr-page")).toContainText("Record 50"); await expect(root.locator(".mrp-pageinfo")).toHaveText("50 / 50");
  expect(await page.evaluate(() => window.__documentFixture.calls)).toEqual([0, 49]); expect(await root.locator(".mr-page").count()).toBe(1);
  const shell = await root.boundingBox(), pager = await root.locator(".mrp-pagination").boundingBox();
  expect(pager!.x + pager!.width).toBeCloseTo(shell!.x + shell!.width - 1, 0); expect(pager!.y + pager!.height).toBeCloseTo(shell!.y + shell!.height - 1, 0);
  await page.evaluate(async () => { window.__documentFixture.fail = true; await window.__documentFixture.handle.gotoPage(25); });
  await expect(root.getByRole("alert")).toHaveText("Read unavailable"); await expect(root.locator(".mr-page")).toContainText("Record 50");
  await page.evaluate(async () => { window.__documentFixture.fail = false; await window.__documentFixture.handle.gotoPage(1); });
  await expect(root.locator(".mr-page")).toContainText("Record 1");
  await root.getByRole("button", { name: "导出", exact: true }).click(); const downloadPending = page.waitForEvent("download");
  await root.getByRole("menuitem", { name: "导出 PDF", exact: true }).click(); const downloaded = await downloadPending;
  const saved = info.outputPath("complete-document.pdf"); await downloaded.saveAs(saved); const pdf = await PDFDocument.load(readFileSync(saved));
  expect(pdf.getPageCount()).toBe(50); expect(pdf.getPage(49).getWidth()).toBeCloseTo(80 * 72 / 25.4, 4);
  await root.screenshot({ path: info.outputPath("document-preview.png") }); expect(errors).toEqual([]);
});
