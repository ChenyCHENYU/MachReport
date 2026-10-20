// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTableTemplate } from "../builder/table-template";
import { paginateTemplate, type ListComponent, type ReportTemplate } from "../layout/paginate";
import { createReportCellEdit } from "../editing/apply";
import { getReportCellContext } from "../editing/context";
import { validateRenderPlan } from "../schema/validate";
import { validateReportTemplate } from "../source/template-registry";

function masterList(detail: Partial<NonNullable<ListComponent["detail"]>> = {}): ListComponent {
  return { kind: "list", dataset: "masters", rowKey: "id", revisionField: "rev", sourceTokenField: "token", leftMm: 5, topMm: 5, widthMm: 120,
    columns: [{ field: "id", header: "ID", widthMm: 60 }, { field: "value", header: "Value", widthMm: 60 }],
    detail: { dataset: "lines", parentKey: "id", foreignKey: "masterId", rowKey: "lineId", columns: [{ field: "lineId", header: "Line", widthMm: 60 }, { field: "qty", header: "Qty", widthMm: 60 }], ...detail } };
}
const template = (list: ListComponent): ReportTemplate => ({ pages: [{ widthMm: 130, heightMm: 150, components: [list] }] });
const masters = [{ id: "M1", value: 1, rev: "master-r1", token: "master-t1" }];
const goodChild = { lineId: "L1", masterId: "M1", qty: 1 };

describe("report correctness closure", () => {
  it("protects computed fields even when explicitly editable and overwriting a source field", () => {
    const source = createTableTemplate({ columns: [{ field: "id", header: "ID" }, { field: "qty", header: "Qty" }, { field: "amount", header: "Amount", editable: true }], listOptions: { rowKey: "id", computed: [{ field: "amount", expression: { op: "multiply", args: [{ field: "qty" }, { value: 3 }] } }] } });
    const plan = paginateTemplate(source, { detail: [{ id: "001", qty: 2, amount: 777 }] }).plan;
    const componentIndex = plan.pages[0]!.components.findIndex((component) => component.table?.role === "body");
    const address = { pageIndex: 0, componentIndex, rowIndex: 0, columnIndex: 2 };
    const context = getReportCellContext(plan, address)!;
    expect(context.value).toBe(6); expect(context.editable).toBe(false); expect(context.readOnlyReason).toBe("derived"); expect(context.source).toBeUndefined();
    expect(() => createReportCellEdit(plan, address, 999)).toThrow("readonly");
    expect(getReportCellContext(plan, { ...address, columnIndex: 1 })?.source).toEqual({ datasetId: "detail", rowKey: "001", field: "qty" });
    const reloaded = JSON.parse(JSON.stringify(plan));
    expect(getReportCellContext(reloaded, address)?.source).toBeUndefined(); expect(validateRenderPlan(reloaded).ok).toBe(true);
  });

  it("preserves the source business identity when a calculated display column replaces the key", () => {
    const source = createTableTemplate({ columns: [{ field: "id", header: "ID" }, { field: "qty", header: "Qty" }], listOptions: { rowKey: "id", computed: [{ field: "id", expression: { value: "display-only" } }] } });
    const plan = paginateTemplate(source, { detail: [{ id: "001", qty: 2 }, { id: "002", qty: 3 }] }).plan;
    const bodies = plan.pages.flatMap((page) => page.components).filter((component) => component.table?.role === "body");
    expect(bodies.map((component) => component.table?.source?.rowKey)).toEqual(["001", "002"]);
    expect(bodies[0]!.grid!.cells[0]![0]?.derived).toBe(true);
  });

  it("keeps all first-column subtotal and grand-total values with a separate label row", async () => {
    const source = createTableTemplate({ layout: "wide", columns: [{ field: "qty", header: "Qty" }], listOptions: { groupBy: { field: "group", subtotal: ["qty"] }, grandTotal: { fields: ["qty"] } } });
    const plan = paginateTemplate(source, { detail: [{ group: "A", qty: 2 }, { group: "A", qty: 3 }, { group: "B", qty: 0 }] }).plan;
    const summaries = plan.pages.flatMap((page) => page.components).filter((component) => ["subtotal", "grand-total"].includes(component.table?.role ?? ""));
    expect(summaries.map((component) => component.grid!.cells[1]![0]?.value)).toEqual([5, 0, 5]);
    expect(summaries.map((component) => component.grid!.cells[0]![0]?.text)).toEqual(["小计", "小计", "合计"]);
    expect(validateRenderPlan(plan).ok).toBe(true);
    const { renderPlanToXlsx } = await import("../xlsx/render-xlsx");
    const output = await renderPlanToXlsx(plan, { sheetMode: "continuous", valueMode: "raw" });
    expect(output.warnings).toEqual([]);
    const values: unknown[] = []; output.workbook.worksheets[0]!.eachRow((row) => values.push(row.getCell(1).value));
    expect(values.slice(-2)).toEqual(["合计", 5]);
  });

  it("ignores unassociated child rows before validating child source identities", () => {
    const source = template(masterList({ unmatched: "ignore" }));
    const plan = paginateTemplate(source, { masters, lines: [goodChild, { masterId: "M2", qty: 2 }, { masterId: null, qty: 3 }, { lineId: "L1", masterId: "M2", qty: 4 }] }).plan;
    expect(plan.pages.flatMap((page) => page.components).filter((component) => component.table?.source?.datasetId === "lines")).toHaveLength(1);
    expect(() => paginateTemplate(source, { masters, lines: [goodChild, { ...goodChild }] })).toThrow("业务主键重复");
    expect(() => paginateTemplate(source, { masters, lines: [{ ...goodChild, lineId: " " }] })).toThrow("稳定");
    expect(() => paginateTemplate(template(masterList()), { masters, lines: [{ masterId: "M2" }] })).toThrow("未关联");
  });

  it("uses the child's explicit concurrency fields and never inherits the parent's", () => {
    const children = [{ ...goodChild, rev: "unrelated", token: "unrelated", lineRev: "child-r1", lineToken: "child-t1" }];
    const childSource = (list: ListComponent) => paginateTemplate(template(list), { masters, lines: children }).plan.pages.flatMap((page) => page.components).find((component) => component.table?.source?.datasetId === "lines")!.table!.source;
    expect(childSource(masterList())).toEqual({ datasetId: "lines", rowKey: "L1" });
    const explicit = masterList({ revisionField: "lineRev", sourceTokenField: "lineToken" });
    expect(childSource(explicit)).toEqual({ datasetId: "lines", rowKey: "L1", revision: "child-r1", sourceToken: "child-t1" });
    expect(validateReportTemplate(template(explicit)).ok).toBe(true);
    expect(validateReportTemplate(template(masterList({ revisionField: "" }))).errors).toContainEqual(expect.objectContaining({ path: "$.pages.0.components.0.detail.revisionField" }));
  });
});
