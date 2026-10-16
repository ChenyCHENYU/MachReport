import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

const canvasUrl = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/render/canvas.ts", import.meta.url))}`;

test("directed Canvas lines draw diagonals and zero-height/width axes at their actual coordinates", async ({ page }) => {
  await page.goto("http://localhost:8610");
  const probes = await page.evaluate(async (canvasUrl) => {
    const { renderPlanToCanvas } = await import(/* @vite-ignore */ canvasUrl) as typeof import("../packages/mach-report/src/render/canvas");
    const result = renderPlanToCanvas({ schemaVersion: "lines", pages: [{ pageWidthMm: 80, pageHeightMm: 80, components: [
      { kind: "line", lineDirection: "down", leftMm: 10, topMm: 10, widthMm: 20, heightMm: 20, style: { lineColor: "#ff0000", lineWidthPt: 2 } },
      { kind: "line", lineDirection: "up", leftMm: 35, topMm: 10, widthMm: 20, heightMm: 20, style: { lineColor: "#0000ff", lineWidthPt: 2 } },
      { kind: "line", lineDirection: "down", leftMm: 10, topMm: 40, widthMm: 20, heightMm: 0, style: { lineColor: "#00aa00", lineWidthPt: 2 } },
      { kind: "line", lineDirection: "down", leftMm: 60, topMm: 40, widthMm: 0, heightMm: 20, style: { lineColor: "#00aa00", lineWidthPt: 2 } }
    ] }] }, { dpr: 1 });
    const context = result.canvases[0]!.getContext("2d")!;
    const sample = (x: number, y: number) => Array.from(context.getImageData(Math.round(x * 96 / 25.4), Math.round(y * 96 / 25.4), 1, 1).data);
    return { down: sample(15, 15), up: sample(40, 25), missingDown: sample(15, 25), missingUp: sample(40, 15), horizontal: sample(20, 40), vertical: sample(60, 50) };
  }, canvasUrl);
  expect(probes.down[0]).toBeGreaterThan(200);
  expect(probes.down[1]).toBeLessThan(40);
  expect(probes.up[2]).toBeGreaterThan(200);
  expect(probes.up[0]).toBeLessThan(40);
  expect(probes.missingDown).toEqual([255, 255, 255, 255]);
  expect(probes.missingUp).toEqual([255, 255, 255, 255]);
  expect(probes.horizontal[1]).toBeGreaterThan(140);
  expect(probes.horizontal[0]).toBeLessThan(40);
  expect(probes.vertical[1]).toBeGreaterThan(140);
  expect(probes.vertical[0]).toBeLessThan(40);
});

test("async Canvas and PNG include decoded image adapters in component paint order", async ({ page }) => {
  await page.goto("http://localhost:8610");
  const result = await page.evaluate(async (canvasUrl) => {
    const { renderPlanToCanvasAsync, renderPlanToImages } = await import(/* @vite-ignore */ canvasUrl) as typeof import("../packages/mach-report/src/render/canvas");
    const imageData = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#0000ff"/></svg>')}`;
    const plan = { schemaVersion: "output", pages: [{ pageWidthMm: 60, pageHeightMm: 60, components: [
      { kind: "qrcode" as const, leftMm: 10, topMm: 10, widthMm: 20, heightMm: 20, imageData },
      { kind: "rect" as const, leftMm: 25, topMm: 10, widthMm: 5, heightMm: 20, style: { backgroundColor: "#ff0000", borderTop: false, borderRight: false, borderLeft: false, borderBottom: false } }
    ] }] };
    const raster = await renderPlanToCanvasAsync(plan, { dpr: 1 });
    const png = await renderPlanToImages(plan, { dpr: 1 });
    const bitmap = await createImageBitmap(png.blobs[0]!);
    const encoded = document.createElement("canvas");
    encoded.width = bitmap.width;
    encoded.height = bitmap.height;
    encoded.getContext("2d")!.drawImage(bitmap, 0, 0);
    bitmap.close();
    const sample = (canvas: HTMLCanvasElement) => {
      const context = canvas.getContext("2d")!;
      const read = (x: number, y: number) => Array.from(context.getImageData(Math.round(x * 96 / 25.4), Math.round(y * 96 / 25.4), 1, 1).data);
      return { blue: read(20, 20), overlaidRed: read(27, 20), white: read(5, 5) };
    };
    return { canvas: sample(raster.canvases[0]!), png: sample(encoded), diagnostics: [...raster.diagnostics, ...png.diagnostics] };
  }, canvasUrl);
  expect(result.canvas).toEqual({ blue: [0, 0, 255, 255], overlaidRed: [255, 0, 0, 255], white: [255, 255, 255, 255] });
  expect(result.png).toEqual(result.canvas);
  expect(result.diagnostics).toEqual([]);
});

test("raster export rejects broken images and cancels an adapter that ignores AbortSignal", async ({ page }) => {
  await page.goto("http://localhost:8610");
  const result = await page.evaluate(async (canvasUrl) => {
    const { renderPlanToCanvasAsync } = await import(/* @vite-ignore */ canvasUrl) as typeof import("../packages/mach-report/src/render/canvas");
    const plan = { schemaVersion: "output", pages: [{ pageWidthMm: 60, pageHeightMm: 60, components: [{ kind: "image" as const, leftMm: 1, topMm: 1, widthMm: 10, heightMm: 10, imageData: "data:image/png;base64,YmFk" }] }] };
    const warnings: string[] = [];
    let failed = false;
    try { await renderPlanToCanvasAsync(plan, { onDiagnostic: (entry) => warnings.push(entry.code) }); } catch { failed = true; }
    const controller = new AbortController();
    const pending = renderPlanToCanvasAsync(plan, { signal: controller.signal, imageLoader: () => new Promise(() => {}) });
    controller.abort();
    let aborted = false;
    try { await pending; } catch (error) { aborted = error instanceof DOMException && error.name === "AbortError"; }
    return { failed, warnings, aborted };
  }, canvasUrl);
  expect(result).toEqual({ failed: true, warnings: ["image-decode-failed"], aborted: true });
});

test("Canvas font, italic, spacing and right anchor agree with the actual measured width", async ({ page }) => {
  await page.goto("http://localhost:8610");
  const measureUrl = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/layout/textwrap.ts", import.meta.url))}`;
  const result = await page.evaluate(async ({ canvasUrl, measureUrl }) => {
    const { renderPlanToCanvas } = await import(/* @vite-ignore */ canvasUrl) as typeof import("../packages/mach-report/src/render/canvas");
    const { createCanvasMeasurer } = await import(/* @vite-ignore */ measureUrl) as typeof import("../packages/mach-report/src/layout/textwrap");
    const context = document.createElement("canvas").getContext("2d")!;
    const measurer = createCanvasMeasurer(() => context);
    const widthMm = measurer.measureMm("AV12", { fontSizePt: 12, fontFamily: "monospace", italic: true, letterSpacingPt: 2 });
    const draws: { text: string; x: number; font: string }[] = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y) { draws.push({ text, x, font: this.font }); original.call(this, text, x, y); };
    try {
      renderPlanToCanvas({ schemaVersion: "output", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [{ kind: "text", leftMm: 10, topMm: 10, widthMm: 50, heightMm: 15, text: "AV12", style: { fontFamily: "monospace", fontSize: 12, italic: true, letterSpacing: 2, align: "right" } }] }] }, { dpr: 1, measurer });
    } finally { CanvasRenderingContext2D.prototype.fillText = original; }
    return { widthMm, draws };
  }, { canvasUrl, measureUrl });
  expect(result.draws.map(({ text }) => text)).toEqual(["A", "V", "1", "2"]);
  expect(result.draws.every(({ font }) => font === "italic 16px monospace")).toBe(true);
  expect(result.draws[0]!.x).toBeCloseTo((60 - result.widthMm) * 96 / 25.4, 4);
});
