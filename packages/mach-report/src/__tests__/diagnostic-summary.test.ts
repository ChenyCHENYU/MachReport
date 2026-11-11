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
  it.each([0, 1, 3, 129, 200, undefined])("preserves folded code quotas across independent and repeated merges with limit %s", limit => {
    const source = createDiagnosticCollector<{ code: string }>(200);
    for (let index = 0; index < 128; index++) source.push({ code: `source-${index}` });
    source.push({ code: "overflow" });
    const destination = createDiagnosticCollector<{ code: string }>(limit);
    destination.push({ code: "overflow" });
    destination.merge(JSON.parse(JSON.stringify(source.snapshot())));
    const merged = destination.snapshot();
    expect(merged.total).toBe(130);
    expect(merged.counts.overflow).toBe(1);
    expect(Object.values(merged.counts).reduce((sum, count) => sum + count, 0)).toBe(130);
    expect(validDiagnosticSummary(merged)).toBe(true);
    const next = createDiagnosticCollector<{ code: string }>(limit);
    next.merge(JSON.parse(JSON.stringify(merged)));
    next.merge(JSON.parse(JSON.stringify(source.snapshot())));
    expect(next.snapshot().total).toBe(259);
    expect(next.snapshot().counts.overflow).toBe(1);
    expect(validDiagnosticSummary(next.snapshot())).toBe(true);
    expect(next.entries.length).toBe(Math.min(limit ?? Infinity, 259));
  });
  it("keeps representative slots stable when an earlier folded name later gains its own bucket", () => {
    const collector = createDiagnosticCollector<{ code: string }>(3);
    collector.merge({ total: 3, counts: { other: 3 }, entries: Array.from({ length: 3 }, () => ({ code: "folded" })), omitted: 0 });
    collector.push({ code: "folded" });
    collector.push({ code: "pdf-font" });
    expect(collector.entries.map(entry => entry.code)).toContain("pdf-font");
    expect(collector.snapshot()).toMatchObject({ total: 5, counts: { other: 3, folded: 1, "pdf-font": 1 }, omitted: 2 });
    expect(validDiagnosticSummary(collector.snapshot())).toBe(true);
  });
  it("accepts a genuine other code alongside folded names and keeps explanation quotas independent", () => {
    const source = createDiagnosticCollector<{ code: string; valueState?: string }>(200);
    for (let index = 0; index < 128; index++) source.push({ code: `source-${index}` });
    source.push({ code: "folded", valueState: "missing-source" });
    source.push({ code: "folded" });
    source.push({ code: "other", valueState: "missing-source" });
    const collector = createDiagnosticCollector<{ code: string; valueState?: string }>(200);
    collector.push({ code: "folded", valueState: "missing-source" });
    collector.push({ code: "folded" });
    collector.push({ code: "other" });
    collector.merge(JSON.parse(JSON.stringify(source.snapshot())));
    const merged = collector.snapshot();
    expect(merged).toMatchObject({ total: 134, counts: { folded: 2, other: 6 }, explanations: { total: 3, counts: { folded: 1, other: 2 } } });
    expect(merged.entries).toHaveLength(134);
    expect(validDiagnosticSummary(merged)).toBe(true);
    const next = createDiagnosticCollector<typeof merged.entries[number]>(200);
    next.merge(JSON.parse(JSON.stringify(merged)));
    expect(next.snapshot()).toEqual(merged);
    expect(validDiagnosticSummary(next.snapshot())).toBe(true);
  });
  it("never borrows folded custom quotas for safety-critical output codes or for the other channel", () => {
    expect(validDiagnosticSummary({ total: 3, counts: { "pdf-font": 1, other: 2 }, entries: [{ code: "pdf-font" }, { code: "pdf-font" }], omitted: 1 })).toBe(false);
    expect(validDiagnosticSummary({ total: 3, counts: { custom: 1, other: 2 }, entries: [{ code: "custom", valueState: "missing-source" }], omitted: 2 })).toBe(false);
    expect(validDiagnosticSummary({ total: 3, counts: { custom: 1, other: 2 }, explanations: { total: 3, counts: { custom: 1, other: 2 } }, entries: [{ code: "custom" }], omitted: 2 })).toBe(false);
  });
  it("round-trips mixed folded explanations and output diagnostics through bounded Worker errors", () => {
    type Entry = { code: string; severity: "info"; message: string; valueState?: "missing-source"; target?: { datasetId: string; field: string } };
    const entry = (code: string, explanation = false): Entry => ({ code, severity: "info", message: code,
      ...(explanation ? { valueState: "missing-source", target: { datasetId: "detail", field: "qty" } } : {}) });
    const source = createDiagnosticCollector<Entry>(200), collector = createDiagnosticCollector<Entry>(200);
    for (let index = 0; index < 128; index++) source.push(entry(`source-${index}`));
    source.push(entry("folded", true)); source.push(entry("folded"));
    collector.push(entry("folded", true)); collector.push(entry("folded"));
    collector.merge(source.snapshot());
    const original = collector.snapshot();
    const error = Object.assign(new Error("business diagnostics"), { diagnostics: original.entries, diagnosticSummary: original });
    const response = JSON.parse(JSON.stringify(serializeError(error))) as ReturnType<typeof serializeError>;
    expect(response.diagnosticSummary).toMatchObject({ total: 132, counts: original.counts, explanations: { total: 2 }, omitted: 0 });
    expect(response.diagnostics).toHaveLength(132);
    expect(validDiagnosticSummary(response.diagnosticSummary)).toBe(true);
    expect(new ReportWorkerError(response).diagnosticSummary?.explanations?.total).toBe(2);
  });
  it("does not turn malformed business markers into explanation counts while sanitizing legacy RPC errors", () => {
    const error = Object.assign(new Error("untrusted details"), { diagnostics: Array.from({ length: 250 }, () => ({ code: "source", message: "missing target", severity: "warning", valueState: "missing-source" })) });
    const response = serializeError(error);
    expect(response.diagnosticSummary).toMatchObject({ total: 250, omitted: 50 });
    expect(response.diagnosticSummary?.explanations).toBeUndefined();
    expect((response.diagnostics as object[]).every(entry => !("valueState" in entry))).toBe(true);
    expect(validDiagnosticSummary(response.diagnosticSummary)).toBe(true);
  });
});
