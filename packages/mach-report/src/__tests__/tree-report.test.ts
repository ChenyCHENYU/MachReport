// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTreeTable, validateTreeOptions, type TreeTableOptions } from "../processing/tree";
import { paginateTemplate, estimateListLayoutCells, type ReportTemplate, type ListComponent } from "../layout/paginate";
import { validateReportTemplate } from "../source/template-registry";
import { createReportSource } from "../source/report-source";
import { createReportRuntime } from "../server/runtime";
import { reviewReportTemplate } from "../source/template-review";
import { createReportEditSession } from "../editing/session";
import { createReportCellEditBatch } from "../editing/batch";
import { getReportCellContext, type ReportCellContext } from "../editing/context";
import type { RenderPlan } from "../schema/render-plan";
import { diffReportTemplates } from "../source/template-diff";

const options: TreeTableOptions = { input: "flat", idField: "id", parentField: "parent", labelField: "label" };
function rows() { return [{ id: "L2", parent: "M", label: "Material B", amount: "0.20", qty: 0 }, { id: "P", parent: null, label: "Total", amount: "999.00", qty: 999 }, { id: "M", parent: "P", label: "Material", amount: "888.00", qty: 888 }, { id: "L1", parent: "M", label: "Material A", amount: "0.10", qty: null }]; }
function fixture(tree: TreeTableOptions = options): { template: ReportTemplate; list: ListComponent } {
  const list: ListComponent = { kind: "list", id: "cost", dataset: "cost", leftMm: 2, topMm: 2, widthMm: 100, rowHeightMm: 7, columns: [{ field: "label", header: "Cost item", widthMm: 60, editable: true }, { field: "amount", header: "Amount", widthMm: 40, editable: true }], tree: structuredClone(tree) };
  return { list, template: { pages: [{ widthMm: 105, heightMm: 32, components: [list] }] } };
}
function cell(plan: RenderPlan, key: string, field = "amount"): ReportCellContext {
  for (const [pageIndex, page] of plan.pages.entries()) for (const [componentIndex, component] of page.components.entries()) {
    if (component.table?.role !== "body" || component.table.source?.rowKey !== key) continue;
    return getReportCellContext(plan, { pageIndex, componentIndex, rowIndex: 0, columnIndex: component.table.columnKeys.indexOf(field) })!;
  }
  throw new Error(`missing ${key}.${field}`);
}
describe("bounded hierarchical report processing", () => {
  it("orders out-of-order flat records without mutation and retains sibling source order", () => {
    const input = rows(), before = JSON.stringify(input), result = createTreeTable(input, options);
    expect(result.entries.map(entry => [entry.key, entry.depth, entry.hasChildren])).toEqual([["P", 0, true], ["M", 1, true], ["L2", 2, false], ["L1", 2, false]]);
    expect(result.rows[0]).toBe(input[1]); expect(result.rows[0]!.amount).toBe("999.00");
    expect(result.leaves.map(row => row.id)).toEqual(["L2", "L1"]); expect(JSON.stringify(input)).toBe(before);
  });
  it("uses only descendant leaves for precise parent rollups while preserving true zero and all-null results", () => {
    const result = createTreeTable(rows(), { ...options, parentValues: "leaf-aggregate", aggregates: [{ field: "amount", op: "sum", numeric: "decimal", digits: 2 }, { field: "qty", op: "sum" }, { field: "missing", op: "avg" }] });
    expect(result.rows.slice(0, 2).map(row => [row.amount, row.qty, row.missing])).toEqual([["0.30", 0, null], ["0.30", 0, null]]);
    expect(rows()[1]!.amount).toBe("999.00");
  });
  it("supports leaf weighted averages across uneven branches without averaging parent values", () => {
    const result = createTreeTable([{ id: "P", label: "root" }, { id: "A", parent: "P", label: "a", value: "999" }, { id: "B", parent: "P", label: "b", value: "20", weight: "1" }, { id: "C", parent: "A", label: "c", value: "10", weight: "3" }], { ...options, parentValues: "leaf-aggregate", aggregates: [{ field: "value", op: "weightedAvg", weightField: "weight", numeric: "decimal", digits: 2 }] });
    expect(result.rows.map(row => row.value)).toEqual(["12.50", "10.00", "10", "20"]);
  });
  it("handles nested children with stable IDs, explicit defaults and nonrecursive traversal", () => {
    const input = [{ id: 1, label: "root", children: [{ id: "1", label: "child", children: [{ id: 2, label: "leaf" }] }] }];
    expect(createTreeTable(input, { input: "nested", idField: "id", labelField: "label" }).entries.map(entry => [entry.key, entry.depth])).toEqual([[1, 0], ["1", 1], [2, 2]]);
  });
  it.each([
    [[{ id: "A", parent: "A", label: "self" }], "自身"],
    [[{ id: "A", parent: "B" }, { id: "B", parent: "A" }], "循环"],
    [[{ id: "A" }, { id: "A" }], "重复"],
    [[{ id: "A", parent: "missing" }], "父节点不存在"],
    [[{ id: "A", parent: "" }], "业务键"],
  ])("rejects invalid graph %# before rendering", (data, message) => { expect(() => createTreeTable(data, options)).toThrow(message); });
  it("does not silently drop orphans and promotes them only with explicit root policy", () => {
    expect(createTreeTable([{ id: "A", parent: "missing" }, { id: "B", parent: "A" }], { ...options, orphan: "root" }).entries.map(entry => [entry.key, entry.depth])).toEqual([["A", 0], ["B", 1]]);
  });
  it("enforces node, depth, aggregate work and cancellation budgets", () => {
    expect(() => createTreeTable(rows(), { ...options, maxRows: 3 })).toThrow("行数预算 3");
    expect(() => createTreeTable(rows(), { ...options, maxDepth: 2 })).toThrow("深度预算 2");
    expect(() => createTreeTable(rows(), { ...options, parentValues: "leaf-aggregate", aggregates: [{ field: "amount", op: "sum", numeric: "decimal" }], maxAggregationVisits: 3 })).toThrow("访问预算 3");
    const controller = new AbortController(); controller.abort();
    expect(() => createTreeTable(rows(), options, { signal: controller.signal })).toThrow(expect.objectContaining({ name: "AbortError" }));
    const nested: Record<string, unknown> = { id: "A", label: "A" }; nested.children = [nested];
    expect(() => createTreeTable([nested], { ...options, input: "nested" })).toThrow("重复");
    expect(() => createTreeTable([{ id: "A", children: {} }], { ...options, input: "nested" })).toThrow("数组");
  });
  it.each([
    { idField: "__proto__" }, { parentValues: "leaf-aggregate" }, { aggregates: [{ field: "amount", op: "sum" }] },
    { input: "nested", childrenField: "label" }, { maxRows: 1000001 }, { indentMm: -1 },
    { parentValues: "leaf-aggregate", aggregates: [{ field: "constructor", op: "sum" }] },
    { input: "nested", parentValues: "leaf-aggregate", aggregates: [{ field: "children", op: "sum" }] },
  ])("rejects unsafe/incomplete declarations %#", patch => { expect(() => validateTreeOptions({ ...options, ...patch } as TreeTableOptions)).toThrow(); });
  it("paginates every node with physical indentation and source identity; total reads leaves only", () => {
    const { list, template } = fixture(); list.grandTotal = { aggregates: [{ field: "amount", op: "sum", numeric: "decimal", digits: 2 }] };
    const plan = paginateTemplate(template, { cost: rows() }).plan;
    expect(plan.pages.length).toBeGreaterThan(1);
    expect(plan.pages.flatMap(page => page.components).filter(component => component.table?.role === "body").map(component => component.table!.source!.rowKey)).toEqual(["P", "M", "L2", "L1"]);
    expect(cell(plan, "L2", "label").cell).toMatchObject({ text: "Material B", value: "Material B", indentMm: 6, style: { align: "left" } });
    const total = plan.pages.flatMap(page => page.components).find(component => component.table?.role === "grand-total")!;
    expect(total.grid!.cells[0]![1]!.value).toBe("0.30");
  });
  it("recalculates derived parents after a leaf edit using default tree identity and preserves concurrency", async () => {
    const { template } = fixture({ ...options, parentValues: "leaf-aggregate", aggregates: [{ field: "amount", op: "sum", numeric: "decimal", digits: 2 }] });
    const session = createReportEditSession({ template, datasets: { cost: rows() } }), plan = session.plan;
    expect(cell(plan, "P")).toMatchObject({ editable: false, readOnlyReason: "derived" }); expect(cell(plan, "P").source).toBeUndefined();
    const batch = createReportCellEditBatch(plan, [{ address: cell(plan, "L2").address, value: "0.40" }], "leaf-edit");
    const prepared = await session.prepare(plan, batch); expect(cell(prepared.plan, "P").value).toBe("0.50"); expect(cell(plan, "P").value).toBe("0.30");
    const committed = prepared.commit({ revision: "r2", sourceToken: "v2" }); expect(cell(committed, "L2").source).toMatchObject({ rowKey: "L2", revision: "r2", sourceToken: "v2" });
  });
  it("protects structural keys and nested data despite column editable=true", () => {
    const { list, template } = fixture(); list.columns.push({ field: "parent", header: "Parent", widthMm: 20, editable: true });
    let plan = paginateTemplate(template, { cost: rows() }).plan;
    expect(cell(plan, "L2", "parent").editable).toBe(false);
    list.tree = { input: "nested", idField: "id", labelField: "label" };
    plan = paginateTemplate(template, { cost: [{ id: "P", label: "Root", amount: 0, children: [{ id: "L", label: "Leaf", amount: 1 }] }] }).plan;
    expect(cell(plan, "L").editable).toBe(false);
  });
  it("rejects ambiguous layout combinations in both template and direct core APIs", () => {
    const { list, template } = fixture(); list.groupBy = { field: "label" };
    expect(validateReportTemplate(template)).toMatchObject({ ok: false, errors: [expect.objectContaining({ path: "$.pages.0.components.0.tree" })] });
    expect(() => paginateTemplate(template, { cost: rows() })).toThrow("不能同时");
    delete list.groupBy; list.tree!.input = "nested"; list.computed = [{ field: "children", expression: { value: null } }];
    expect(validateReportTemplate(template).ok).toBe(false);
    expect(() => paginateTemplate(template, { cost: [] })).toThrow("结构键");
  });
  it("validates nested child scalar contracts and counts descendants in shared server budgets", async () => {
    const { template } = fixture({ input: "nested", idField: "id", labelField: "label" });
    const datasets = { cost: [{ id: "P", label: "root", amount: 1, children: [{ id: "L", label: "leaf", amount: "bad" }] }] };
    const dataSchema = { cost: { rowKey: "id", fields: [{ field: "id", type: "text" as const }, { field: "label", type: "text" as const }, { field: "amount", type: "number" as const }] } };
    await expect(createReportSource({ cost: { template, datasets, dataSchema } })({ reportIds: ["cost"], params: {} })).rejects.toMatchObject({ code: "validate", message: expect.stringContaining("字段契约") });
    const runtime = createReportRuntime({ reports: { cost: { template, datasets } }, budget: { maxRows: 1 } });
    await expect(runtime.prepare({ reportIds: ["cost"] })).rejects.toMatchObject({ code: "budget", path: "$.budget.maxRows" });
    const review = reviewReportTemplate({ schemaVersion: "1.0", id: "cost", name: "Cost", template }, { dataSchemas: dataSchema, fixtures: [{ name: "nested", datasets }] });
    expect(review.ok).toBe(false); expect(review.issues.some(issue => issue.code === "sample" && issue.message.includes("number"))).toBe(true);
    const valid = createReportRuntime({ reports: { cost: { template, datasets: { cost: [{ id: "P", label: "root", children: [{ id: "L", label: "leaf" }] }] } } } });
    expect((await valid.prepare({ reportIds: ["cost"] })).stats.rows).toBe(2);
    const description = createReportRuntime({ reports: { cost: { template, datasets, dataSchema } } }).describe()[0]!;
    expect(description.datasetsSchema.cost).toMatchObject({ items: { $ref: "#/$defs/treeNode" }, $defs: { treeNode: { properties: { children: { anyOf: [{ type: "null" }, { type: "array", items: { $ref: "#/$defs/treeNode" } }] } } } } });
  });
  it("indexes large flat sources with one ID read per node and no row cloning in source mode", () => {
    let reads = 0;
    const input = Array.from({ length: 20000 }, (_, index) => ({ get id() { reads++; return index; }, parent: index ? 0 : null, label: `Node ${index}` }));
    const result = createTreeTable(input, options);
    expect(result.rows.length).toBe(20000); expect(result.leaves.length).toBe(19999); expect(reads).toBe(20000);
    expect(result.rows[19999]).toBe(input[19999]);
  });
  it("marks hierarchy identity changes as breaking bindings during publication review", () => {
    const previous = { schemaVersion: "1.0" as const, id: "cost", name: "Cost", template: fixture().template };
    const next = structuredClone(previous); (next.template.pages[0]!.components[0] as ListComponent).tree!.idField = "key";
    const change = diffReportTemplates(previous, next).changes.find(item => item.path.endsWith(".tree.idField"));
    expect(change).toMatchObject({ category: "binding", breaking: true });
  });
  it("counts custom tree header cells in preflight budgets before allocation", () => {
    const { list } = fixture(); list.headerGrid = { cells: [[{ text: "Cost" }, { text: "Amount" }], [{ text: "Item" }, { text: "Value" }]], rowHeightsMm: [6, 6], colWidthsMm: [60, 40] };
    expect(estimateListLayoutCells(list, { cost: rows() })).toBe(12);
    list.header = false; expect(estimateListLayoutCells(list, { cost: rows() })).toBe(8);
  });
});
