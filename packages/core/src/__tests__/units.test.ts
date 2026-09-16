import { describe, expect, it } from "vitest";
import {
  mmToPx,
  pxToMm,
  ptToPx,
  mmToPxFactor,
  PAPER_SIZES,
  round
} from "../units";

describe("units", () => {
  it("96dpi 下 1 inch = 25.4mm = 96px", () => {
    expect(mmToPx(25.4)).toBeCloseTo(96, 5);
    expect(pxToMm(96)).toBeCloseTo(25.4, 5);
    expect(mmToPxFactor()).toBeCloseTo(96 / 25.4, 5);
  });

  it("mmToPx(0) 与负值安全", () => {
    expect(mmToPx(0)).toBe(0);
    expect(mmToPx(NaN)).toBe(0);
  });

  it("pt→px 换算", () => {
    expect(ptToPx(72)).toBeCloseTo(96, 5);
    expect(ptToPx(10.5)).toBeCloseTo(14, 3);
  });

  it("round 保留位数", () => {
    expect(round(96.537, 1)).toBe(96.5);
    expect(round(96.55, 1)).toBe(96.6);
  });

  it("A4 纸张尺寸存在", () => {
    expect(PAPER_SIZES.a4).toEqual({ widthMm: 210, heightMm: 297 });
  });
});
