import { describe, expect, it } from "vitest";
import { wrapText, measureTextMm } from "../layout/textwrap";

describe("textwrap", () => {
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
