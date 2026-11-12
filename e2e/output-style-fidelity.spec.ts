import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { styleFidelityPlan } from "./fixtures/style-fidelity";

const coreUrl = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/index.ts", import.meta.url))}`;
const pdfUrl = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/pdf.ts", import.meta.url))}`;
const require = createRequire(new URL("../packages/mach-report/package.json", import.meta.url));
const { decode } = require("fast-png") as { decode(input: Uint8Array): { width: number; height: number; channels: number; data: Uint8Array | Uint16Array } };

test("DOM applies isolated opacity and centered rotations; PDF retains styles while Canvas reports unsupported geometry", async ({ page }, info) => {
  await page.goto("http://localhost:8610");
  const result = await page.evaluate(async ({ coreUrl, pdfUrl, input }) => {
    const { renderPlan, renderPlanToCanvas } = await import(/* @vite-ignore */ coreUrl) as typeof import("../packages/mach-report/src/index");
    const { renderPlanToPdf } = await import(/* @vite-ignore */ pdfUrl) as typeof import("../packages/mach-report/src/pdf");
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;background:white;z-index:99999";
    host.append(renderPlan(input, document)); document.body.replaceChildren(host);
    const root = host.querySelector<HTMLElement>(".mr-page")!;
    root.id = "style-fixture";
    const rotated = root.querySelectorAll<HTMLElement>(".mr-comp")[2]!;
    const cells = root.querySelectorAll<HTMLElement>("td");
    const rotatedCell = cells[1]!;
    const rect = rotatedCell.getBoundingClientRect();
    const pdf = await renderPlanToPdf(input, { fidelity: "strict" });
    const canvas = renderPlanToCanvas(input, { dpr: 1, dpi: 96 });
    let strict = false;
    try { renderPlanToCanvas(input, { fidelity: "strict" }); } catch { strict = true; }
    return { pdf: Array.from(pdf.bytes), pdfDiagnostics: pdf.diagnostics, canvasDiagnostics: canvas.diagnostics, strict,
      rotated: getComputedStyle(rotated).transform, cell: { transform: getComputedStyle(rotatedCell).transform, opacity: getComputedStyle(rotatedCell).opacity, width: rect.width, height: rect.height } };
  }, { coreUrl, pdfUrl, input: styleFidelityPlan });
  const image = decode(await page.locator("#style-fixture").screenshot({ path: info.outputPath("style-fidelity-dom.png") }));
  const sample = (x: number, y: number) => {
    const index = (Math.round(y * 96 / 25.4) * image.width + Math.round(x * 96 / 25.4)) * image.channels;
    return Array.from(image.data.slice(index, index + 3));
  };
  // Browser/PDF compositors round eight-bit alpha differently by at most two channel levels.
  const color = (x: number, y: number, expected: number[]) => sample(x, y).forEach((channel, index) => expect(Math.abs(channel - expected[index]!)).toBeLessThanOrEqual(2));
  color(12, 12, [255, 127, 127]);
  color(20, 20, [127, 127, 255]);
  color(64, 23, [127, 255, 127]);
  color(75, 12, [255, 255, 255]);
  color(20, 46, [127, 127, 255]);
  color(2, 78, [127, 255, 255]);
  expect(result.cell.width).toBeCloseTo(60 / Math.sqrt(2) * 96 / 25.4, 1);
  expect(result.cell.height).toBeCloseTo(result.cell.width, 1);
  expect(result.cell.opacity).toBe("0.5");
  expect(result.pdfDiagnostics).toEqual([]);
  expect(result.canvasDiagnostics.filter(item => item.code === "unsupported-style")).toHaveLength(4);
  expect(result.strict).toBe(true);
  writeFileSync(info.outputPath("style-fidelity.pdf"), new Uint8Array(result.pdf));
});
