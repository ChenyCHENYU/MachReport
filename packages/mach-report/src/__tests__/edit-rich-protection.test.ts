// @vitest-environment node
import { expect, it } from "vitest";
import { getReportCellContext } from "../editing/context";
import { createReportCellEditBatch } from "../editing/batch";
import type { GridCell, RenderPlan } from "../schema/render-plan";

const address = { pageIndex: 0, componentIndex: 0, rowIndex: 0, columnIndex: 0 };
function plan(cell: GridCell): RenderPlan {
  return { schemaVersion: "test", pages: [{ pageWidthMm: 210, pageHeightMm: 297, components: [{ kind: "text", leftMm: 0, topMm: 0, widthMm: 80, heightMm: 20, grid: { cells: [[cell]] } }] }] };
}
it.each([undefined, true])("protects styled cell content from stale rich runs after a plain-text edit (editable=%s)", editable => {
  const cell: GridCell = { text: "Value 42", value: "Value 42", ...(editable === undefined ? {} : { editable }), richParagraphs: [{ segments: [{ text: "Value " }, { text: "42", style: { bold: true } }] }] };
  const input = plan(cell);
  expect(getReportCellContext(input, address)).toMatchObject({ editable: false, readOnlyReason: "complex" });
  expect(() => createReportCellEditBatch(input, [{ address, value: "Changed" }], "request")).toThrow();
  expect(cell.text).toBe("Value 42"); expect(cell.richParagraphs![0]!.segments[1]!.text).toBe("42");
});
it("an empty rich paragraph collection retains normal scalar editing", () => {
  expect(getReportCellContext(plan({ text: "0", value: 0, richParagraphs: [] }), address)).toMatchObject({ editable: true, value: 0 });
});
