import { describe, expect, it } from "vitest";
import type { ComponentStyle, PlanComponent } from "../schema/render-plan";
import { resolveGridLayout } from "../render/grid-geometry";
import { resolveGridStrokes } from "../render/grid-strokes";
import { renderPlan } from "../render/dom";

const none: ComponentStyle = { borderTop: false, borderRight: false, borderBottom: false, borderLeft: false };
function strokes(comp: PlanComponent) { return resolveGridStrokes(resolveGridLayout(comp.grid!, comp.widthMm, comp.heightMm), comp); }

describe("共享单元格边线", () => {
  it("保留旧默认网格、合并跨度和组件关闭边框的语义", () => {
    const component: PlanComponent = { kind: "rect", leftMm: 0, topMm: 0, widthMm: 40, heightMm: 20, grid: {
      colWidthsMm: [20, 20], rowHeightsMm: [10, 10], cells: [[{ rowSpan: 2 }, {}], [{}]]
    } };
    expect(strokes(component)).toHaveLength(6);
    expect(strokes(component).find((edge) => edge.kind === "h" && edge.pos === 10)).toMatchObject({ from: 20, to: 40 });
    expect(strokes({ ...component, style: none })).toEqual([]);
  });

  it("显式无边框不制造内外线，合并单边及颜色在 DOM 中真实生效", () => {
    const component: PlanComponent = { kind: "rect", leftMm: 0, topMm: 0, widthMm: 40, heightMm: 20, grid: {
      colWidthsMm: [20, 20], rowHeightsMm: [10, 10], cells: [
        [{ style: none }, { style: none }],
        [{ colSpan: 2, style: { ...none, borderBottom: true, borderColor: "#123456", lineWidthPt: 1 } }]
      ]
    } };
    expect(strokes(component)).toEqual([{ kind: "h", pos: 20, from: 0, to: 40, color: "#123456", widthPt: 1 }]);
    const root = renderPlan({ schemaVersion: "border", pages: [{ pageWidthMm: 40, pageHeightMm: 20, components: [component] }] }, document);
    const edges = root.querySelectorAll<HTMLElement>(".mr-grid-edge");
    expect(edges).toHaveLength(1);
    expect(edges[0]!.style.top).toBe("75.59px");
    expect(edges[0]!.style.borderTopColor).toBe("#123456");
  });

  it("相邻合并格的共边分段去重，较粗边框优先，不越过被合并区域", () => {
    const component: PlanComponent = { kind: "rect", leftMm: 0, topMm: 0, widthMm: 40, heightMm: 20, grid: {
      colWidthsMm: [20, 20], rowHeightsMm: [10, 10], cells: [
        [{ colSpan: 2, style: { ...none, borderBottom: true, borderColor: "#ff0000", lineWidthPt: 1 } }],
        [{ style: { ...none, borderTop: true, borderColor: "#0000ff", lineWidthPt: 2 } }, { style: none }]
      ]
    } };
    expect(strokes(component)).toEqual([
      { kind: "h", pos: 10, from: 0, to: 20, color: "#0000ff", widthPt: 2 },
      { kind: "h", pos: 10, from: 20, to: 40, color: "#ff0000", widthPt: 1 }
    ]);
  });

  it("某一格自定义边线后，稀疏网格的隐式空格仍保持默认边框", () => {
    const component: PlanComponent = { kind: "rect", leftMm: 0, topMm: 0, widthMm: 40, heightMm: 10, grid: {
      colWidthsMm: [20, 20], cells: [[{ style: none }]]
    } };
    expect(strokes(component).map(({ kind, pos, from, to }) => ({ kind, pos, from, to }))).toEqual([
      { kind: "h", pos: 0, from: 20, to: 40 }, { kind: "h", pos: 10, from: 20, to: 40 },
      { kind: "v", pos: 20, from: 0, to: 10 }, { kind: "v", pos: 40, from: 0, to: 10 }
    ]);
  });
});
