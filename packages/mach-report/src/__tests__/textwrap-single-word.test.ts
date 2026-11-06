// @vitest-environment node
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { charWidthEm, heuristicMeasurer, wrapText, type TextMeasureOptions, type TextMeasurer } from "../layout/textwrap";
import { fuzzOptions } from "./fuzz/options";

function measuredWords() {
  const calls: string[] = [];
  const measurer: TextMeasurer = { measureMm(text, options) {
    calls.push(text);
    const characters = Array.from(text).length;
    const kerning = text.includes("AV") ? 0.75 : 0;
    return characters * options.fontSizePt / 5 - kerning + (options.letterSpacingPt ?? 0) * Math.max(0, characters - 1);
  } };
  return { calls, measurer };
}

/** Appending a newline forces the existing general tokenizer without measuring an extra token. */
function compareGeneralPath(text: string, width: number, options: TextMeasureOptions): void {
  const fast = measuredWords(), general = measuredWords();
  const actual = wrapText(text, width, options, fast.measurer);
  const expected = wrapText(`${text}\n`, width, options, general.measurer).slice(0, -1);
  expect(actual).toEqual(expected);
  expect(fast.calls).toEqual(general.calls);
}

describe("single-word text measurement fast path", () => {
  it.each([
    ["A B", ["A", " ", "B"]],
    ["A\nB", ["A", "B"]],
    ["A\r\nB", ["A", "B"]],
    ["A\rB", ["A", "B"]],
    ["钢AＢ", ["钢", "A", "Ｂ"]],
    ["a\tb", ["a\tb"]],
    ["A\u00a0B", ["A\u00a0B"]],
    ["🏭🔧", ["🏭🔧"]],
    ["e\u0301AV", ["e\u0301AV"]]
  ] as const)("preserves the original boundary and measurement tokens for %j", (text, expected) => {
    const { measurer, calls } = measuredWords();
    wrapText(text, 1000, { fontSizePt: 10 }, measurer);
    expect(calls).toEqual(expected);
  });

  it.each([0, 0.1, 1, 3, 9, 100, Infinity, NaN])("keeps oversized Unicode word wrapping and custom kerning at width %s", width => {
    for (const text of ["", "AV", "S304L-2000:81", "🏭AV🔧", "e\u0301AV", "a\tb", "\ud800AV\udfff"]) {
      for (const letterSpacingPt of [-0.5, 0, 2]) compareGeneralPath(text, width, { fontSizePt: 12, fontFamily: "Kerning Face", bold: true, italic: true, letterSpacingPt });
    }
  });

  it("keeps repeated CJK boundary checks independent between calls", () => {
    for (let repeat = 0; repeat < 10; repeat++) {
      const { measurer, calls } = measuredWords();
      expect(wrapText("钢报", 2, { fontSizePt: 10 }, measurer)).toEqual(["钢", "报"]);
      expect(calls).toEqual(["钢", "报"]);
      compareGeneralPath("AV-2000", 9, { fontSizePt: 10 });
    }
  });

  it.each([
    ["\u2fff", false], ["\u3000", true], ["\u9fff", true], ["\ua000", false],
    ["\ufeff", false], ["\uff00", true], ["\uffef", true], ["\ufff0", false]
  ] as const)("preserves the existing CJK interval edge %j", (character, boundary) => {
    const { measurer, calls } = measuredWords(), text = `AV${character}AV`;
    expect(wrapText(text, 1000, { fontSizePt: 10 }, measurer)).toEqual([text]);
    expect(calls).toEqual(boundary ? ["AV", character, "AV"] : [text]);
  });

  it("retains code-point spacing for emoji, combining marks and lone surrogates", () => {
    for (const text of ["", "A", "🏭", "🏭A🔧", "e\u0301", "👩‍🏭", "\ud800A\udfff", "钢报"]) {
      for (const bold of [false, true]) for (const letterSpacingPt of [-1, 0, 2.5]) {
        const points = Array.from(text), units = points.reduce((total, point) => total + charWidthEm(point), 0);
        const expected = ((bold ? units * 1.04 : units) * 12 + letterSpacingPt * Math.max(0, points.length - 1)) * 25.4 / 72;
        expect(heuristicMeasurer.measureMm(text, { fontSizePt: 12, bold, letterSpacingPt })).toBeCloseTo(expected, 12);
      }
    }
  });

  it("matches general tokenization and measurement calls for seeded boundary-free words", () => {
    const word = fc.array(fc.constantFrom("A", "V", "x", "0", "9", ":", "-", "é", "\t", "\u00a0", "\u0301", "🏭", "👩", "‍", "\ud800", "\udfff"), { maxLength: 60 }).map(parts => parts.join(""));
    fc.assert(fc.property(word, fc.integer({ min: 0, max: 400 }), fc.integer({ min: -2, max: 8 }), (text, width, spacing) => {
      compareGeneralPath(text, width / 10, { fontSizePt: 11, letterSpacingPt: spacing / 4 });
    }), fuzzOptions(17));
  });
});
