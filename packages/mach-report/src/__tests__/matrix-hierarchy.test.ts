// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createMatrixTable, estimateMatrixTable, validateMatrixOptions, type MatrixTableOptions } from "../processing/matrix";
import { estimateListLayoutCells, paginateTemplate, type ListComponent, type ReportTemplate } from "../layout/paginate";
import { validateReportTemplate } from "../source/template-registry";
import { validateRenderPlan } from "../schema/validate";

const rows = [
  { plant: "B", grade: "G2", year: 2026, month: 2, value: 30, weight: 1 },
  { plant: "A", grade: "G1", year: 2026, month: 1, value: 10, weight: 1 },
  { plant: "A", grade: "G2", year: 2026, month: 1, value: 20, weight: 3 },
  { plant: "A", grade: "G2", year: 2025, month: 12, value: null, weight: 4 },
];
function options(): MatrixTableOptions {
  return { rowFields: ["plant", "grade"], columnFields: ["year", "month"], measures: [{ field: "value", op: "avg", label: "Average" }, { field: "weighted", valueField: "value", weightField: "weight", op: "weightedAvg" }], totals: true,
    hierarchy: { row: { labels: ["Plant", "Grade"], sort: ["asc", "asc"], subtotals: [1] }, column: { sort: ["asc", "asc"], subtotals: [1] }, subtotalLabel: "Subtotal" } };
}
function list(matrix = options()): ListComponent {
  return { kind: "list", dataset: "rows", layout: "wide", leftMm: 5, topMm: 5, widthMm: 150, columns: [{ field: "plant", header: "Placeholder", widthMm: 30 }], matrix, rowHeightMm: 8, headerEveryPage: true, headerBackgroundColor: "#e8f0fc", headerAlign: "center" };
}
function template(component = list()): ReportTemplate { return { pages: [{ widthMm: 160, heightMm: 75, layout: "wide", components: [component] }] }; }

describe("opt-in hierarchical matrices", () => {
  it("inherits existing business headings only when hierarchical display names are omitted", () => {
    const config = list({ rowFields: ["plant", "grade"], columnFields: ["year", "month"], measures: [{ field: "value", op: "sum" }, { field: "weighted", valueField: "value", op: "weightedAvg", weightField: "weight" }, { field: "missing", valueField: "value", op: "avg", label: "业务指定名称" }, { field: "other", valueField: "weight", op: "sum" }], hierarchy: {} });
    config.columns = [{ field: "plant", header: "厂区", widthMm: 30 }, { field: "year", header: "年度", widthMm: 30 }, { field: "value", header: "重量（t）", widthMm: 30 }];
    const result = paginateTemplate(template(config), { rows }).plan.pages.flatMap(page => page.components).find(component => component.table?.role === "header")!;
    expect(result.grid!.cells[0]!.slice(0, 2).map(cell => cell!.text)).toEqual(["厂区", "grade"]);
    expect(result.grid!.cells[2]!.slice(0, 4).map(cell => cell!.text)).toEqual(["重量（t）（求和）", "重量（t）（加权平均）", "业务指定名称", "other (sum)"]);
    expect(result.meta!.matrix).toMatchObject({ rowLabels: ["厂区", "grade"], columnLabels: ["年度", "month"] });
    expect(config.matrix!.hierarchy).toEqual({}); expect(config.matrix!.measures[0]!.label).toBeUndefined();
    config.matrix!.hierarchy = { row: { labels: ["自定厂别", "自定钢种"] }, column: { labels: ["自定年度", "自定月份"] } };
    config.matrix!.measures[0]!.label = "自定重量";
    const explicit = paginateTemplate(template(config), { rows }).plan.pages[0]!.components.find(component => component.table?.role === "header")!;
    expect(explicit.grid!.cells[0]![0]!.text).toBe("自定厂别"); expect(explicit.grid!.cells[2]![0]!.text).toBe("自定重量");
    expect(explicit.meta!.matrix).toMatchObject({ columnLabels: ["自定年度", "自定月份"] });
  });
  it("generates true multi-level headers, separate row dimensions and raw-sample weighted subtotals", () => {
    const result = createMatrixTable(rows, options());
    expect(result.rows).toHaveLength(6); expect(result.columns).toHaveLength(14);
    expect(result.columns.slice(0, 2).map(column => column.header)).toEqual(["Plant", "Grade"]);
    expect(result.headerGrid!.cells[0]!.slice(0, 3)).toMatchObject([{ text: "Plant", rowSpan: 3 }, { text: "Grade", rowSpan: 3 }, { text: "2025", colSpan: 4 }]);
    expect(result.headerGrid!.cells[1]![0]).toMatchObject({ text: "12", colSpan: 2 });
    expect(result.headerGrid!.cells[1]![1]).toMatchObject({ text: "Subtotal", colSpan: 2 });
    expect(result.headerGrid!.cells[0]![4]).toMatchObject({ text: "合计", rowSpan: 2, colSpan: 2 });
    const subtotal = result.rows[2]!;
    expect(subtotal).toMatchObject({ r0: "A", r1: "Subtotal", total_0: 15, total_1: 17.5 });
    expect(result.rows[5]).toMatchObject({ r0: "合计", r1: null, total_0: 20, total_1: 20 });
    const yearSubtotal = result.metadata!.columns.find(column => column.kind === "subtotal" && column.values[0] === 2026 && column.measure === 0)!;
    expect(subtotal[yearSubtotal.field]).toBe(15);
    expect(rows[0]!.plant).toBe("B");
  });
  it("retains default flat output and metric-major ordering when hierarchy is omitted", () => {
    const config = options(); delete config.hierarchy;
    const result = createMatrixTable(rows, config);
    expect(result.headerGrid).toBeUndefined(); expect(result.metadata).toBeUndefined();
    expect(result.columns.map(column => column.field)).toEqual(["rowLabel", "c0_0", "c1_0", "c2_0", "total_0", "c0_1", "c1_1", "c2_1", "total_1"]);
  });
  it("keeps typed identity stable across sorting, translated labels and reordered source records", () => {
    const original = createMatrixTable(rows, options());
    const next = options(); next.hierarchy = { row: { labels: ["厂别", "钢种"], sort: ["desc", "source"], subtotals: [1] }, column: { sort: ["desc", "desc"], subtotals: [1] }, emptyLabel: "Missing", subtotalLabel: "Small total" };
    const changed = createMatrixTable([...rows].reverse(), next);
    expect(changed.metadata!.rows.map(member => member.key).sort()).toEqual(original.metadata!.rows.map(member => member.key).sort());
    expect(changed.metadata!.columns.map(member => member.key).sort()).toEqual(original.metadata!.columns.map(member => member.key).sort());
    expect(changed.rows[0]!.r0).toBe("B");
    expect(changed.metadata!.columns[0]!.values).toEqual([2026, 2]);
    expect(original.metadata!.rows[2]).toMatchObject({ kind: "subtotal", depth: 1, fields: ["plant"], values: ["A"] });
    expect(original.metadata!.rows[5]).toMatchObject({ kind: "total", fields: [], values: [] });
  });
  it("coalesces null/missing dimensions while preserving empty text, zero, false and numeric text", () => {
    const input = [null, undefined, "", 0, false, "0"].map(value => ({ r: value, c: "C", value: 0 }));
    const result = createMatrixTable(input, { rowFields: ["r"], columnFields: ["c"], measures: [{ field: "value", op: "count" }], hierarchy: { emptyLabel: "Missing", row: { sort: ["asc"] } } });
    expect(result.rows).toHaveLength(5); expect(result.rows[0]).toEqual({ r0: "Missing", c0_0: 2 });
    expect(new Set(result.metadata!.rows.map(member => member.key)).size).toBe(5);
    expect(result.metadata!.rows.map(member => member.values[0])).toEqual([null, false, 0, "", "0"]);
  });
  it("does not collide dimensions whose flattened display labels are equal", () => {
    const result = createMatrixTable([{ a: "A / B", b: "C", c: "x", value: 1 }, { a: "A", b: "B / C", c: "x", value: 2 }], { rowFields: ["a", "b"], columnFields: ["c"], measures: [{ field: "value", op: "sum" }], hierarchy: {} });
    expect(result.rows).toHaveLength(2); expect(result.metadata!.rows[0]!.key).not.toBe(result.metadata!.rows[1]!.key);
    expect(result.rows.map(row => row.c0_0)).toEqual([1, 2]);
  });
  it("supports every intermediate subtotal depth without double counting null or exact decimal measures", () => {
    const result = createMatrixTable([{ a: "A", b: "B", c: "C", x: "X", y: "Y", z: "Z", v: "0.1" }, { a: "A", b: "B", c: "D", x: "X", y: "Y", z: "Z", v: "0.2" }, { a: "A", b: "B", c: "D", x: "X", y: "Y", z: "Z", v: null }], { rowFields: ["a", "b", "c"], columnFields: ["x", "y", "z"], measures: [{ field: "v", op: "sum", numeric: "decimal", digits: 2 }, { field: "n", valueField: "v", op: "count" }], totals: true, hierarchy: { row: { subtotals: [2, 1] }, column: { subtotals: [1, 2] } } });
    expect(result.rows.map(row => row.total_0)).toEqual(["0.10", "0.20", "0.30", "0.30", "0.30"]);
    expect(result.rows.map(row => row.total_1)).toEqual([1, 1, 2, 2, 2]);
    expect(result.headerGrid!.cells).toHaveLength(4);
    expect(result.metadata!.columns.filter(column => column.kind === "subtotal" && column.measure === 0).map(column => column.depth)).toEqual([2, 1]);
  });
  it("budgets prefix expansion and aggregate work before reading any measure payload", () => {
    let reads = 0;
    const input = rows.map(row => ({ ...row, get value() { reads++; return 1; } }));
    for (const limits of [{ maxRows: 5 }, { maxColumns: 5 }, { maxCells: 83 }, { maxAggregateUpdates: 1 }, { maxInputRows: 1 }]) expect(() => createMatrixTable(input, { ...options(), ...limits })).toThrow(/预算/);
    expect(reads).toBe(0);
    expect(estimateMatrixTable(input, options())).toEqual({ rowCount: 6, columnCount: 14, cells: 84 });
    expect(reads).toBe(0);
  });
  it("rejects invalid hierarchy structures, levels, sorts, widths and aggregate budgets on empty inputs", () => {
    const configs = [null, [], { row: null }, { row: [] }, { row: { labels: ["one"] } }, { row: { sort: ["asc", "asc", "asc"] } }, { row: { sort: ["random"] } }, { row: { subtotals: [0] } }, { row: { subtotals: [2] } }, { row: { subtotals: [1, 1] } }, { column: { subtotals: [1.1] } }, { emptyLabel: 1 }, { subtotalLabel: false }];
    for (const hierarchy of configs) expect(() => createMatrixTable([], { ...options(), hierarchy } as MatrixTableOptions)).toThrow(/矩阵/);
    expect(() => validateMatrixOptions({ ...options(), maxAggregateUpdates: 0 })).toThrow(/预算/);
    expect(() => createMatrixTable([null] as unknown as Record<string, unknown>[], options())).toThrow(/数据行/);
    for (const plant of [NaN, Infinity, {}, [], new Date()]) expect(() => createMatrixTable([{ ...rows[0], plant }], options())).toThrow(/标量/);
  });
  it("does not invent members or phantom totals for empty input", () => {
    const result = createMatrixTable([], options());
    expect(result.rows).toEqual([]); expect(result.metadata!.columns).toEqual([]); expect(result.columns).toHaveLength(2);
    expect(estimateMatrixTable([], options())).toEqual({ rowCount: 0, columnCount: 2, cells: 0 });
  });
  it("paginates physical headers and derived identities, retains summary roles and safely overestimates allocations", () => {
    const config = list(); config.rowKey = "plant";
    const result = paginateTemplate(template(config), { rows });
    expect(validateRenderPlan(result.plan).ok).toBe(true); expect(validateReportTemplate(template(config)).ok).toBe(true);
    const components = result.plan.pages.flatMap(page => page.components), headers = components.filter(component => component.table?.role === "header"), body = components.filter(component => component.table && component.table.role !== "header");
    expect(headers.length).toBeGreaterThan(1); expect(headers[0]!.grid!.cells).toHaveLength(3);
    expect(headers[0]!.meta!.matrix).toMatchObject({ rowFields: ["plant", "grade"], columns: expect.arrayContaining([expect.objectContaining({ values: [2026, 1], fields: ["year", "month"], operation: "avg" })]) });
    expect(body).toHaveLength(6); expect(body[2]!.table!.role).toBe("subtotal"); expect(body[5]!.table!.role).toBe("grand-total");
    for (const component of body) { expect(component.table!.source).toBeUndefined(); expect(component.meta!.matrix).toMatchObject({ row: expect.objectContaining({ key: expect.any(String) }) }); expect(component.grid!.cells[0]!.every(cell => cell?.editable === false && cell.source === undefined)).toBe(true); }
    expect(estimateListLayoutCells(config, { rows })).toBe(84 + 14 * 3);
    expect(headers[0]!.grid!.cells[0]![0]!.style).toMatchObject({ align: "center", backgroundColor: "#e8f0fc" });
    expect(headers[0]!.grid!.rowHeightsMm!.every(height => height >= 8)).toBe(true);
    expect(headers[0]!.grid!.rowHeightsMm![2]).toBeGreaterThan(8); // The longer measure label wraps and reserves actual height.
  });
  it("omits headers from estimates when disabled and rejects unsafe mixed layouts", () => {
    const component = list(); component.header = false;
    expect(estimateListLayoutCells(component, { rows })).toBe(84);
    expect(paginateTemplate(template(component), { rows }).plan.pages.flatMap(page => page.components).every(item => item.table?.role !== "header")).toBe(true);
    component.groups = [{ field: "plant" }];
    expect(() => paginateTemplate(template(component), { rows })).toThrow(/矩阵/);
    delete component.groups; component.tree = { input: "flat", idField: "plant", parentField: "parent", labelField: "plant" };
    expect(() => paginateTemplate(template(component), { rows })).toThrow(/树形/);
  });
});
