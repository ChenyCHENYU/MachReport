// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { inspectOutputCapabilities, inspectOutputCapabilitiesSummary, OutputFidelityError, reportOutputDiagnostics, type OutputDiagnostic } from "../output/capabilities";
import { createDiagnosticCollector, validDiagnosticSummary } from "../output/diagnostic-collector";
import { resolvePlanAssets } from "../output/assets";
import { ReportWorkerError, serializeError } from "../worker/protocol";
import type { RenderPlan } from "../schema/render-plan";

function styledPlan(rows: number, columns: number): RenderPlan {
  // Shared immutable fixture cells keep the test itself small; each logical location is still visited.
  const cell = { text: "1", style: { letterSpacing: 0.2 } };
  return { schemaVersion: "diagnostic-test", pages: [{ pageWidthMm: 1000, pageHeightMm: 40000, components: [{
    kind: "rect", leftMm: 0, topMm: 0, widthMm: 1000, heightMm: 40000,
    grid: { cells: Array.from({ length: rows }, () => Array(columns).fill(cell)) }
  }] }] };
}

describe("bounded output diagnostics", () => {
  it("counts 164000 issues while retaining 200 exact locations", () => {
    const value = inspectOutputCapabilitiesSummary(styledPlan(2000, 82), "xlsx");
    expect(value).toMatchObject({ total: 164000, counts: { "unsupported-style": 164000 }, omitted: 163800 });
    expect(value.entries).toHaveLength(200);
    expect(value.entries[199]!.componentPath).toEqual([2, 35]);
    expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThan(60000);
    expect(validDiagnosticSummary(value)).toBe(true);
  });
  it("validates an explicit limit even when no asset adapters are configured", async () => {
    await expect(resolvePlanAssets(styledPlan(1, 1), { diagnosticLimit: -1 })).rejects.toThrow("diagnosticLimit");
    expect((await resolvePlanAssets(styledPlan(1, 1), { diagnosticLimit: 0 })).diagnosticSummary).toMatchObject({ total: 0, omitted: 0, entries: [] });
  });
  it("retains the full existing inspection and callback arrays by default", () => {
    const plan = styledPlan(3, 3), callback = vi.fn();
    expect(inspectOutputCapabilities(plan, "xlsx")).toHaveLength(9);
    expect(reportOutputDiagnostics(plan, "xlsx", { onDiagnostic: callback })).toHaveLength(9);
    expect(callback).toHaveBeenCalledTimes(9);
    expect(inspectOutputCapabilitiesSummary(plan, "dom")).toMatchObject({ total: 0, entries: [], omitted: 0 });
  });
  it("rejects strict output even with zero samples and keeps exact totals in RPC errors", () => {
    let failure: OutputFidelityError | undefined;
    try { reportOutputDiagnostics(styledPlan(2000, 82), "xlsx", { fidelity: "strict", diagnosticLimit: 0 }); }
    catch (error) { failure = error as OutputFidelityError; }
    expect(failure).toBeInstanceOf(OutputFidelityError);
    expect(failure!.message).toContain("164000");
    expect(failure!.diagnostics).toEqual([]);
    const serialized = serializeError(failure);
    expect(serialized.diagnosticSummary).toMatchObject({ total: 164000, omitted: 164000, entries: [] });
    expect(new ReportWorkerError(serialized).diagnosticSummary?.total).toBe(164000);
  });
  it("respects observer cancellation and scans before notifying mutable observers", () => {
    const plan = styledPlan(1, 3), controller = new AbortController();
    const callback = vi.fn(() => { controller.abort(); });
    expect(() => reportOutputDiagnostics(plan, "xlsx", { diagnosticLimit: 2, signal: controller.signal, onDiagnostic: callback })).toThrow();
    expect(callback).toHaveBeenCalledOnce();
    const result = reportOutputDiagnostics(plan, "xlsx", { onDiagnostic: () => { plan.pages[0]!.components[0]!.grid!.cells.length = 0; } });
    expect(result).toHaveLength(3);
  });
  it("preserves category representatives when a later issue arrives after the sample window fills", () => {
    const collector = createDiagnosticCollector<{ code: string; message: string }>(2);
    collector.push({ code: "a", message: "first" }); collector.push({ code: "a", message: "second" });
    collector.push({ code: "b", message: "important later category" }); collector.push({ code: "c", message: "no free category slot" });
    expect(collector.snapshot()).toMatchObject({ total: 4, counts: { a: 2, b: 1, c: 1 }, omitted: 2 });
    expect(collector.entries.map(entry => entry.code)).toEqual(["a", "b"]);
    const combined = createDiagnosticCollector<{ code: string; message: string }>(1);
    combined.merge(collector.snapshot());
    expect(combined.snapshot()).toMatchObject({ total: 4, omitted: 3, counts: { a: 2, b: 1, c: 1 } });
  });
  it("bounds arbitrary code buckets and rejects inconsistent summaries or limits", () => {
    const collector = createDiagnosticCollector<{ code: string }>(200);
    for (let index = 0; index < 300; index++) collector.push({ code: `code-${index}` });
    collector.push({ code: "x".repeat(1000) });
    const summary = collector.snapshot();
    expect(Object.keys(summary.counts)).toHaveLength(129);
    expect(summary.counts.other).toBe(173);
    expect(validDiagnosticSummary(summary)).toBe(true);
    collector.push({ code: "asset-render-failed" });
    expect(collector.snapshot().counts["asset-render-failed"]).toBe(1);
    const reserved = createDiagnosticCollector<{ code: string }>(3);
    for (const code of ["__proto__", "prototype", "constructor"]) reserved.push({ code });
    expect(reserved.snapshot().counts).toEqual({ other: 3 });
    expect(validDiagnosticSummary(reserved.snapshot())).toBe(true);
    for (const value of [-1, 0.5, 1001, NaN]) expect(() => createDiagnosticCollector(value)).toThrow(RangeError);
    for (const value of [null, [], {}, { ...summary, total: -1 }, { ...summary, omitted: 0 }, { ...summary, counts: [] }, { ...summary, counts: { a: 301 } }, { ...summary, entries: Array(1001).fill({ code: "other" }), total: 1001, omitted: 0, counts: { other: 1001 } }]) expect(validDiagnosticSummary(value)).toBe(false);
  });
  it("bounds old full-detail RPC errors and serializes only the retained detail window", () => {
    const entry: OutputDiagnostic = { code: "unsupported-style", message: "style", severity: "warning", format: "xlsx", pageIndex: 0, componentIndex: 0, componentPath: [0, 0], kind: "rect" };
    const error = new OutputFidelityError(Array(164000).fill(entry));
    const result = serializeError(error);
    expect(result.diagnosticSummary).toMatchObject({ total: 164000, omitted: 163800 });
    expect(result.diagnostics).toHaveLength(200);
    expect(JSON.stringify(result).length).toBeLessThan(100000);
    const details = new Error("x".repeat(20000)) as Error & { issues: unknown[] };
    details.issues = Array(1000).fill({ code: "invalid", path: "p", message: "m".repeat(10000) });
    const issues = serializeError(details);
    expect(issues.message).toHaveLength(8192);
    expect(issues.issueSummary).toMatchObject({ total: 1000, omitted: 800 });
    expect((issues.issues as Array<{ message: string }>)[0]!.message).toHaveLength(4096);
    expect(serializeError("bad")).toEqual({ name: "Error", message: "bad" });
    expect(serializeError(Object.assign(new Error("primitive issues"), { issues: ["plain"] })).issues).toEqual([{ message: "plain" }]);
  });
});
