import { describe, expect, it, vi } from "vitest";
import { PDFPage } from "pdf-lib";
import { renderPage } from "../render/dom";
import { renderPlanToCanvas } from "../render/canvas";
import { renderPlanToPdf } from "../pdf/render-pdf";
import type { RenderPlan } from "../schema/render-plan";
const fixture = (): RenderPlan => ({ schemaVersion: "visual", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [{
  kind: "rect", leftMm: 10, topMm: 10, widthMm: 42, heightMm: 10,
  style: { borderTop: false, borderBottom: false, borderLeft: false, borderRight: false },
  grid: { paddingMm: 1, colWidthsMm: [42], rowHeightsMm: [10], cells: [[{ text: "20", value: 20, dataBar: { start: .25, end: .75, color: "#bad8fa" } }]] },
}] }] });
describe("shared static data bar output geometry", () => {
  it("keeps accessible cell text and appends an inert visual above content", () => {
    const element = renderPage(fixture().pages[0]!, 96, {}, document);
    const cell = element.querySelector('[role="cell"]')!, bar = cell.querySelector<HTMLElement>(".mr-cell-data-bar")!;
    expect(cell.textContent).toBe("20"); expect(bar.getAttribute("aria-hidden")).toBe("true"); expect(bar.style.pointerEvents).toBe("none"); expect(bar.style.opacity).toBe("0.35");
    expect(parseFloat(bar.style.left)).toBeCloseTo(11 * 96 / 25.4, 1); expect(parseFloat(bar.style.width)).toBeCloseTo(20 * 96 / 25.4, 1); expect(cell.lastChild).toBe(bar);
  });
  it("renders Canvas geometry after text with the same transparency", () => {
    const order: string[] = [], fills: number[][] = [];
    const context = { globalAlpha: 1, font: "", fillStyle: "", textAlign: "", textBaseline: "", scale: vi.fn(), save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), fillRect(...args: number[]) { order.push("bar"); fills.push(args); }, fillText() { order.push("text"); } };
    const spy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
    try {
      renderPlanToCanvas(fixture(), { dpr: 1 }); expect(order.slice(-2)).toEqual(["text", "bar"]); expect(fills.at(-1)![0]).toBeCloseTo(21 * 96 / 25.4); expect(fills.at(-1)![2]).toBeCloseTo(20 * 96 / 25.4); expect(context.globalAlpha).toBe(.35);
    } finally { spy.mockRestore(); }
  });
  it("renders PDF geometry after text without declaring visual loss", async () => {
    const rectangle = vi.spyOn(PDFPage.prototype, "drawRectangle"), text = vi.spyOn(PDFPage.prototype, "drawText");
    try {
      const output = await renderPlanToPdf(fixture(), { fidelity: "strict" });
      const index = rectangle.mock.calls.findIndex(([options]) => options?.opacity === .35), call = rectangle.mock.calls[index]![0]!;
      expect(call.x).toBeCloseTo(21 * 72 / 25.4); expect(call.width).toBeCloseTo(20 * 72 / 25.4);
      expect(rectangle.mock.invocationCallOrder[index]).toBeGreaterThan(text.mock.invocationCallOrder[0]!); expect(output.diagnostics).toEqual([]); expect(output.bytes.length).toBeGreaterThan(100);
    } finally { rectangle.mockRestore(); text.mockRestore(); }
  });
});
