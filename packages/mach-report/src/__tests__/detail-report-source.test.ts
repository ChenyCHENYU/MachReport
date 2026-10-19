import { describe, expect, it } from "vitest";
import { createReportSource } from "../source/report-source";
import { paginateTemplate, type DatasetRows, type ListComponent, type ReportTemplate } from "../layout/paginate";
import { validateRenderPlan } from "../schema/validate";
import { renderPlan } from "../render/dom";
import { getReportCellContext } from "../editing/context";
function fixture(header = true, label?: string): { template: ReportTemplate; datasets: DatasetRows } {
  const list: ListComponent = {
    kind: "list", dataset: "masters", rowKey: "id", leftMm: 5, topMm: 5, widthMm: 120,
    columns: [{ field: "id", header: "Master", widthMm: 60 }, { field: "value", header: "Value", widthMm: 60 }],
    detail: { dataset: "lines", parentKey: "id", foreignKey: "masterId", rowKey: "lineId", header, ...(label ? { label } : {}), columns: [{ field: "lineId", header: "Line", widthMm: 60 }, { field: "qty", header: "Qty", widthMm: 60, format: { kind: "number", digits: 3 }, editable: true }] }
  };
  return { template: { pages: [{ widthMm: 130, heightMm: 150, components: [list] }] }, datasets: {
    masters: [{ id: "M1", value: 10 }, { id: "M2", value: 20 }],
    lines: [{ lineId: "L1", masterId: "M1", qty: 0 }, { lineId: "L2", masterId: "M1", qty: 4 }, { lineId: "L3", masterId: "M2", qty: 2 }]
  } };
}
describe("validated master/detail report sources", () => {
  it("uses header index -1 and independent per-table content indices", () => {
    const { template, datasets } = fixture();
    const plan = paginateTemplate(template, datasets).plan;
    expect(validateRenderPlan(plan)).toMatchObject({ ok: true, errors: [] });
    const fragments = plan.pages.flatMap((page) => page.components).flatMap((component) => component.table ? [component.table] : []);
    expect(fragments.filter((table) => table.role === "header").map((table) => table.rowIndex)).toEqual([-1, -1, -1]);
    expect(fragments.filter((table) => table.source?.datasetId === "masters").map((table) => table.rowIndex)).toEqual([0, 1]);
    expect(fragments.filter((table) => table.source?.datasetId === "lines").map((table) => table.rowIndex)).toEqual([0, 1, 2]);
  });
  it("passes createReportSource validation and preserves DOM roles and edit identities", async () => {
    const { template, datasets } = fixture();
    const source = createReportSource({ report: { template, datasets, dataSchema: { masters: { rowKey: "id", fields: [{ field: "id", type: "text", required: true }] }, lines: { rowKey: "lineId", fields: [{ field: "lineId", type: "text", required: true }, { field: "masterId", type: "text", required: true }, { field: "qty", type: "number", required: true }] } } } });
    const plan = await source({ reportIds: ["report"], params: {} });
    expect(validateRenderPlan(plan).ok).toBe(true);
    const root = renderPlan(plan, document);
    expect([...root.querySelectorAll('[role="columnheader"]')].map((cell) => cell.textContent)).toEqual(["Master", "Value", "Line", "Qty", "Line", "Qty"]);
    expect([...root.querySelectorAll('[role="cell"]')].map((cell) => cell.textContent)).toContain("0.000");
    plan.pages.forEach((page, pageIndex) => page.components.forEach((component, componentIndex) => {
      const context = getReportCellContext(plan, { pageIndex, componentIndex, rowIndex: 0, columnIndex: 1 });
      if (component.table?.role === "header") { expect(context).toMatchObject({ editable: false, readOnlyReason: "structure", table: { rowIndex: -1, role: "header" } }); expect(context!.source).toBeUndefined(); }
      if (component.table?.source?.rowKey === "L1") expect(context).toMatchObject({ value: 0, editable: true, table: { rowIndex: 0, columnKey: "qty", role: "body" }, source: { datasetId: "lines", rowKey: "L1", field: "qty" } });
    }));
    expect(datasets.lines![0]!.qty).toBe(0);
  });
  it("keeps labeled and headerless child tables valid across page breaks", async () => {
    for (const header of [true, false]) {
      const { template, datasets } = fixture(header, "Detail lines");
      template.pages[0]!.heightMm = 40;
      const source = createReportSource({ report: { template, datasets } });
      const plan = await source({ reportIds: ["report"], params: {} });
      expect(plan.pages.length).toBeGreaterThan(1);
      expect(validateRenderPlan(plan).ok).toBe(true);
      const fragments = plan.pages.flatMap((page) => page.components).filter((component) => component.table?.columnKeys[0] === "lineId");
      const contents = fragments.filter((component) => component.table!.role !== "header");
      expect(contents.map((component) => component.table!.rowIndex)).toEqual([0, 1, 2, 3, 4]);
      expect(fragments.filter((component) => component.table!.role === "header")).toHaveLength(header ? 2 : 0);
    }
  });
});
