import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { productionSnapshot, structureWorkbookFixture, EXACT_STRUCTURE_DECIMAL } from "../packages/mach-report/src/__tests__/fixtures/production-report-corpus";
const coreUrl = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/index.ts", import.meta.url))}`;
const xlsxUrl = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/xlsx.ts", import.meta.url))}`;

test("six application report structures retain all columns/metrics and readable cells in the real browser", async ({ page }) => {
  await page.goto("http://localhost:8610");
  for (const report of productionSnapshot.reports) {
    const fixture = await structureWorkbookFixture(report);
    const result = await page.evaluate(async ({ coreUrl, xlsxUrl, bytes }) => {
      const { paginateTemplate, renderPlan } = await import(/* @vite-ignore */ coreUrl) as typeof import("../packages/mach-report/src/index");
      const { importExcelTemplate } = await import(/* @vite-ignore */ xlsxUrl) as typeof import("../packages/mach-report/src/xlsx");
      const imported = await importExcelTemplate(new Uint8Array(bytes), { maxRowsPerPage: 8 });
      const plan = paginateTemplate(imported.template, {}).plan;
      const root = renderPlan(plan, document);
      document.body.replaceChildren(root);
      const cells = [...root.querySelectorAll<HTMLElement>("td")];
      const content = cells.map(cell => cell.querySelector<HTMLElement>(".mr-cell-content")!);
      return { warnings: imported.warnings, cells: cells.length, text: root.textContent,
        positiveGeometry: cells.every(cell => { const box = cell.getBoundingClientRect(); return box.width > 0 && box.height > 0; }),
        centered: cells.every(cell => getComputedStyle(cell).textAlign === "center"),
        overflow: content.filter(element => element.scrollHeight > element.clientHeight + 1).map(element => element.textContent) };
    }, { coreUrl, xlsxUrl, bytes: Array.from(fixture.bytes) });
    expect(result.warnings, report.id).toEqual([]);
    expect(result.cells, report.id).toBe((fixture.rows.length + 1) * fixture.headers.length);
    expect(result.positiveGeometry, report.id).toBe(true);
    expect(result.centered, report.id).toBe(true);
    expect(result.overflow, report.id).toEqual([]);
    expect(result.text, report.id).toContain("0000123");
    expect(result.text, report.id).toContain(EXACT_STRUCTURE_DECIMAL);
  }
});
