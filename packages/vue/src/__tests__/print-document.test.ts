// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { buildPrintDocument } from "../composables/usePrintExport";
import { resolvePaper } from "@agile-team/mach-report";
import type { RenderPlan } from "@agile-team/mach-report";

describe("buildPrintDocument（named pages 多纸张打印）", () => {
  it("混合纸张生成分组 @page 规则且页元素带 page 属性", () => {
    const plan: RenderPlan = {
      schemaVersion: "t",
      pages: [
        { pageWidthMm: 210, pageHeightMm: 297, components: [] },
        { pageWidthMm: 210, pageHeightMm: 297, components: [] },
        { pageWidthMm: 297, pageHeightMm: 210, components: [] }
      ]
    };
    const { head, pageChunks } = buildPrintDocument(plan);
    expect(head).toContain("@page p210x297{size:210mm 297mm;margin:0;}");
    expect(head).toContain("@page p297x210{size:297mm 210mm;margin:0;}");
    expect(pageChunks).toHaveLength(3);
    expect(pageChunks[0]).toMatch(/page:\s*p210x297/);
    expect(pageChunks[2]).toMatch(/page:\s*p297x210/);
  });

  it("同尺寸页共享同一规则", () => {
    const plan: RenderPlan = {
      schemaVersion: "t",
      pages: [
        { pageWidthMm: 210, pageHeightMm: 297, components: [] },
        { pageWidthMm: 210, pageHeightMm: 297, components: [] }
      ]
    };
    const { head } = buildPrintDocument(plan);
    expect((head.match(/@page /g) ?? []).length).toBe(1);
  });
});

describe("resolvePaper（builder 纸张预设）", () => {
  it("预设名 + landscape 宽高互换", () => {
    expect(resolvePaper("a4")).toEqual({ widthMm: 210, heightMm: 297 });
    expect(resolvePaper("a4", undefined, true)).toEqual({ widthMm: 297, heightMm: 210 });
    expect(resolvePaper("a5", undefined, true)).toEqual({ widthMm: 210, heightMm: 148 });
  });

  it("数字与对象写法兼容", () => {
    expect(resolvePaper(100, 50)).toEqual({ widthMm: 100, heightMm: 50 });
    expect(resolvePaper({ widthMm: 100, heightMm: 50 })).toEqual({ widthMm: 100, heightMm: 50 });
  });

  it("未知预设名报可用清单", () => {
    expect(() => resolvePaper("a6" as never)).toThrowError(/未知纸张预设/);
  });
});
