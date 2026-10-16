// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createChartComponents, createCrossTable, computeDataset } from "../analytics";
import { validateRenderPlan } from "../schema/validate";

describe("可选分析能力", () => {
  it("min/max不做无关求和，稀疏输入展开前检查输出单元格预算", () => {
    const extremes = [{ r: "a", c: "b", v: 1e308 }, { r: "a", c: "b", v: 1e308 }];
    for (const aggregate of ["min", "max"] as const) expect(createCrossTable(extremes, { rowField: "r", columnField: "c", valueField: "v", aggregate }).rows[0]!.c0).toBe(1e308);
    const diagonal = Array.from({ length: 100 }, (_, index) => ({ r: String(index), c: String(index), v: 1 }));
    expect(() => createCrossTable(diagonal, { rowField: "r", columnField: "c", valueField: "v", maxCells: 1000 })).toThrow(/maxCells/);
    expect(() => computeDataset([{ a: 1 }, { a: 2 }], { fields: [{ field: "x", expression: { field: "a" } }, { field: "y", expression: { field: "a" } }], maxCells: 3 })).toThrow(/maxCells/);
  });
  it("coalesce 按需求值，已有0/false值不执行会出错的后备表达式", () => {
    const failure = { op: "divide" as const, args: [{ value: 1 }, { value: 0 }] };
    for (const value of [5, 0, false]) {
      expect(computeDataset([{}], { fields: [{ field: "x", expression: { op: "coalesce", args: [{ value }, failure] } }] }).rows[0]!.x).toBe(value);
    }
    expect(computeDataset([{}], { fields: [{ field: "x", expression: { op: "coalesce", args: [{ field: "missing" }, { value: 7 }] } }] }).rows[0]!.x).toBe(7);
  });

  it("极端但有限的正负范围仍输出有限图元，几何溢出明确拒绝", () => {
    const options = { type: "line" as const, categories: ["A", "B"], series: [{ name: "values", values: [-1e308, 1e308] }], leftMm: 0, topMm: 0, widthMm: 100, heightMm: 60 };
    const components = createChartComponents(options);
    expect(validateRenderPlan({ schemaVersion: "chart-extreme", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components }] }).ok).toBe(true);
    expect(components.every((component) => [component.leftMm, component.topMm, component.widthMm, component.heightMm].every(Number.isFinite))).toBe(true);
    expect(() => createChartComponents({ ...options, leftMm: 1e308, widthMm: 1e308 })).toThrow(/溢出/);
  });
  it("柱图/折线图展开可复用基础图元，负数与空值不产生非法坐标", () => {
    for (const type of ["bar", "line"] as const) {
      const components = createChartComponents({ type, categories: ["甲", "乙", "丙"], series: [{ name: "产重", values: [-2, 0, 4] }, { name: "对照", values: [1, null, 3] }], leftMm: 10, topMm: 10, widthMm: 160, heightMm: 80, title: "生产趋势", showValues: true });
      expect(validateRenderPlan({ schemaVersion: "test", pages: [{ pageWidthMm: 210, pageHeightMm: 297, components }] }).ok).toBe(true);
      expect(components.every((component) => !["chart", "image"].includes(component.kind))).toBe(true);
      if (type === "line") expect(components.some((component) => component.lineDirection === "up")).toBe(true);
    }
    expect(() => createChartComponents({ type: "bar", categories: ["A"], series: [{ name: "bad", values: [NaN] }], leftMm: 0, topMm: 0, widthMm: 100, heightMm: 50 })).toThrow(/有限数字/);
  });

  it("交叉表保留零、缺失为null，总平均按原始样本加权", () => {
    const input = [{ shift: "甲", grade: "A", weight: 0 }, { shift: "甲", grade: "A", weight: 20 }, { shift: "乙", grade: "B", weight: 100 }];
    const result = createCrossTable(input, { rowField: "shift", columnField: "grade", valueField: "weight", aggregate: "avg", totals: true });
    expect(result.rows).toEqual([{ rowLabel: "甲", c0: 10, c1: null, total: 10 }, { rowLabel: "乙", c0: null, c1: 100, total: 100 }, { rowLabel: "合计", c0: 10, c1: 100, total: 40 }]);
    expect(input[0]?.weight).toBe(0);
    expect(() => createCrossTable(input, { rowField: "shift", columnField: "grade", aggregate: "count", maxColumns: 1 })).toThrow(/预算/);
    expect(() => createCrossTable([{ r: "A", c: "B", value: "00123" }], { rowField: "r", columnField: "c", valueField: "value" })).toThrow(/不能隐式/);
  });

  it("计算支持声明式依赖和可插拔公式，失败明确定位，不修改来源", () => {
    const input = [{ qty: 3, price: 4 }];
    const result = computeDataset(input, { fields: [{ field: "amount", expression: { op: "multiply", args: [{ field: "qty" }, { field: "price" }] } }, { field: "double", expression: "amount*2" }], formula: { evaluate: (_expression, { row }) => Number(row.amount) * 2 } });
    expect(result.rows[0]).toEqual({ qty: 3, price: 4, amount: 12, double: 24 });
    expect(input[0]).toEqual({ qty: 3, price: 4 });
    const field = { field: "ratio", expression: { op: "divide" as const, args: [{ value: 1 }, { value: 0 }] } };
    expect(() => computeDataset(input, { fields: [field] })).toThrow(/第 1 行 ratio.*除以零/);
    expect(computeDataset(input, { fields: [field], onError: "null" }).issues).toHaveLength(1);
    expect(() => computeDataset(input, { fields: [{ field: "x", expression: "1+1" }] })).toThrow(/adapter/);
    expect(() => computeDataset(input, { fields: [{ field: "__proto__", expression: { value: 1 } }] })).toThrow(/安全/);
    expect(() => computeDataset(input, { fields: [{ field: "x", expression: "bad" }], formula: { evaluate: () => Infinity } })).toThrow(/有限 JSON 标量/);
    expect(() => computeDataset(input, { fields: [{ field: "x", expression: "async" }], formula: { evaluate: () => Promise.resolve(1) } })).toThrow(/异步公式/);
    expect(computeDataset(input, { fields: [{ field: "missing", expression: { field: "absent" } }] }).rows[0]?.missing).toBeNull();
  });
});
