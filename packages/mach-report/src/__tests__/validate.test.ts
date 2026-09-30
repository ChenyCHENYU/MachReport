// @vitest-environment node
import { describe, expect, it } from "vitest";
import { validateRenderPlan, assertRenderPlan } from "../schema/validate";

const goodPage = {
  pageWidthMm: 210,
  pageHeightMm: 297,
  components: [
    { kind: "text", leftMm: 10, topMm: 10, widthMm: 50, heightMm: 8, text: "ok" },
    {
      kind: "rect",
      leftMm: 0,
      topMm: 0,
      widthMm: 100,
      heightMm: 20,
      grid: { cells: [[{ text: "a" }, { text: "b" }]] }
    }
  ]
};

describe("validateRenderPlan", () => {
  it("合法计划通过", () => {
    expect(validateRenderPlan({ pages: [goodPage] }).ok).toBe(true);
  });

  it("缺 pages 定位到根", () => {
    const r = validateRenderPlan({ data: {} });
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.path).toBe("$.pages");
  });

  it("非法 kind 降级为 warning（兼容 jh4j 扩展组件）", () => {
    const r = validateRenderPlan({
      pages: [
        {
          ...goodPage,
          components: [
            { kind: "video", leftMm: 0, topMm: 0, widthMm: 10, heightMm: 10 }
          ]
        }
      ]
    });
    expect(r.ok).toBe(true);
    expect(r.warnings[0]!.path).toBe("$.pages.0.components.0.kind");
    expect(r.warnings[0]!.message).toContain("video");
    expect(() => assertRenderPlan({ pages: [{ ...goodPage, components: [{ kind: "video", leftMm: 0, topMm: 0, widthMm: 10, heightMm: 10 }] }] })).not.toThrow();
  });

  it("页宽非法与几何 NaN 定位", () => {
    const r = validateRenderPlan({
      pages: [
        {
          pageWidthMm: -5,
          pageHeightMm: 297,
          components: [{ kind: "text", leftMm: "x" as unknown as number, topMm: 0, widthMm: 1, heightMm: 1 }]
        }
      ]
    });
    const paths = r.errors.map((e) => e.path);
    expect(paths).toContain("$.pages.0.pageWidthMm");
    expect(paths).toContain("$.pages.0.components.0.leftMm");
  });

  it("grid 嵌套子组件错误深层定位", () => {
    const r = validateRenderPlan({
      pages: [
        {
          pageWidthMm: 210,
          pageHeightMm: 297,
          components: [
            {
              kind: "rect",
              leftMm: 0,
              topMm: 0,
              widthMm: 10,
              heightMm: 10,
              grid: {
                cells: [[{ children: [{ kind: "bomb", leftMm: 0, topMm: 0, widthMm: 1, heightMm: 1 }] }]]
              }
            }
          ]
        }
      ]
    });
    const located = [...r.errors, ...r.warnings].find((e) => e.message.includes("bomb"));
    expect(located!.path).toBe(
      "$.pages.0.components.0.grid.cells.0.0.children.0.kind"
    );
  });

  it("richParagraphs 形状校验", () => {
    const r = validateRenderPlan({
      pages: [
        {
          pageWidthMm: 210,
          pageHeightMm: 297,
          components: [{ kind: "text", leftMm: 0, topMm: 0, widthMm: 10, heightMm: 10, richParagraphs: [{}] }]
        }
      ]
    });
    expect(r.errors[0]!.path).toBe("$.pages.0.components.0.richParagraphs.0");
  });

  it("assertRenderPlan 抛错带前 3 处摘要", () => {
    expect(() =>
      assertRenderPlan({ pages: [{ pageWidthMm: 0, pageHeightMm: 0, components: "x" }] })
    ).toThrowError(/渲染计划校验失败\(3 处\)/);
  });

  it("assertRenderPlan 通过时返回 pages", () => {
    const pages = assertRenderPlan({ pages: [goodPage] });
    expect(pages).toHaveLength(1);
  });

  it("null/undefined 输入不炸（返回错误）", () => {
    expect(validateRenderPlan(null).ok).toBe(false);
    expect(validateRenderPlan(undefined).ok).toBe(false);
    expect(validateRenderPlan("str").ok).toBe(false);
  });
});
