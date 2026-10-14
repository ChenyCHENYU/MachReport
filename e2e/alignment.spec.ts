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
    { text: "123", align: "right" },
    { text: "OK", align: "center" }
  ]);
  expect(result.canvas.map(({ text, align }) => ({ text, align }))).toEqual(result.dom);
  // 数量列：表头在列中心，数值在右边缘；编码列两行均在同一左边缘。
  expect(result.canvas[4]!.x).toBeGreaterThan(result.canvas[1]!.x);
  expect(result.canvas[0]!.x).toBeCloseTo(result.canvas[3]!.x, 5);
  expect(result.canvas[2]!.x).toBeGreaterThan(result.canvas[5]!.x);
});
