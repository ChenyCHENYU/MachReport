// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { applyReportCellEditBatch, createReportCellEditBatch, formatReportClipboard, getReportCellContext, parseReportClipboard, summarizeReportCellEdits, type RenderPlan } from "../index";
import * as geometry from "../render/grid-geometry";

function plan(): RenderPlan {
  return { schemaVersion: "test", pages: [{ pageWidthMm: 200, pageHeightMm: 100, components: [{ kind: "rect", leftMm: 0, topMm: 0, widthMm: 100, heightMm: 10, table: { id: "orders", rowIndex: 0, role: "body", columnKeys: ["quantity", "code"], source: { datasetId: "orders", rowKey: "ID-0001", revision: 4, sourceToken: "token-4" } }, grid: { cells: [[{ value: 2, text: "2", valueType: "number" }, { value: "001", text: "001" }]] } }] }] };
}
const address = (columnIndex = 0) => ({ pageIndex: 0, componentIndex: 0, rowIndex: 0, columnIndex });
describe("atomic edit contracts", () => {
  it("preserves stable business identity and exact source tokens without inventing keys", () => {
    const input = plan();
    expect(getReportCellContext(input, address())?.source).toEqual({ datasetId: "orders", rowKey: "ID-0001", field: "quantity", revision: 4, sourceToken: "token-4" });
    const batch = createReportCellEditBatch(input, [{ address: address(), value: 3 }], "request-1");
    expect(batch.edits[0]?.source?.rowKey).toBe("ID-0001");
    expect(batch.requestId).toBe("request-1");
    delete input.pages[0]!.components[0]!.table!.source;
    expect(getReportCellContext(input, address())?.source).toBeUndefined();
  });
  it("does not expose partial application when a later patch conflicts", () => {
    const original = plan();
    const batch = createReportCellEditBatch(original, [{ address: address(), value: 3 }, { address: address(1), value: "002" }], "request-2");
    batch.edits[1]!.previousValue = "stale";
    expect(() => applyReportCellEditBatch(original, batch)).toThrow(/conflict/);
    expect(getReportCellContext(original, address())?.value).toBe(2);
    expect(() => createReportCellEditBatch(original, [{ address: address(), value: 3 }, { address: address(), value: 4 }], "request-3")).toThrow(/duplicate/);
  });
  it("summarizes net changes and restores the original value", () => {
    const original = plan();
    const first = createReportCellEditBatch(original, [{ address: address(), value: 3 }], "first");
    const second = createReportCellEditBatch(applyReportCellEditBatch(original, first), [{ address: address(), value: 2 }], "second");
    expect(summarizeReportCellEdits([...first.edits, ...second.edits])).toEqual([]);
  });
  it("rejects stale business revision/token metadata even when the displayed value is unchanged", () => {
    const original = plan();
    const batch = createReportCellEditBatch(original, [{ address: address(), value: 3 }], "source-conflict");
    original.pages[0]!.components[0]!.table!.source!.revision = 5;
    expect(() => applyReportCellEditBatch(original, batch)).toThrow(/conflict/);
    expect(getReportCellContext(original, address())?.value).toBe(2);
  });
  it("roundtrips quoted tabs, newlines, quotes and empty values in bounded TSV", () => {
    const rows = [["001", "two\tcolumns", "line\nbreak", 'say "yes"'], ["", "0", "", ""]];
    expect(parseReportClipboard(formatReportClipboard(rows))).toEqual(rows);
    expect(parseReportClipboard("A\tB\r\n")).toEqual([["A", "B"]]);
    expect(() => parseReportClipboard('"open')).toThrow(/Unclosed/);
    expect(() => parseReportClipboard("1\t2", 1)).toThrow(/limit/);
  });
  it("indexes a large pasted grid once per phase instead of reparsing geometry for each cell", () => {
    const original = plan();
    const grid = original.pages[0]!.components[0]!.grid!;
    delete original.pages[0]!.components[0]!.table;
    grid.cells = Array.from({ length: 80 }, () => Array.from({ length: 80 }, () => ({ value: 1, text: "1", valueType: "number" })));
    const spy = vi.spyOn(geometry, "resolveGridLayout");
    try {
      const inputs = grid.cells.flatMap((row, rowIndex) => row.map((_cell, columnIndex) => ({ address: { ...address(columnIndex), rowIndex }, value: 2 })));
      const batch = createReportCellEditBatch(original, inputs, "large");
      const next = applyReportCellEditBatch(original, batch);
      expect(spy.mock.calls.length).toBeLessThanOrEqual(4);
      expect(next.pages[0]!.components[0]!.grid!.cells[79]![79]!.value).toBe(2);
      expect(grid.cells[79]![79]!.value).toBe(1);
    } finally { spy.mockRestore(); }
  });
  it("keeps null placeholders uneditable and updates the correct compact index after merges", () => {
    const original = plan();
    delete original.pages[0]!.components[0]!.table;
    original.pages[0]!.components[0]!.grid = { colWidthsMm: [25, 25, 25, 25], cells: [[{ text: "merged", colSpan: 2 }, null, { text: "editable" }]] };
    expect(() => createReportCellEditBatch(original, [{ address: address(2), value: "no" }], "null")).toThrow(/missing/);
    const batch = createReportCellEditBatch(original, [{ address: address(3), value: "updated" }], "merge");
    const next = applyReportCellEditBatch(original, batch);
    expect(next.pages[0]!.components[0]!.grid!.cells[0]).toEqual([{ text: "merged", colSpan: 2 }, null, { text: "updated", rawText: "updated", value: "updated" }]);
  });
});
