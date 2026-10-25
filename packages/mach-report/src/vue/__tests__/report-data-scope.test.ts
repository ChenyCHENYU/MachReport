// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createReportSource } from "../../source/report-source";
import { createTableTemplate } from "../../builder/table-template";
import { reportDataSnapshotFromPlan } from "../../editing/data-source";
import type { RenderPlan } from "../../schema/render-plan";
import { resolveReportReviewScope } from "../report-data-scope";
const template = createTableTemplate({ columns: [{ field: "id", header: "ID" }, { field: "value", header: "Value" }], listOptions: { rowKey: "id" } });
function raw(scopes: Array<string | undefined>): RenderPlan { return { schemaVersion: "test", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: scopes.map(sourceScope => ({ kind: "rect", leftMm: 0, topMm: 0, widthMm: 30, heightMm: 10, grid: { colWidthsMm: [30], cells: [[{ value: 1, source: { datasetId: "detail", sourceScope, rowKey: "A", field: "value" } }]] } })) }] }; }
describe("Vue review scope facade keeps exact core identity", () => {
  it("resolves default occurrence and explicit shared names from a real report source", async () => {
    for (const sourceScope of [undefined, "production"]) {
      const fetcher = createReportSource({ production: { sourceScope, template, datasets: { detail: [{ id: "A", value: 112.4 }] } } });
      const plan = await fetcher({ reportIds: ["production"], params: {} });
      const resolved = resolveReportReviewScope(plan, { sourceScope, datasetId: "detail" });
      expect(resolved).toBe(sourceScope === undefined ? '[0,"production"]' : '["shared","production"]');
      expect(reportDataSnapshotFromPlan(plan, { sourceScope: resolved, datasetId: "detail", fields: ["value"] }).rows[0]!.values.value).toBe(112.4);
      // The pure kernel never interprets an alias or relaxes source equality.
      expect(reportDataSnapshotFromPlan(plan, { sourceScope: "production", datasetId: "detail", fields: ["value"] }).rows).toEqual([]);
    }
  });
  it("retains exact literal and undefined scopes used by legacy raw plans", () => {
    expect(resolveReportReviewScope(raw(["literal"]), { sourceScope: "literal", datasetId: "detail" })).toBe("literal");
    expect(resolveReportReviewScope(raw([undefined]), { datasetId: "detail" })).toBeUndefined();
    expect(resolveReportReviewScope(raw(['["shared","production"]']), { sourceScope: '["shared","production"]', datasetId: "detail" })).toBe('["shared","production"]');
  });
  it("requires explicit unambiguous identity for multiple domains and refuses unknown datasets/scopes", () => {
    expect(() => resolveReportReviewScope(raw(["one", "two"]), { datasetId: "detail" })).toThrow("explicit sourceScope");
    expect(resolveReportReviewScope(raw(["one", "two"]), { sourceScope: "one", datasetId: "detail" })).toBe("one");
    expect(() => resolveReportReviewScope(raw(["production", '["shared","production"]']), { sourceScope: "production", datasetId: "detail" })).toThrow("one business source");
    expect(() => resolveReportReviewScope(raw(["other"]), { sourceScope: "production", datasetId: "detail" })).toThrow("one business source");
    expect(() => resolveReportReviewScope(raw(["one"]), { datasetId: "missing" })).toThrow("no business source");
    expect(() => resolveReportReviewScope(raw([]), { datasetId: "detail" })).toThrow("no business source");
    expect(() => resolveReportReviewScope(raw(["one"]), { datasetId: "detail", maxCells: 1 })).toThrow("budget");
  });
});
