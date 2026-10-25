// @vitest-environment node
import { describe, it, expect } from "vitest";
import { compileReportPredicate, reportPredicateFields, type ReportPredicate } from "../processing/predicate";
import { computeDataset, getComputationMetadata } from "../processing/computed";
import { expressionFields } from "../processing/expressions";
import { evalStyleRule } from "../format";
import { validateReportDataset, assertReportValidation, type ReportValidationRule } from "../editing/validation";
import { createReportEditSession } from "../editing/session";
import { createTableTemplate } from "../builder/table-template";
import { createReportCellEditBatch } from "../editing/batch";
import { getReportCellContext } from "../editing/context";
import type { RenderPlan } from "../schema/render-plan";
const predicate: ReportPredicate = { all: [{ field: "output", op: "<=", right: { field: "input" }, valueType: "decimal" }, { any: [{ field: "grade", op: "contains", value: "304" }, { not: { field: "exempt", op: "isNull" } }] }] };
const rules: ReportValidationRule[] = [{ id: "mass", field: "output", assert: { field: "output", op: "<=", right: { field: "input" }, valueType: "decimal" }, message: "出钢重不能超过投料重" }];
describe("shared declarative conditions", () => {
  it("shares bounded combination semantics across styles, field references and exact decimal values", () => {
    const row = { input: "9007199254740993.01", output: "9007199254740993.00", grade: "S304", exempt: null };
    expect(compileReportPredicate(predicate)(row)).toBe(true);
    expect(evalStyleRule(row, predicate)).toBe(true);
    expect(reportPredicateFields(predicate)).toEqual(["output", "input", "grade", "exempt"]);
    expect(compileReportPredicate(predicate)({ ...row, output: "9007199254740993.02" })).toBe(false);
  });
  it("keeps null, empty string and true zero distinct, with inclusive ranges and strict calendar days", () => {
    const read = (row: Record<string, unknown>, condition: ReportPredicate) => compileReportPredicate(condition)(row);
    expect(read({ value: 0 }, { field: "value", op: "==", value: 0 })).toBe(true);
    expect(read({ value: "" }, { field: "value", op: "==", value: 0 })).toBe(false);
    expect(read({ value: "" }, { field: "value", op: "isNull" })).toBe(false);
    expect(read({}, { field: "value", op: "isNull" })).toBe(true);
    expect(read({ day: "2024-02-29" }, { field: "day", op: "between", values: ["2024-02-01", "2024-02-29"], valueType: "date" })).toBe(true);
    expect(read({ day: "2023-02-29" }, { field: "day", op: "<=", value: "2023-03-01", valueType: "date" })).toBe(false);
    expect(read({ flag: "true" }, { field: "flag", op: "==", value: true, valueType: "boolean" })).toBe(false);
  });
  it("rejects ambiguous, malformed, prototype and excessive condition trees before evaluating", () => {
    expect(() => compileReportPredicate({ all: [] })).toThrow();
    expect(() => compileReportPredicate({ all: [{ field: "x", op: "isNull" }], field: "x" } as ReportPredicate)).toThrow();
    expect(() => compileReportPredicate({ field: "constructor", op: "isNull" })).toThrow();
    expect(() => compileReportPredicate({ field: "x", op: "between", values: [2, 1], numeric: "decimal" })).toThrow();
    expect(() => compileReportPredicate(Object.create({ field: "x", op: "isNull" }))).toThrow();
    let tree: ReportPredicate = { field: "x", op: "isNull" }; for (let i = 0; i < 17; i++) tree = { not: tree };
    expect(() => compileReportPredicate(tree)).toThrow(/预算/);
    expect(() => compileReportPredicate({ any: Array.from({ length: 256 }, () => ({ field: "x", op: "isNull" as const })) })).toThrow(/预算/);
    expect(() => compileReportPredicate({ field: "x", op: "==", right: { field: "y" }, value: 1 })).toThrow();
  });
});
describe("one expression compiler and function metadata", () => {
  it("evaluates IF lazily while reporting dependencies from its predicate and both branches", () => {
    const expression = { op: "if" as const, condition: { field: "qty", op: ">" as const, value: 0 }, args: [{ op: "divide" as const, args: [{ field: "amount" }, { field: "qty" }] }, { value: null }] };
    expect(expressionFields(expression)).toEqual(["amount", "qty"]);
    const rows = computeDataset([{ qty: 0, amount: 10 }, { qty: 2, amount: 10 }], { fields: [{ field: "unit", expression }] }).rows;
    expect(rows.map(row => row.unit)).toEqual([null, 5]);
    expect(() => computeDataset([{ qty: 0 }], { fields: [{ field: "x", expression: { op: "if", args: [{ value: 1 }, { value: 2 }] } }] })).toThrow();
  });
  it("prevents JavaScript metadata consumers from changing compiler operations or argument limits", () => {
    const metadata = getComputationMetadata();
    expect(Object.isFrozen(metadata.functions)).toBe(true);
    expect(metadata.functions.every(item => Object.isFrozen(item))).toBe(true);
    expect(Reflect.set(metadata.functions[0]!, "name", "unsafe")).toBe(false);
    expect(Reflect.set(metadata.functions[0]!, "minArgs", 0)).toBe(false);
    expect(Reflect.set(metadata.functions, "0", { name: "unsafe", minArgs: 0 })).toBe(false);
    metadata.operations.splice(0, metadata.operations.length);
    (metadata.aggregates as unknown as string[])[0] = "unsafe";
    expect(getComputationMetadata().operations).toContain("add");
    expect(getComputationMetadata().aggregates[0]).toBe("sum");
    expect(computeDataset([{}], { fields: [{ field: "value", expression: { op: "add", args: [{ value: 1 }, { value: 2 }] } }] }).rows[0]!.value).toBe(3);
    expect(() => computeDataset([{}], { fields: [{ field: "value", expression: { op: "add", args: [] } }] })).toThrow(/数量/);
  });
  it("rounds negative halves away from zero and preserves long decimal text; text/date functions remain explicit", () => {
    const fields = [
      { field: "rounded", numeric: "decimal" as const, expression: { op: "round" as const, args: [{ field: "amount" }, { value: 2 }] } },
      { field: "absolute", numeric: "decimal" as const, expression: { op: "abs" as const, args: [{ field: "amount" }] } },
      { field: "label", expression: { op: "upper" as const, args: [{ op: "trim" as const, args: [{ field: "name" }] }] } },
      { field: "month", expression: { op: "dateMonth" as const, args: [{ field: "date" }] } },
    ];
    expect(computeDataset([{ amount: "-9007199254740993.125", name: " ab ", date: "2024-02-29" }], { fields }).rows[0]).toMatchObject({ rounded: "-9007199254740993.13", absolute: "9007199254740993.125", label: "AB", month: 2 });
    const negative = computeDataset([{}], { fields: [{ field: "x", expression: { op: "round", args: [{ value: -1.25 }, { value: 1 }] } }] }).rows[0];
    expect(negative?.x).toBe(-1.3);
    expect(() => computeDataset([{}], { fields: [{ field: "x", expression: { op: "trim", args: [{ value: 1 }] } }] })).toThrow(/文本/);
    expect(getComputationMetadata().functions.every(fn => !!fn.example)).toBe(true);
    expect(getComputationMetadata().operations).toContain("if");
  });
});
describe("candidate validation", () => {
  it("returns every row issue with stable business key, field, severity and rule identity", () => {
    const issues = validateReportDataset([{ id: "a", input: "1", output: "2" }, { id: 0, input: "2", output: "3" }], { rules, rowKey: "id" });
    expect(issues).toMatchObject([{ ruleId: "mass", rowKey: "a", rowIndex: 0, field: "output", severity: "error" }, { ruleId: "mass", rowKey: 0, rowIndex: 1 }]);
    expect(() => assertReportValidation(issues)).toThrow(/出钢重/);
    const warnings = issues.map(issue => ({ ...issue, severity: "warning" as const }));
    expect(() => assertReportValidation(warnings)).not.toThrow(); expect(() => assertReportValidation(warnings, "block")).toThrow();
  });
  it("validates derived candidates and exact dataset summaries including empty count", () => {
    const issues = validateReportDataset([{ amount: 3 }, { amount: 4 }], { computed: [{ field: "double", expression: { op: "multiply", args: [{ field: "amount" }, { value: 2 }] } }], rules: [{ id: "derived", assert: { field: "double", op: "<", value: 7 }, message: "派生值超限" }, { id: "total", scope: "dataset", aggregates: [{ field: "total", valueField: "double", op: "sum" }], assert: { field: "total", op: "<=", value: 10 }, message: "合计超限" }] });
    expect(issues).toMatchObject([{ ruleId: "derived", rowIndex: 1 }, { ruleId: "total", rowIndex: undefined }]);
    expect(validateReportDataset([], { rules: [{ id: "count", scope: "dataset", aggregates: [{ field: "id", op: "count" }], assert: { field: "id", op: "==", value: 0 }, message: "数量" }] })).toEqual([]);
  });
  it("checks limits, cancellation, duplicate IDs, invalid severity and aggregate definitions", () => {
    expect(() => validateReportDataset([{}, {}], { rules, maxChecks: 1 })).toThrow(/预算/);
    expect(() => validateReportDataset([{ input: "1", output: "2" }, { input: "1", output: "2" }], { rules, maxIssues: 1 })).toThrow(/预算/);
    expect(() => validateReportDataset([], { rules: [...rules, ...rules] })).toThrow(/重复/);
    expect(() => validateReportDataset([], { rules: [{ ...rules[0]!, severity: "fatal" as "error" }] })).toThrow();
    expect(() => validateReportDataset([], { rules: [{ ...rules[0]!, aggregates: [] }] })).toThrow();
    const controller = new AbortController(); controller.abort(); expect(() => validateReportDataset([], { rules, signal: controller.signal })).toThrow(/取消/);
  });
  it("prepares simultaneous cross-field changes atomically and blocks invalid commit without changing the baseline", async () => {
    const template = createTableTemplate({ layout: "wide", columns: [{ field: "id", header: "ID" }, { field: "input", header: "入", valueType: "number" }, { field: "output", header: "出", valueType: "number" }, { field: "loss", header: "损耗" }], listOptions: { rowKey: "id", computed: [{ field: "loss", expression: { op: "subtract", args: [{ field: "input" }, { field: "output" }] } }] } });
    const session = createReportEditSession({ template, datasets: { detail: [{ id: "a", input: 2, output: 1 }] } });
    const initial = session.plan;
    function address(plan: RenderPlan, field: string) { for (const [pageIndex, page] of plan.pages.entries()) for (const [componentIndex, component] of page.components.entries()) if (component.table?.role === "body") return getReportCellContext(plan, { pageIndex, componentIndex, rowIndex: 0, columnIndex: component.table.columnKeys.indexOf(field) })!.address; throw new Error("missing"); }
    const valid = await session.prepare(initial, createReportCellEditBatch(initial, [{ address: address(initial, "input"), value: 4 }, { address: address(initial, "output"), value: 3 }], "valid"), { validation: { rules } });
    expect(valid.validationIssues).toEqual([]);
    const invalid = await session.prepare(initial, createReportCellEditBatch(initial, [{ address: address(initial, "output"), value: 5 }], "invalid"), { validation: { rules } });
    expect(invalid.validationIssues).toMatchObject([{ dataset: "detail", rowKey: "a" }]);
    expect(() => invalid.commit()).toThrow(/出钢重/); expect(session.plan).toBe(initial);
    const committed = valid.commit(); expect(session.plan).toBe(committed);
    const history = await session.prepareHistory(committed, createReportCellEditBatch(initial, [{ address: address(initial, "input"), value: 4 }, { address: address(initial, "output"), value: 3 }], "old").edits, "previousValue", "undo", { validation: { rules } });
    expect(history.prepared.validationIssues).toEqual([]); history.prepared.commit();
    expect(session.plan).not.toBe(initial);
  });
});
