// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFPage, PDFRawStream } from "pdf-lib";
import { renderPlanToPdf } from "../render-pdf";
import { inspectOutputCapabilities } from "../../output/capabilities";
import type { PlanComponent, RenderPlan } from "../../schema/render-plan";

const PT = 72 / 25.4;
function plan(components: PlanComponent[]): RenderPlan {
  return { schemaVersion: "pdf-style", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components }] };
}
function content(document: PDFDocument): string {
  const streams = document.getPage(0).node.Contents() as PDFArray;
  const pages = Array.from({ length: streams.size() }, (_, index) => document.context.lookup(streams.get(index))).filter((stream): stream is PDFRawStream => stream instanceof PDFRawStream).map(stream => new TextDecoder().decode(decodePDFRawStream(stream).decode())).join("\n");
  return pages + "\n" + document.context.enumerateIndirectObjects().filter(([, object]) => object instanceof PDFRawStream && object.dict.get(PDFName.of("Subtype")) === PDFName.of("Form")).map(([, object]) => new TextDecoder().decode(decodePDFRawStream(object as PDFRawStream).decode())).join("\n");
}

describe("PDF existing style fidelity", () => {
  it.each([0, 30, 45, 90, -90, 180, 270])("rotates %s degrees clockwise about the component center, preserving actual text and opacity resources", async rotateDeg => {
    const input = plan([{ kind: "text", text: "Rotate", leftMm: 10, topMm: 20, widthMm: 30, heightMm: 10, style: { rotateDeg, opacity: .4, fontSize: 10 } }]);
    const output = await renderPlanToPdf(input, { fidelity: "strict" });
    expect(output.diagnostics).toEqual([]);
    const document = await PDFDocument.load(output.bytes), stream = content(document);
    const states = document.getPage(0).node.Resources()!.lookup(PDFName.of("ExtGState"), PDFDict);
    expect(states.keys().some(key => states.lookup(key, PDFDict).lookup(PDFName.of("ca"), PDFNumber).asNumber() === .4)).toBe(true);
    expect(stream).toContain("<526F74617465> Tj");
    if (!rotateDeg) return;
    const angle = -rotateDeg * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle), cx = 25 * PT, cy = 75 * PT;
    const matrix = [...stream.matchAll(/^([\d.e-]+) ([\d.e-]+) ([\d.e-]+) ([\d.e-]+) ([\d.e-]+) ([\d.e-]+) cm$/gm)][0]!;
    expect(matrix).toBeDefined();
    [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy].forEach((number, index) => expect(Number(matrix[index + 1])).toBeCloseTo(number, 8));
  });

  it("composes nested isolated alpha groups, clips rotated cell content and restores state for following components", async () => {
    const output = await renderPlanToPdf(plan([
      { kind: "rect", leftMm: 10, topMm: 10, widthMm: 50, heightMm: 20, style: { opacity: .5 }, grid: { cells: [[{ text: "Nested", style: { opacity: .5, rotateDeg: 45 }, children: [{ kind: "text", text: "Child", leftMm: 0, topMm: 0, widthMm: 15, heightMm: 5, style: { opacity: .5 } }] }]] } },
      { kind: "text", text: "After", leftMm: 10, topMm: 70, widthMm: 30, heightMm: 10 }
    ]), { fidelity: "strict" });
    const document = await PDFDocument.load(output.bytes), stream = content(document);
    const groups = document.context.enumerateIndirectObjects().filter(([, object]) => object instanceof PDFRawStream && object.dict.has(PDFName.of("Group")));
    expect(groups).toHaveLength(3);
    expect(document.context.enumerateIndirectObjects().filter(([, object]) => object instanceof PDFDict && object.get(PDFName.of("Type")) === PDFName.of("Page"))).toHaveLength(1);
    for (const [, object] of groups) expect((object as PDFRawStream).dict.lookup(PDFName.of("Group"), PDFDict).get(PDFName.of("I"))?.toString()).toBe("true");
    expect(stream).toContain("W\nn");
    expect(stream.match(/^q$/gm)).toHaveLength(stream.match(/^Q$/gm)!.length);
    expect(stream).toContain("<4166746572> Tj");
  });

  it("justifies soft wrapped word spaces but leaves final/explicit-newline/precomputed lines at natural width", async () => {
    const draw = vi.spyOn(PDFPage.prototype, "drawText");
    try {
      const output = await renderPlanToPdf(plan([{ kind: "text", leftMm: 10, topMm: 10, widthMm: 20, heightMm: 70, text: "one two three four five\none two", style: { fontSize: 10, align: "justify" } }]), { fidelity: "strict" });
      expect(output.diagnostics).toEqual([]);
      const calls = draw.mock.calls;
      const firstY = calls[0]![1]!.y;
      const firstLine = calls.filter(([, options]) => options!.y === firstY);
      expect(firstLine.length).toBeGreaterThan(1);
      const [lastText, lastOptions] = firstLine.at(-1)!;
      expect(lastText).toBe(lastText.trimEnd());
      expect(lastOptions!.x! + lastOptions!.font!.widthOfTextAtSize(lastText, lastOptions!.size!)).toBeCloseTo(30 * PT, 7);
      expect(calls.some(([text]) => text === "one two")).toBe(true);
      const document = await PDFDocument.load(output.bytes);
      expect(content(document)).toContain("Tj");
      draw.mockClear();
      await renderPlanToPdf(plan([{ kind: "text", leftMm: 10, topMm: 10, widthMm: 30, heightMm: 20, lines: ["one two", "last"], style: { align: "justify" } }]));
      expect(draw.mock.calls.map(([text]) => text)).toEqual(["one two", "last"]);
    } finally { draw.mockRestore(); }
  });

  it("retains off-page geometry until rotation, so an opacity group cannot crop content that turns back into view", async () => {
    const output = await renderPlanToPdf(plan([{ kind: "rect", leftMm: -10, topMm: 80, widthMm: 20, heightMm: 10, style: { rotateDeg: 90, opacity: .5, backgroundColor: "#00FFFF" } }]), { fidelity: "strict" });
    const document = await PDFDocument.load(output.bytes);
    const group = document.context.enumerateIndirectObjects().find(([, value]) => value instanceof PDFRawStream && value.dict.has(PDFName.of("Group")))![1] as PDFRawStream;
    expect(group.dict.lookup(PDFName.of("BBox"), PDFArray).lookup(0, PDFNumber).asNumber()).toBeLessThanOrEqual(-10 * PT);
  });

  it("preserves blank explicit lines and justifies rich wrapped runs without stretching the final paragraph line", async () => {
    const draw = vi.spyOn(PDFPage.prototype, "drawText");
    try {
      const output = await renderPlanToPdf(plan([{ kind: "text", leftMm: 10, topMm: 10, widthMm: 50, heightMm: 30, text: "first\n\nlast", style: { fontSize: 10, lineHeight: 1.2, align: "justify" } }]));
      expect(output.diagnostics).toEqual([]);
      const first = draw.mock.calls.find(([text]) => text === "first")![1]!;
      const last = draw.mock.calls.find(([text]) => text === "last")![1]!;
      expect(first.y! - last.y!).toBeCloseTo(24);
      draw.mockClear();
      const rich = await renderPlanToPdf(plan([{ kind: "text", leftMm: 10, topMm: 10, widthMm: 20, heightMm: 40, style: { fontSize: 10, align: "justify" }, richParagraphs: [{ segments: [{ text: "one two ", style: { bold: true } }, { text: "three four\nlast" }] }] }]), { fidelity: "strict" });
      expect(rich.diagnostics).toEqual([]);
      expect(draw.mock.calls.some(([text]) => text === "last")).toBe(true);
      const top = draw.mock.calls[0]![1]!.y;
      expect(draw.mock.calls.filter(([, options]) => options!.y === top).length).toBeGreaterThan(1);
    } finally { draw.mockRestore(); }
  });

  it.each([{ opacity: -1 }, { opacity: 2 }, { opacity: Infinity }, { rotateDeg: Infinity }])("retains invalid graphics diagnostics %s", async style => {
    const input = plan([{ kind: "text", text: "Invalid", leftMm: 1, topMm: 1, widthMm: 50, heightMm: 20, style }]);
    expect(inspectOutputCapabilities(input, "pdf")[0]?.code).toBe("unsupported-style");
    await expect(renderPlanToPdf(input, { fidelity: "strict" })).rejects.toMatchObject({ code: "output-fidelity" });
  });

  it("keeps unsupported inline run rotation and Canvas styles explicit", () => {
    const input = plan([{ kind: "text", leftMm: 10, topMm: 10, widthMm: 50, heightMm: 20, style: { opacity: .5, rotateDeg: 30, align: "justify" }, richParagraphs: [{ segments: [{ text: "Run", style: { rotateDeg: 10 } }] }] }]);
    expect(inspectOutputCapabilities(input, "pdf")).toEqual([expect.objectContaining({ code: "unsupported-style", message: expect.stringContaining("rotateDeg") })]);
    expect(inspectOutputCapabilities(input, "canvas").length).toBeGreaterThan(1);
  });
});
