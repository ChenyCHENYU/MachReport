import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

const coreUrl = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/index.ts", import.meta.url))}`;
const xlsxUrl = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/xlsx.ts", import.meta.url))}`;

test("真实Excel导入的无边框、单边颜色和合并边框在DOM与Canvas像素中一致", async ({ page }) => {
  await page.goto("http://localhost:8610");
  const result = await page.evaluate(async ({ coreUrl, xlsxUrl }) => {
    const { paginateTemplate, renderPlan, renderPlanToCanvas } = await import(/* @vite-ignore */ coreUrl) as typeof import("../packages/mach-report/src/index");
    const { renderPlanToXlsx, importExcelTemplate } = await import(/* @vite-ignore */ xlsxUrl) as typeof import("../packages/mach-report/src/xlsx");
    const { workbook } = await renderPlanToXlsx({ schemaVersion: "edges", pages: [] });
    const sheet = workbook.addWorksheet("Edges");
    sheet.getColumn(1).width = 16; sheet.getColumn(2).width = 16;
    sheet.getCell("A1").value = ""; sheet.getCell("B1").value = "";
    sheet.getCell("B1").border = { bottom: { style: "medium", color: { argb: "FFFF0000" } } };
    sheet.mergeCells("A3:B3"); sheet.getCell("A3").value = "";
    sheet.getCell("A3").border = { top: { style: "medium", color: { argb: "FF0000FF" } } };
    const imported = await importExcelTemplate(new Uint8Array(await workbook.xlsx.writeBuffer()));
    const plan = paginateTemplate(imported.template, {}).plan;
    const dom = renderPlan(plan, document);
    const edges = [...dom.querySelectorAll<HTMLElement>(".mr-grid-edge")].map((element) => ({ color: element.style.borderTopColor, width: element.style.width }));
    const canvas = renderPlanToCanvas(plan, { dpr: 1 }).canvases[0]!;
    const context = canvas.getContext("2d")!;
    const header = plan.pages[0]!.components[0]!;
    const column = header.grid!.colWidthsMm![0]!, height = header.heightMm;
    const sample = (x: number, y: number) => Array.from(context.getImageData(Math.round(x * 96 / 25.4), Math.round(y * 96 / 25.4), 1, 1).data);
    return { edges, red: sample(column * 1.5, height), blue: sample(column, height * 2),
      noHeaderLine: sample(column * .5, height), noOuterLine: sample(0, height * .5), noMergeDivider: sample(column, height * 2.5), noBottom: sample(column * .5, height * 3 - .5) };
  }, { coreUrl, xlsxUrl });
  expect(result.edges).toHaveLength(2);
  expect(result.edges.map(({ color }) => color)).toEqual(["rgb(255, 0, 0)", "rgb(0, 0, 255)"]);
  expect(result.red[0]).toBeGreaterThan(220); expect(result.red[1]).toBeLessThan(100); expect(result.red[2]).toBeLessThan(100);
  expect(result.blue[2]).toBeGreaterThan(220); expect(result.blue[0]).toBeLessThan(100); expect(result.blue[1]).toBeLessThan(100);
  for (const pixel of [result.noHeaderLine, result.noOuterLine, result.noMergeDivider, result.noBottom]) expect(pixel).toEqual([255, 255, 255, 255]);
});
