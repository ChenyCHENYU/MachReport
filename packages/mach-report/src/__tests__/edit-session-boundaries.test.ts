// @vitest-environment node
import { expect, it } from "vitest";
import { createTableTemplate } from "../builder/table-template";
import { createReportEditSession } from "../editing/session";
import { createReportCellEditBatch } from "../editing/batch";
import { getReportCellContext } from "../editing/context";
import type { RenderPlan } from "../schema/render-plan";
function context(plan: RenderPlan, columnIndex = 0) {
  const componentIndex = plan.pages[0]!.components.findIndex(component => component.table?.role === "body");
  return getReportCellContext(plan, { pageIndex: 0, componentIndex, rowIndex: 0, columnIndex })!;
}
it("preserves returned revision metadata without template revision fields", async () => {
  const session = createReportEditSession({ template: createTableTemplate({ columns: [{ field: "qty", header: "Qty", valueType: "number" }], listOptions: { rowKey: "id" } }), datasets: { detail: [{ id: "001", qty: 2 }] } });
  const change = (plan: RenderPlan, value: number) => createReportCellEditBatch(plan, [{ address: context(plan).address, value }], "x");
  const first = (await session.prepare(session.plan, change(session.plan, 5))).commit({ revision: "2", sourceToken: "t2" });
  expect(context(first).source).toMatchObject({ revision: "2", sourceToken: "t2" });
  const second = (await session.prepare(first, change(first, 6))).commit();
  expect(context(second).source).toMatchObject({ revision: "2", sourceToken: "t2" });
});
it("does not silently lose existing nonenumerable fields on the first unrelated edit", async () => {
  const row = { id: "001", qty: 2 };
  Object.defineProperty(row, "price", { value: 10, enumerable: false, writable: true });
  expect(() => createReportEditSession({ template: createTableTemplate({ columns: [{ field: "qty", header: "Qty", valueType: "number" }, { field: "price", header: "Price", valueType: "number" }], listOptions: { rowKey: "id" } }), datasets: { detail: [row] } })).toThrow("conflict");
});
