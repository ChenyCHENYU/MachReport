// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveGridLayout } from "../render/grid-geometry";
import type { PlanGrid } from "../schema/render-plan";

describe("resolveGridLayout", () => {
  it("无显式列宽/行高时均分", () => {
    const grid: PlanGrid = { cells: [[{ text: "a" }, { text: "b" }], [{ text: "c" }, { text: "d" }]] };
    const layout = resolveGridLayout(grid, 100, 40);
    expect(layout.columns).toHaveLength(2);
    expect(layout.columns[0]!.pos).toBe(0);
    expect(layout.columns[0]!.size).toBeCloseTo(50, 5);
    expect(layout.columns[1]!.pos).toBeCloseTo(50, 5);
    expect(layout.rows[1]!.pos).toBeCloseTo(20, 5);
    expect(layout.rows[1]!.size).toBeCloseTo(20, 5);
    expect(layout.cells).toHaveLength(4);
  });

  it("colWidthsMm 等比缩放至组件宽", () => {
    const grid: PlanGrid = {
      cells: [[{ text: "a" }, { text: "b" }, { text: "c" }]],
      colWidthsMm: [30, 30, 30]
    };
    const layout = resolveGridLayout(grid, 60, 10);
    expect(layout.columns.map((c) => c.size)).toEqual([20, 20, 20]);
    expect(layout.cells[2]!.xMm).toBeCloseTo(40, 5);
  });

  it("rowHeightsMm 等比缩放至组件高", () => {
    const grid: PlanGrid = {
      cells: [[{ text: "a" }], [{ text: "b" }]],
      rowHeightsMm: [3, 1]
    };
    const layout = resolveGridLayout(grid, 50, 8);
    expect(layout.rows[0]!.size).toBeCloseTo(6, 5);
    expect(layout.rows[1]!.pos).toBeCloseTo(6, 5);
    expect(layout.rows[1]!.size).toBeCloseTo(2, 5);
  });

  it("colSpan 跨列取起止列差", () => {
    const grid: PlanGrid = {
      cells: [[{ text: "wide", colSpan: 2 }, { text: "x" }]],
      colWidthsMm: [10, 10, 10]
    };
    const layout = resolveGridLayout(grid, 30, 10);
    expect(layout.cells[0]!.widthMm).toBeCloseTo(20, 5);
    expect(layout.cells[1]!.xMm).toBeCloseTo(20, 5);
    expect(layout.cells[1]!.widthMm).toBeCloseTo(10, 5);
  });

  it("rowSpan 展开占位矩阵，后续行避让", () => {
    const grid: PlanGrid = {
      cells: [
        [{ text: "tall", rowSpan: 2 }, { text: "a" }],
        [{ text: "b" }]
      ],
      colWidthsMm: [10, 10],
      rowHeightsMm: [5, 5]
    };
    const layout = resolveGridLayout(grid, 20, 10);
    const secondRow = layout.cells.filter((c) => c.ri === 1);
    expect(secondRow).toHaveLength(1);
    expect(secondRow[0]!.cell.text).toBe("b");
    expect(secondRow[0]!.ci).toBe(1);
    expect(secondRow[0]!.xMm).toBeCloseTo(10, 5);
    const tall = layout.cells.find((c) => c.cell.text === "tall")!;
    expect(tall.heightMm).toBeCloseTo(10, 5);
  });

  it("span 越界收敛到网格内", () => {
    const grid: PlanGrid = {
      cells: [[{ text: "x", colSpan: 9, rowSpan: 9 }]],
      colWidthsMm: [10, 10]
    };
    const layout = resolveGridLayout(grid, 20, 8);
    expect(layout.cells[0]!.widthMm).toBeCloseTo(20, 5);
    expect(layout.cells[0]!.heightMm).toBeCloseTo(8, 5);
  });

  it("null 单元格占位 1 列", () => {
    const grid: PlanGrid = {
      cells: [[null, { text: "b" }]],
      colWidthsMm: [10, 10]
    };
    const layout = resolveGridLayout(grid, 20, 10);
    expect(layout.cells).toHaveLength(2);
    expect(layout.cells[1]!.ci).toBe(1);
  });

  it("edges 跳过 colSpan 跨越的列边界", () => {
    const grid: PlanGrid = {
      cells: [[{ text: "wide", colSpan: 2 }, { text: "x" }], [{ text: "a" }, { text: "b" }]],
      colWidthsMm: [10, 10],
      rowHeightsMm: [5, 5]
    };
    const layout = resolveGridLayout(grid, 20, 10);
    // 列边界 c=1（x=10）：第 0 行被跨列 → 只剩第 1 行的线段
    const vEdges = layout.edges.filter((e) => e.kind === "v");
    expect(vEdges).toHaveLength(1);
    expect(vEdges[0]!.from).toBeCloseTo(5, 5);
    expect(vEdges[0]!.to).toBeCloseTo(10, 5);
    // 行边界 r=1（y=5）：无跨行 → 全宽线段
    const hEdges = layout.edges.filter((e) => e.kind === "h");
    expect(hEdges).toHaveLength(1);
    expect(hEdges[0]!.from).toBeCloseTo(0, 5);
    expect(hEdges[0]!.to).toBeCloseTo(20, 5);
  });

  it("edges 跳过 rowSpan 跨越的行边界", () => {
    const grid: PlanGrid = {
      cells: [[{ text: "tall", rowSpan: 2 }, { text: "a" }], [{ text: "b" }]],
      colWidthsMm: [10, 10],
      rowHeightsMm: [5, 5]
    };
    const layout = resolveGridLayout(grid, 20, 10);
    // 行边界 r=1：第 0 列被跨行 → 只在第 1 列有线段
    const hEdges = layout.edges.filter((e) => e.kind === "h");
    expect(hEdges).toHaveLength(1);
    expect(hEdges[0]!.from).toBeCloseTo(10, 5);
    // 列边界 c=1：两行均无跨列 → 两段合并为一整段
    const vEdges = layout.edges.filter((e) => e.kind === "v");
    expect(vEdges).toHaveLength(1);
    expect(vEdges[0]!.from).toBeCloseTo(0, 5);
    expect(vEdges[0]!.to).toBeCloseTo(10, 5);
  });

  it("单行网格无内部 edges", () => {
    const grid: PlanGrid = {
      cells: [[{ text: "a" }, { text: "b" }]],
      colWidthsMm: [10, 10]
    };
    const layout = resolveGridLayout(grid, 20, 5);
    expect(layout.edges.filter((e) => e.kind === "h")).toHaveLength(0);
    expect(layout.edges.filter((e) => e.kind === "v")).toHaveLength(1);
  });
});
