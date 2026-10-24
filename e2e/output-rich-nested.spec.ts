import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
const canvasUrl = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/render/canvas.ts", import.meta.url))}`;

test("Canvas preserves rich font runs, underline and clipped nested images with real pixels", async ({ page }) => {
  await page.goto("http://localhost:8610");
  const result = await page.evaluate(async (url) => {
    const { renderPlanToCanvasAsync, renderPlanToCanvas } = await import(/* @vite-ignore */ url) as typeof import("../packages/mach-report/src/render/canvas");
    const source = document.createElement("canvas"); source.width = 8; source.height = 4;
    const brush = source.getContext("2d")!; brush.fillStyle = "#ff00ff"; brush.fillRect(0, 0, 8, 4);
    const input: import("../packages/mach-report/src/schema/render-plan").RenderPlan = { schemaVersion: "test", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [
      { kind: "rect", leftMm: 10, topMm: 10, widthMm: 50, heightMm: 30, grid: { paddingMm: 2, cells: [[{ children: [
        { kind: "rect", leftMm: 35, topMm: 0, widthMm: 30, heightMm: 8, style: { backgroundColor: "#00ff00", borderTop: false, borderRight: false, borderBottom: false, borderLeft: false } },
        { kind: "image", leftMm: 0, topMm: 15, widthMm: 8, heightMm: 4, imageData: source.toDataURL() }
      ] }]] } },
      { kind: "text", leftMm: 10, topMm: 50, widthMm: 80, heightMm: 30, style: { fontFamily: "Arial", fontSize: 12 }, richParagraphs: [{ segments: [
        { text: "Bold ", style: { bold: true, color: "#ff0000" } }, { text: "Blue", style: { fontSize: 18, italic: true, underline: true, color: "#0000ff" } }
      ] }] }
    ] }] };
    const calls: Array<{ text: string; font: string; color: string; x: number; y: number }> = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, x, y, maxWidth) { calls.push({ text, x, y, font: this.font, color: String(this.fillStyle) }); if (maxWidth === undefined) original.call(this, text, x, y); else original.call(this, text, x, y, maxWidth); };
    let canvas: HTMLCanvasElement;
    try { canvas = (await renderPlanToCanvasAsync(input, { fidelity: "strict", dpr: 1, dpi: 96 })).canvases[0]!; }
    finally { CanvasRenderingContext2D.prototype.fillText = original; }
    const ctx = canvas.getContext("2d")!, px = (mm: number) => Math.round(mm * 96 / 25.4);
    const read = (x: number, y: number) => [...ctx.getImageData(px(x), px(y), 1, 1).data].slice(0, 3);
    const blue = calls.find(call => call.text === "Blue")!;
    const plain = structuredClone(input);
    plain.pages[0]!.components[1]!.richParagraphs![0]!.segments[1]!.style!.underline = false;
    const control = (await renderPlanToCanvasAsync(plain, { fidelity: "strict", dpr: 1, dpi: 96 })).canvases[0]!.getContext("2d")!;
    ctx.font = blue.font;
    // Compare the same glyphs with/without decoration over a baseline strip. Integrating
    // every column captures subpixel strokes without mistaking glyph pixels for a line.
    const left = Math.ceil(blue.x + 1), width = Math.floor(blue.x + ctx.measureText("Blue").width - 1) - left;
    const top = Math.floor(blue.y), height = Math.ceil(blue.y + 3) - top;
    const decorated = ctx.getImageData(left, top, width, height).data;
    const undecorated = control.getImageData(left, top, width, height).data;
    const blueEnergy = (pixels: Uint8ClampedArray, offset: number) => Math.max(0, pixels[offset + 2]! - Math.max(pixels[offset]!, pixels[offset + 1]!));
    const columns = Array.from({ length: width }, (_, x) => {
      let added = 0;
      for (let y = 0; y < height; y++) {
        const offset = (y * width + x) * 4;
        added += blueEnergy(decorated, offset) - blueEnergy(undecorated, offset);
      }
      return added;
    });
    const underline = { width, addedBlueEnergy: columns.reduce((total, value) => total + value, 0), continuousColumns: columns.filter(value => value > 128).length };
    let sync: unknown;
    try { renderPlanToCanvas(input, { fidelity: "strict" }); } catch (error) { sync = (error as { diagnostics: unknown }).diagnostics; }
    return { calls, inside: read(55, 14), outside: read(59, 14), image: read(16, 29), underline, sync };
  }, canvasUrl);
  expect(result.inside).toEqual([0, 255, 0]); expect(result.outside).toEqual([255, 255, 255]); expect(result.image).toEqual([255, 0, 255]);
  expect(result.calls).toEqual(expect.arrayContaining([expect.objectContaining({ text: "Bold ", font: "bold 16px Arial", color: "#ff0000" }), expect.objectContaining({ text: "Blue", font: "italic 24px Arial", color: "#0000ff" })]));
  expect(result.underline.width).toBeGreaterThan(20);
  expect(result.underline.addedBlueEnergy / result.underline.width).toBeGreaterThan(128);
  expect(result.underline.continuousColumns / result.underline.width).toBeGreaterThan(0.9);
  expect(result.sync).toEqual([expect.objectContaining({ code: "async-image-required", componentPath: [0, 0, 1] })]);
});
