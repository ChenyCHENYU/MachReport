import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

test("同一表格的独立表头/内容对齐在 DOM 与 Canvas 保持一致", async ({ page }) => {
  await page.goto("http://localhost:8610");
  await expect(page.getByText("产品出库单")).toBeVisible({ timeout: 10000 });
  const sourceUrl = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/index.ts", import.meta.url))}`;
  const result = await page.evaluate(async (sourceUrl) => {
    const { createTableTemplate, paginateTemplate, renderPlan, renderPlanToCanvas } = await import(/* @vite-ignore */ sourceUrl);
    const template = createTableTemplate({
      paper: { widthMm: 100, heightMm: 80 },
      columns: [
        { header: "Code", field: "code", headerAlign: "left" },
        { header: "Qty", field: "qty", headerAlign: "center" },
        { header: "State", field: "state", align: "center", headerAlign: "right" }
      ]
    });
    const { plan } = paginateTemplate(template, { detail: [{ code: "001", qty: 123, state: "OK" }] });
    const root = renderPlan(plan, document);
    document.body.append(root);
    const dom = Array.from(root.querySelectorAll("td")).map((cell) => ({ text: cell.textContent, align: cell.style.textAlign }));
    const canvas: Array<{ text: string; x: number; align: string }> = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
      canvas.push({ text, x, align: this.textAlign });
      if (maxWidth === undefined) original.call(this, text, x, y);
      else original.call(this, text, x, y, maxWidth);
    };
    try {
      renderPlanToCanvas(plan, { dpr: 1 });
    } finally {
      CanvasRenderingContext2D.prototype.fillText = original;
      root.remove();
    }
    return { dom, canvas };
  }, sourceUrl);
  expect(result.dom).toEqual([
    { text: "Code", align: "left" },
    { text: "Qty", align: "center" },
    { text: "State", align: "right" },
    { text: "001", align: "left" },
    { text: "123", align: "center" },
    { text: "OK", align: "center" }
  ]);
  expect(result.canvas.map(({ text, align }) => ({ text, align }))).toEqual(result.dom);
  // 数量列表头与数值共用中心锚点，显式右表头与居中内容保持独立。
  expect(result.canvas[4]!.x).toBeCloseTo(result.canvas[1]!.x, 5);
  expect(result.canvas[0]!.x).toBeCloseTo(result.canvas[3]!.x, 5);
  expect(result.canvas[2]!.x).toBeGreaterThan(result.canvas[5]!.x);
});

test("原始网格默认数值居中，文本编号及显式右对齐在 DOM 与 Canvas 保持一致", async ({ page }) => {
  await page.goto("http://localhost:8610");
  await expect(page.getByText("产品出库单")).toBeVisible();
  const sourceUrl = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/index.ts", import.meta.url))}`;
  const result = await page.evaluate(async sourceUrl => {
    const { renderPlan, renderPlanToCanvas } = await import(/* @vite-ignore */ sourceUrl);
    const plan = { schemaVersion: "raw-grid-alignment", pages: [{ pageWidthMm: 140, pageHeightMm: 60, components: [{
      kind: "rect", leftMm: 5, topMm: 5, widthMm: 120, heightMm: 10,
      grid: { colWidthsMm: [20, 20, 20, 20, 20, 20], rowHeightsMm: [10], paddingMm: 1, cells: [[
        { text: "0", value: 0 }, { text: "001", value: "001", numberFormat: "000" },
        { text: "", value: null, valueType: "number", numberFormat: "0.00" },
        { text: "10%", value: 0.1, numberFormat: "0%" }, { text: "No", value: false },
        { text: "9", value: 9, style: { align: "right" } }
      ]] }
    }] }] };
    const root = renderPlan(plan, document); document.body.append(root);
    const dom = Array.from(root.querySelectorAll("td")).map(cell => ({ text: cell.textContent, align: cell.style.textAlign }));
    const canvas: Array<{ text: string; x: number; align: string }> = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
      canvas.push({ text, x, align: this.textAlign });
      if (maxWidth === undefined) original.call(this, text, x, y);
      else original.call(this, text, x, y, maxWidth);
    };
    try { renderPlanToCanvas(plan, { dpr: 1 }); }
    finally { CanvasRenderingContext2D.prototype.fillText = original; root.remove(); }
    return { dom, canvas };
  }, sourceUrl);
  expect(result.dom).toEqual([
    { text: "0", align: "center" }, { text: "001", align: "left" }, { text: "", align: "center" },
    { text: "10%", align: "center" }, { text: "No", align: "center" }, { text: "9", align: "right" }
  ]);
  expect(result.canvas.map(({ text, align }) => ({ text, align }))).toEqual(result.dom);
  expect(result.canvas.find(item => item.text === "0")!.x).toBeCloseTo(15 * 96 / 25.4, 4);
  expect(result.canvas.find(item => item.text === "9")!.x).toBeCloseTo(124 * 96 / 25.4, 4);
});
