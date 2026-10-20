// @vitest-environment node
import { describe, expect, it } from "vitest";
import { paginateTemplate, type ListComponent } from "../../index";
import { resolveListHeaderStyle, resolveListSampleCell } from "../../layout/list-cell";
describe("bounded canvas samples share output semantics", () => {
  it("matches real paginated cell text/value/alignment/style without traversing a full dataset", () => {
    const list: ListComponent = { kind: "list", dataset: "rows", leftMm: 0, topMm: 0, widthMm: 120, align: "auto", headerAlign: "right", headerStyle: { color: "#123456" }, columns: [
      { field: "id", header: "编号", widthMm: 30, semanticRole: "identifier" },
      { field: "qty", header: "重量", widthMm: 30, format: { kind: "number", digits: 3 }, rules: [{ when: { field: "qty", op: ">", value: 0 }, style: { color: "#b91c1c", bold: true } }] },
      { field: "hidden", header: "条件", widthMm: 30, editable: true, visibleWhen: { field: "qty", op: ">", value: 0 } },
      { field: "date", header: "日期", widthMm: 30, semanticRole: "date", headerAlign: "center" },
    ] };
    for (const row of [{ id: "0001", qty: 2, hidden: "A", date: "2026-10-20" }, { id: "0002", qty: 0, hidden: "B", date: null }]) {
      const plan = paginateTemplate({ pages: [{ widthMm: 120, heightMm: 297, components: [list] }] }, { rows: [row] });
      const body = plan.plan.pages.flatMap(page => page.components).find(item => item.table?.rowIndex === 0)!;
      expect(body.grid!.cells[0]).toEqual(list.columns.map(column => resolveListSampleCell(list, column, row)));
      const header = plan.plan.pages.flatMap(page => page.components).find(item => item.table?.rowIndex === -1)!;
      expect(header.grid!.cells[0]!.map(cell => cell?.style)).toEqual(list.columns.map(column => resolveListHeaderStyle(list, column)));
    }
  });
});
