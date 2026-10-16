// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createCanvasMeasurer, wrapText, measureTextMm } from "../layout/textwrap";

describe("textwrap", () => {
  it("letter spacing is applied between characters, never after the final character", () => {
    const plain = measureTextMm("钢报", { fontSizePt: 12 });
    expect(measureTextMm("钢报", { fontSizePt: 12, letterSpacingPt: 3 }) - plain).toBeCloseTo(3 * 25.4 / 72);
    expect(measureTextMm("钢", { fontSizePt: 12, letterSpacingPt: 3 })).toBeCloseTo(plain / 2);
    expect(wrapText("钢报表", plain + 3 * 25.4 / 72 + 0.01, { fontSizePt: 12, letterSpacingPt: 3 })).toEqual(["钢报", "表"]);
  });

  it("Canvas metrics use the requested font face and reset inherited spacing", () => {
    const context = { font: "", letterSpacing: "20px", measureText: () => ({ width: 96 }) };
    const measure = createCanvasMeasurer(() => context as unknown as CanvasRenderingContext2D);
    expect(measure.measureMm("AB", { fontSizePt: 12, fontFamily: '"Report Face"', italic: true, bold: true, letterSpacingPt: 2 })).toBeCloseTo(25.4 + 2 * 25.4 / 72);
    expect(context.font).toBe('italic bold 16px "Report Face"');
    expect(context.letterSpacing).toBe("0px");
  });

  it("word widths retain font kerning rather than summing individual glyph estimates", () => {
    const measure = { measureMm: (text: string) => text === "AV" ? 5 : text.length * 3 };
    expect(wrapText("AV", 5, { fontSizePt: 12 }, measure)).toEqual(["AV"]);
  });
  it("空文本返回单空行", () => {
    expect(wrapText("", 50, { fontSizePt: 10.5 })).toEqual([""]);
  });

  it("窄文本不折行", () => {
    const lines = wrapText("OK", 100, { fontSizePt: 10.5 });
    expect(lines).toEqual(["OK"]);
  });

  it("长中文按宽度折行且不超宽", () => {
    const fontSizePt = 10.5;
    const maxMm = 40;
    const text = "物料名称字段内容特别长需要被强制折行成多行显示";
    const lines = wrapText(text, maxMm, { fontSizePt });
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(measureTextMm(line, { fontSizePt })).toBeLessThanOrEqual(maxMm + 0.001);
    }
    expect(lines.join("")).toBe(text);
  });

  it("英文按词内字符折行", () => {
    const lines = wrapText("abcdefghij", 5, { fontSizePt: 10.5 });
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe("abcdefghij");
  });

  it("多个英文单词在词间断行（不拦腰截断）", () => {
    const fontSizePt = 10.5;
    const lines = wrapText("steel billet Q355B", 12, { fontSizePt });
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      // 每行只含完整词（允许因行尾空格丢弃导致的拆分）
      expect(["steel", "billet", "Q355B", "steel billet", "billet Q355B"]).toContain(t);
    }
  });

  it("中英混排按词与字断行", () => {
    const fontSizePt = 10.5;
    const lines = wrapText("合金结构钢Q355B轧制工艺", 18, { fontSizePt });
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(measureTextMm(line, { fontSizePt })).toBeLessThanOrEqual(18 + 2);
    }
  });

  it("换行符强制断行", () => {
    const lines = wrapText("a\nb", 100, { fontSizePt: 10.5 });
    expect(lines).toEqual(["a", "b"]);
  });

  it("中文宽度约为字号全宽", () => {
    const w = measureTextMm("中", { fontSizePt: 10.5 });
    expect(w).toBeCloseTo((10.5 * 25.4) / 72, 3);
  });

  it("空格宽度小于全角", () => {
    const space = measureTextMm(" ", { fontSizePt: 10.5 });
    const cjk = measureTextMm("中", { fontSizePt: 10.5 });
    expect(space).toBeLessThan(cjk * 0.5);
  });
});
