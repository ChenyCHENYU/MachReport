// @vitest-environment node
import { describe, expect, it } from "vitest";
import { validateReportDataset, type ReportValidationRule } from "../editing/validation";
import { validateSessionCandidates } from "../editing/session-validation";
import type { ListComponent } from "../layout/list-model";
import { createReportEditSession } from "../editing/session";
import { createReportCellEditBatch } from "../editing/batch";
import { getReportCellContext } from "../editing/context";
import { compileReportPredicate } from "../processing/predicate";
import type { ReportTemplate } from "../layout/paginate";
const rules: ReportValidationRule[] = [{ id: "positive", assert: { field: "value", op: ">=", value: 0 }, field: "value", message: "数据不能为负" }];
const tree: ListComponent = { kind: "list", dataset: "tree", leftMm: 0, topMm: 10, widthMm: 100, tree: { input: "nested", idField: "id", labelField: "name" }, columns: [{ header: "名称", field: "name", widthMm: 50 }, { header: "值", field: "value", widthMm: 50 }] };
const plain: ListComponent = { kind: "list", dataset: "other", rowKey: "id", leftMm: 0, topMm: 60, widthMm: 100, columns: [{ header: "名称", field: "id", widthMm: 50 }, { header: "值", field: "value", widthMm: 50 }] };
function template(components: ListComponent[]): ReportTemplate { return { pages: [{ widthMm: 150, heightMm: 250, components }] }; }
describe("tree and detail candidate validation use pagination data preparation", () => {
  it("checks nested descendants and reports tree.idField even when list.rowKey was omitted", () => {
    const datasets = { tree: [{ id: "root", name: "根", value: 2, children: [{ id: "child", name: "子", value: -1 }] }] };
    expect(validateSessionCandidates([{ template: template([tree]), datasets }], { rules })).toMatchObject([{ rowKey: "child", dataset: "tree", field: "value", rowIndex: 1 }]);
  });
  it("blocks a source transaction when another nested candidate dataset has an illegal child", async () => {
    const datasets = { tree: [{ id: "root", name: "根", value: 2, children: [{ id: "child", name: "子", value: -1 }] }], other: [{ id: "edit", value: 3 }] };
    const session = createReportEditSession({ template: template([tree, plain]), datasets }), initial = session.plan;
    let address;
    for (const [pageIndex, page] of initial.pages.entries()) for (const [componentIndex, component] of page.components.entries()) if (component.table?.source?.datasetId === "other" && component.table.role === "body") address = getReportCellContext(initial, { pageIndex, componentIndex, rowIndex: 0, columnIndex: 1 })?.address;
    const batch = createReportCellEditBatch(initial, [{ address: address!, value: 4 }], "candidate");
    const candidate = await session.prepare(initial, batch, { validation: { rules } });
    expect(candidate.validationIssues).toMatchObject([{ rowKey: "child" }]);
    expect(() => candidate.commit()).toThrow(/不能为负/); expect(session.plan).toBe(initial);
  });
  it("checks flat tree identities, computed values and leaf-only summaries with exact existing tree semantics", () => {
    const options = { input: "flat" as const, idField: "id", parentField: "parent", labelField: "name", parentValues: "leaf-aggregate" as const, aggregates: [{ field: "value", op: "sum" as const }] };
    const rows = [{ id: "root", parent: null, name: "根", value: 99 }, { id: "a", parent: "root", name: "A", value: 2 }, { id: "b", parent: "root", name: "B", value: 3 }];
    expect(validateReportDataset(rows, { tree: options, rules: [{ id: "parent", assert: { field: "value", op: "<=", value: 5 }, message: "错误" }, { id: "sum", scope: "dataset", aggregates: [{ field: "total", valueField: "value", op: "sum" }], assert: { field: "total", op: "==", value: 5 }, message: "不能重复统计父节点" }] })).toEqual([]);
    expect(() => validateReportDataset([...rows, rows[1]!], { tree: options, rules })).toThrow(/重复/);
    const issues = validateReportDataset(rows, { tree: { ...options, parentValues: "source", aggregates: undefined }, computed: [{ field: "double", expression: { op: "multiply", args: [{ field: "value" }, { value: 2 }] } }], rules: [{ id: "double", assert: { field: "double", op: "<=", value: 6 }, field: "double", message: "派生值" }] });
    expect(issues.map(issue => issue.rowKey)).toEqual(["root"]);
  });
  it("rejects ambiguous detail bindings independently of template order", () => {
    const master: ListComponent = { ...plain, detail: { dataset: "shared", rowKey: "childId", parentKey: "id", foreignKey: "parent", columns: plain.columns } };
    const shared: ListComponent = { ...plain, dataset: "shared", rowKey: "id" };
    for (const components of [[shared, master], [master, shared]]) expect(() => validateSessionCandidates([{ template: template(components), datasets: { other: [], shared: [] } }], { rules })).toThrow(/歧义/);
  });
  it("counts predicate work across source parts and honors expanded nested rows before publishing", () => {
    const datasets = { tree: [{ id: "root", name: "根", value: 1, children: [{ id: "child", name: "子", value: 2 }] }] };
    expect(() => validateSessionCandidates([{ template: template([tree]), datasets }, { template: template([tree]), datasets, sourceScope: "second" }], { rules, maxChecks: 3 })).toThrow(/maxChecks/);
  });
  it("shares the explicit trusted formula adapter and prevents callers from clearing validation failures", async () => {
    const source = { ...plain, computed: [{ field: "derived", expression: "trusted()", dependsOn: ["value"] }] };
    const session = createReportEditSession({ template: template([source]), datasets: { other: [{ id: "a", value: 2 }] }, pagination: { formula: { evaluate(_expression, context) { return Number(context.row.value) * 2; } } } });
    const initial = session.plan;
    let address;
    for (const [pageIndex, page] of initial.pages.entries()) for (const [componentIndex, component] of page.components.entries()) if (component.table?.role === "body") address = getReportCellContext(initial, { pageIndex, componentIndex, rowIndex: 0, columnIndex: 1 })!.address;
    const candidate = await session.prepare(initial, createReportCellEditBatch(initial, [{ address: address!, value: 3 }], "formula"));
    const issues = candidate.validate({ rules: [{ id: "derived", field: "derived", assert: { field: "derived", op: "<", value: 5 }, message: "派生值超限" }] });
    expect(issues).toMatchObject([{ rowKey: "a" }]); expect(Object.isFrozen(issues)).toBe(true); expect(Object.isFrozen(issues[0])).toBe(true);
    expect(() => candidate.commit()).toThrow(/派生值超限/);
    expect(() => candidate.validate({ rules: [{ ...rules[0]!, assert: { all: [] } }] })).toThrow();
    expect(() => candidate.commit()).toThrow(/校验未完成/); expect(session.plan).toBe(initial);
  });
  it("rejects object operands without invoking their toString, and rejects ambiguous operands", () => {
    const object = { toString() { throw new Error("not allowed"); } };
    expect(compileReportPredicate({ field: "code", op: "<", right: { field: "other" }, valueType: "text" })({ code: "A", other: object })).toBe(false);
    expect(() => compileReportPredicate({ field: "code", op: "==", right: { field: "other", value: "A" } })).toThrow(/right/);
  });
});
