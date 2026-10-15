// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { formatExcelNumber, isExcelPercentageFormat } from "../editing/number-format";

describe("shared Excel number display for import and edits", () => {
  it.each([
    [1234.5, '"$"#,##0.00', "$1,234.50"],
    [-1234.5, '"¥"#,##0.00', "-¥1,234.50"],
    [-1234.5, '"$"#,##0.00;[Red]("$"#,##0.00);"—"', "($1,234.50)"],
    [0, '"$"#,##0.00;[Red]("$"#,##0.00);"—"', "—"],
    [12.5, '0.00" kg"', "12.50 kg"],
    [12.5, '"批次 0; "0.00" 单位 2"', "批次 0; 12.50 单位 2"],
    [12.5, '0.00\\;" kg"', "12.50; kg"],
    [0, '0.00;[Red](0.00);"0"', "0"],
    [0.125, "0.00%", "12.50%"],
    [12.5, '0.00"%"', "12.50%"],
    [-0.125, '0.00%;(0.00%)', "(12.50%)"],
    [12, "000000", "000012"],
    [1.23, "0.0###", "1.23"],
    [1234.56789, "#,##0.###############", "1,234.56789"],
    [1234, "0.00E+00", "1.23E+03"],
    [-1234, "0.00E+00", "-1.23E+03"],
    [0.00123, "0.00E+00", "1.23E-03"],
    [1200, "0.00##E-00", "1.20E03"],
    [-1200, '0.0E+00;("$"0.0E+00)', "($1.2E+03)"],
    [0, "0.0;;", ""],
    [1.2, "General", "1.2"]
  ] as const)("formats %s with %s consistently as %s", (value, format, expected) => {
    const warn = vi.fn();
    expect(formatExcelNumber(value, format, warn)).toBe(expected);
    expect(warn).not.toHaveBeenCalled();
  });

  it("distinguishes true percentages from quoted and escaped literal signs", () => {
    expect(isExcelPercentageFormat("0.00%")).toBe(true);
    expect(isExcelPercentageFormat('0.00"%"')).toBe(false);
    expect(isExcelPercentageFormat("0.00\\%")).toBe(false);
  });

  it.each(["[>=100]0.00", "# ?/?", "0.00,,", "mm/dd/yyyy", "0.00_)"])("preserves raw values and warns for unsupported format %s", (format) => {
    const warn = vi.fn();
    expect(formatExcelNumber(-12.3, format, warn)).toBe("-12.3");
    expect(warn).toHaveBeenCalledOnce();
  });
});
