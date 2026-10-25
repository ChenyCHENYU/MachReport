// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { GridCell, RenderPlan } from "../../schema/render-plan";
import { applyReportCellEditBatch, createReportCellEditBatch } from "../batch";
import { reportDataSnapshotFromPlan } from "../data-source";
import { createReportPrefill, reportPrefillInputs, type ReportPrefillOptions } from "../prefill";

function plan(rows: Array<[string | number, Record<string, GridCell>]> = [["B", { qty: { value: 0, valueType: "number" }, note: { value: "", valueType: "text" } }], ["A", { qty: { value: null, valueType: "number" }, note: { value: "", valueType: "text" } }]]): RenderPlan {
  return { schemaVersion: "1", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: rows.map(([rowKey, values], rowIndex) => ({ kind: "rect", leftMm: 0, topMm: rowIndex * 10, widthMm: 80, heightMm: 10, grid: { colWidthsMm: Object.keys(values).map(() => 20), cells: [Object.entries(values).map(([field, cell]) => ({ text: "", ...cell, source: { sourceScope: "plant:YTS0", datasetId: "production", rowKey, field, revision: 3, sourceToken: "v3" } }))] } })) }] };
}
function options(): ReportPrefillOptions { return { sourceScope: "plant:YTS0", datasetId: "production", fields: [{ field: "qty", sourceField: "previousQty", label: "产量" }, { field: "note" }], rows: [{ rowKey: "A", values: { previousQty: "0", note: "new" } }, { rowKey: "B", values: { previousQty: 25, note: "from history" } }] }; }

describe("safe business-key prefill", () => {
  it("matches reordered records, respects an explicit whitelist and preserves real zero", () => {
    const source = plan(), review = createReportPrefill(source, options());
    expect(review.counts).toEqual({ changed: 3, matched: 0, skipped: 1, conflict: 0 });
    expect(review.items.find(item => item.source.rowKey === "B" && item.source.field === "qty")).toMatchObject({ reason: "occupied", before: 0 });
    const inputs = reportPrefillInputs(source, review), batch = createReportCellEditBatch(source, inputs, "prefill-1"), result = applyReportCellEditBatch(source, batch);
    expect(reportDataSnapshotFromPlan(result, { ...options(), fields: ["qty", "note"] }).rows).toEqual([{ rowKey: "B", values: { qty: 0, note: "from history" } }, { rowKey: "A", values: { qty: 0, note: "new" } }]);
    expect(source.pages[0]!.components[1]!.grid!.cells[0]![0]!.value).toBeNull();
  });
  it("never replaces false, whitespace, formulas, derived or protected cells by default", () => {
    const source = plan([["A", { flag: { value: false, valueType: "boolean" }, blank: { value: " " }, formula: { value: null, formula: "A1" }, protected: { value: null, editable: false }, derived: { value: null, derived: true } }]]);
    const review = createReportPrefill(source, { datasetId: "production", sourceScope: "plant:YTS0", fields: ["flag", "blank", "formula", "protected", "derived"].map(field => ({ field })), rows: [{ rowKey: "A", values: { flag: true, blank: "new", formula: 2, protected: 3, derived: 4 } }] });
    expect(review.edits).toHaveLength(0); // Derived cells deliberately have no source identity.
    expect(review.items.map(item => item.reason)).toEqual(["occupied", "occupied", "readonly", "readonly", "missing-target"]);
  });
  it("requires explicit replace mode and checks current edit permission again", () => {
    const source = plan(), config = { ...options(), mode: "replace" as const }, review = createReportPrefill(source, config);
    expect(review.counts.changed).toBe(4);
    expect(() => reportPrefillInputs(source, review, context => context.source?.field !== "qty")).toThrow("read-only");
    expect(createReportPrefill(source, { ...config, canEdit: () => false }).counts.skipped).toBe(4);
  });
  it("rejects every change if a value/token changes and relocates by identity after reorder", () => {
    const original = plan(), review = createReportPrefill(original, options());
    const reordered = { ...original, pages: [{ ...original.pages[0]!, components: [...original.pages[0]!.components].reverse() }] };
    expect(reportPrefillInputs(reordered, review)[0]!.address.componentIndex).toBe(0);
    reordered.pages[0]!.components[0]!.grid!.cells[0]![0]!.source!.sourceToken = "v4";
    expect(() => reportPrefillInputs(reordered, review)).toThrow("changed");
  });
  it("reports missing targets and invalid values, and blocks atomic apply with conflicts", () => {
    const source = plan(), review = createReportPrefill(source, { ...options(), rows: [{ rowKey: "A", values: { previousQty: "oops", note: "new" } }, { rowKey: "missing", values: { previousQty: 2 } }] });
    expect(review.items[0]).toMatchObject({ status: "conflict", reason: "invalid" });
    expect(review.items[2]).toMatchObject({ status: "skipped", reason: "missing-target" });
    expect(() => reportPrefillInputs(source, review)).toThrow("Resolve prefill conflicts");
  });
  it("skips empty sources, recognizes unchanged typed values and refuses inherited value containers", () => {
    const source = plan([["A", { qty: { value: 5, valueType: "number" }, note: { value: "" } }]]);
    const review = createReportPrefill(source, { ...options(), mode: "replace", rows: [{ rowKey: "A", values: { previousQty: "5", note: "" } }] });
    expect(review.counts).toMatchObject({ matched: 1, skipped: 1 });
    expect(review.items[1]!.reason).toBe("missing-source");
    const inherited = Object.create({ previousQty: 9 }) as Record<string, number>;
    expect(() => createReportPrefill(source, { ...options(), rows: [{ rowKey: "A", values: inherited }] })).toThrow("plain values");
  });
  it("detects inconsistent mirrored cells rather than picking a convenient copy", () => {
    const source = plan(), mirrored = structuredClone(source.pages[0]!.components[1]!);
    mirrored.grid!.cells[0]![0]!.value = 7;
    source.pages[0]!.components.push(mirrored);
    expect(createReportPrefill(source, options()).counts.conflict).toBe(1);
    expect(() => reportDataSnapshotFromPlan(source, { ...options(), fields: ["qty"] })).toThrow("disagree");
  });
  it("enforces source identity, duplicate keys, field allowlists and work budgets", () => {
    expect(() => createReportPrefill(plan(), { ...options(), fields: [] })).toThrow("allowlist");
    expect(() => createReportPrefill(plan(), { ...options(), rows: [...options().rows, options().rows[0]!] })).toThrow("Duplicate");
    expect(() => createReportPrefill(plan(), { ...options(), fields: [{ field: "qty" }, { field: "qty" }] })).toThrow("Duplicate");
    expect(() => createReportPrefill(plan(), { ...options(), maxChanges: 1 })).toThrow("budget");
    expect(() => createReportPrefill(plan(), { ...options(), maxCells: 1 })).toThrow("budget");
    expect(createReportPrefill(plan(), { ...options(), sourceScope: "other" }).counts.skipped).toBe(4);
    expect(createReportPrefill(plan(), { ...options(), fields: [{ field: "note" }], rows: [{ rowKey: "A", values: { note: 0 } }] }).edits[0]!.value).toBe("0");
  });
});
