// @vitest-environment node
import { describe, expect, it } from "vitest";
import { paginateTemplate } from "@agile-team/mach-report";
import { labelDocument, labelRows } from "../label-template";

describe("industrial label example", () => {
  it("lays out all real example faces without clipping and keeps each record's values together", () => {
    const result = paginateTemplate(labelDocument.template, { materials: labelRows });
    expect(result.warnings).toEqual([]);
    expect(result.plan.pages).toHaveLength(4);
    const first = result.plan.pages[0]!, second = result.plan.pages[2]!;
    expect(first.components.find(item => item.kind === "qrcode")!.code!.value).toBe(labelRows[0]!.trace);
    expect(second.components.find(item => item.kind === "qrcode")!.code!.value).toBe(labelRows[1]!.trace);
    expect(second.components.some(item => item.text === "0 kg")).toBe(true);
    expect(result.plan.pages.every(page => page.pageWidthMm === 80 && page.pageHeightMm === 55)).toBe(true);
  });
});
