// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { Workbook } from "exceljs";
import { createTemplate } from "../builder/template-builder";
import { createTableTemplate } from "../builder/table-template";
import { createReportRuntime } from "../server/runtime";
import { createReportGenerationService } from "../server/generation";
import { createMemoryReportInstanceStore } from "../server/instance-store";
import { runReportWorkerRequest, REPORT_WORKER_PROTOCOL } from "../worker/protocol";

function setup() {
  let value = "FIRST";
  const query = vi.fn(async () => ({ datasets: { rows: [{ value }] }, revision: value }));
  const template = createTemplate().page(80, 55).list("rows", { leftMm: 4, topMm: 5, widthMm: 70 }, [{ field: "value", header: "Value", widthMm: 70 }]).build();
  const reports = { report: { template, provider: { query } } };
  return { runtime: createReportRuntime({ reports }), reports, query, change: () => { value = "SECOND"; } };
}
describe("prepared and saved-instance output", () => {
  it("exports the exact prepared data and revisions to real PDF/XLSX without querying again", async () => {
    const { runtime, query, change } = setup();
    const prepared = await runtime.prepare({ reportIds: ["report"] });
    const original = JSON.stringify(prepared); change();
    const events: string[] = [];
    const pdf = await runtime.exportPrepared({ prepared, format: "pdf", onEvent: event => events.push(event.stage) });
    const xlsx = await runtime.exportPrepared({ prepared, format: "xlsx" });
    expect((await PDFDocument.load(pdf.bytes)).getPages()[0]!.getWidth()).toBeCloseTo(80 * 72 / 25.4, 6);
    const workbook = new Workbook(); await workbook.xlsx.load(xlsx.bytes as never);
    const values: unknown[] = [];
    workbook.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => values.push(cell.value))));
    expect(values).toContain("FIRST"); expect(values).not.toContain("SECOND");
    expect(query).toHaveBeenCalledTimes(1);
    expect(pdf.revisions.report?.revision).toBe("FIRST");
    expect(events).toContain("encode"); expect(events).not.toContain("query");
    expect(JSON.stringify(prepared)).toBe(original);
    await runtime.export({ reportIds: ["report"], format: "pdf" });
    expect(query).toHaveBeenCalledTimes(2);
  });
  it("snapshots before async encoding so later UI edits cannot alter the output", async () => {
    const { runtime } = setup(), prepared = await runtime.prepare({ reportIds: ["report"] });
    const pending = runtime.exportPrepared({ prepared, format: "xlsx" });
    prepared.plan.pages[0]!.components = [];
    const result = await pending;
    expect(result.stats.cells).toBe(2);
  });
  it("captures Excel options before an async boundary for both prepared and live exports", async () => {
    const template = createTableTemplate({ columns: [{ field: "weight", header: "Weight", format: { kind: "number", digits: 2 } }] });
    const runtime = createReportRuntime({ reports: { report: { template, datasets: { detail: [{ weight: 10 }] } } } });
    const prepared = await runtime.prepare({ reportIds: ["report"] });
    for (const mode of ["prepared", "live"]) {
      const xlsx: { valueMode: "raw" | "text" } = { valueMode: "raw" };
      const pending = mode === "prepared"
        ? runtime.exportPrepared({ prepared, format: "xlsx", xlsx })
        : runtime.export({ reportIds: ["report"], format: "xlsx", xlsx });
      xlsx.valueMode = "text";
      const workbook = new Workbook(); await workbook.xlsx.load((await pending).bytes as never);
      const values: unknown[] = [];
      workbook.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => values.push(cell.value))));
      expect(values).toContain(10); expect(values).not.toContain("10.00");
    }
  });
  it("uses the same font metrics at prepare/export and rejects mismatches in strict mode", async () => {
    const { runtime } = setup();
    const bytes = readFileSync(new URL("../../../../examples/minimal/public/fonts/mach-report-demo.otf", import.meta.url));
    const pdf = { customFontBytes: bytes };
    const prepared = await runtime.prepare({ reportIds: ["report"], pdf });
    expect(prepared.layout).toMatchObject({ textMetrics: "font-bytes", fontFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const result = await runtime.exportPrepared({ prepared, format: "pdf", pdf, fidelity: "strict" });
    expect(result.diagnostics.some(item => item.code === "prepared-font-metrics")).toBe(false);
    await expect(runtime.exportPrepared({ prepared, format: "pdf", fidelity: "strict" })).rejects.toMatchObject({ code: "validate" });
    const legacy = { ...prepared, layout: undefined };
    const warned = await runtime.exportPrepared({ prepared: legacy, format: "pdf", pdf });
    expect(warned.diagnostics.some(item => item.code === "prepared-font-metrics")).toBe(true);
  });
  it("enforces actual geometry/output/snapshot budgets and rejects accessors without running them", async () => {
    const { runtime, reports } = setup(), prepared = await runtime.prepare({ reportIds: ["report"] });
    prepared.stats.cells = 0;
    await expect(createReportRuntime({ reports, budget: { maxCells: 1 } }).exportPrepared({ prepared, format: "pdf" })).rejects.toMatchObject({ code: "budget", path: "$.budget.maxCells" });
    await expect(createReportRuntime({ reports, budget: { maxOutputBytes: 10 } }).exportPrepared({ prepared, format: "pdf" })).rejects.toMatchObject({ code: "budget", path: "$.budget.maxOutputBytes" });
    await expect(createReportRuntime({ reports, budget: { maxPreparedBytes: 10 } }).exportPrepared({ prepared, format: "pdf" })).rejects.toMatchObject({ code: "budget", path: "$.budget.maxPreparedBytes" });
    const getter = vi.fn(() => "malicious"); Object.defineProperty(prepared.plan.pages[0]!, "meta", { get: getter, enumerable: true });
    await expect(runtime.exportPrepared({ prepared, format: "pdf" })).rejects.toMatchObject({ code: "validate" }); expect(getter).not.toHaveBeenCalled();
  });
  it("supports cancellation and explicitly rejects an old custom executor", async () => {
    const { runtime, reports } = setup(), prepared = await runtime.prepare({ reportIds: ["report"] });
    const controller = new AbortController(); controller.abort();
    await expect(runtime.exportPrepared({ prepared, format: "pdf", signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    const old = createReportRuntime({ reports, executor: { prepare: input => runtime.prepare(input), export: input => runtime.export(input) } });
    await expect(old.exportPrepared({ prepared, format: "pdf" })).rejects.toThrow("未实现 exportPrepared");
  });
  it("rejects malformed optional business explanations before encoding a manually supplied plan", async () => {
    const { runtime } = setup(), prepared = await runtime.prepare({ reportIds: ["report"] });
    prepared.diagnostics.push({ code: "business", severity: "info", message: "No source", valueState: "missing-source" });
    await expect(runtime.exportPrepared({ prepared, format: "xlsx" })).rejects.toMatchObject({ code: "validate", message: "准备结果诊断无效" });
    prepared.diagnostics[0]!.target = { datasetId: "rows", field: "value", rowKey: "0001" };
    expect((await runtime.exportPrepared({ prepared, format: "xlsx" })).bytes[0]).toBe(0x50);
  });
  it("the additive Worker operation encodes without report registration or query and validates its format", async () => {
    const { runtime, query } = setup(), prepared = await runtime.prepare({ reportIds: ["report"] });
    const worker = createReportRuntime({ reports: {} });
    const response = await runReportWorkerRequest(worker, { protocol: REPORT_WORKER_PROTOCOL, id: "prepared", operation: "exportPrepared", input: { prepared, format: "pdf" } });
    expect(response.error).toBeUndefined(); expect(response.result).toHaveProperty("contentType", "application/pdf");
    expect(query).toHaveBeenCalledTimes(1);
  });
  it("generation saves output metadata and saved revision export stays independent of live values", async () => {
    const { runtime, query, change } = setup();
    const service = createReportGenerationService({ runtime, instances: createMemoryReportInstanceStore(), templateRevisions: { report: "v1" } });
    const instance = await service.generate({ scope: "demo", id: "one", title: "Saved", reportIds: ["report"], expectedRevision: null });
    change();
    const file = await service.exportInstance({ scope: "demo", id: "one", revision: instance.revision, format: "xlsx" });
    expect(file.stats.rows).toBe(1); expect(file.revisions.report?.revision).toBe("FIRST"); expect(query).toHaveBeenCalledTimes(1);
    expect(instance.output?.layout).toMatchObject({ textMetrics: "heuristic" });
  });
  it("captures instance output format/options/signal before waiting for storage", async () => {
    const template = createTableTemplate({ columns: [{ field: "weight", header: "Weight", format: { kind: "number", digits: 2 } }] });
    const runtime = createReportRuntime({ reports: { report: { template, datasets: { detail: [{ weight: 10 }] } } } });
    const store = createMemoryReportInstanceStore();
    let delay = false, release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const instances = { ...store, read: async (...args: Parameters<typeof store.read>) => { const value = await store.read(...args); if (delay) await gate; return value; } };
    const service = createReportGenerationService({ runtime, instances, templateRevisions: { report: "v1" } });
    await service.generate({ scope: "demo", id: "one", title: "Saved", reportIds: ["report"], expectedRevision: null });
    delay = true;
    const controller = new AbortController();
    const request: Parameters<typeof service.exportInstance>[0] = { scope: "demo", id: "one", format: "xlsx", xlsx: { valueMode: "raw" }, signal: controller.signal };
    const pending = service.exportInstance(request);
    request.scope = "changed"; request.id = "changed"; request.format = "pdf"; request.xlsx!.valueMode = "text";
    const replacement = new AbortController(); replacement.abort(); request.signal = replacement.signal;
    release();
    const file = await pending, workbook = new Workbook();
    await workbook.xlsx.load(file.bytes as never);
    const values: unknown[] = []; workbook.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => values.push(cell.value))));
    expect(file.format).toBe("xlsx"); expect(values).toContain(10); expect(values).not.toContain("10.00");
  });
  it("snapshots service fonts at creation, defaults instance output to them, and snapshots per-call fonts before storage waits", async () => {
    const { runtime } = setup(), store = createMemoryReportInstanceStore();
    let delay = false, release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const instances = { ...store, read: async (...args: Parameters<typeof store.read>) => { const value = await store.read(...args); if (delay) await gate; return value; } };
    const bytes = readFileSync(new URL("../../../../examples/minimal/public/fonts/mach-report-demo.otf", import.meta.url));
    const configured = { customFontBytes: new Uint8Array(bytes) };
    const service = createReportGenerationService({ runtime, instances, templateRevisions: { report: "v1" }, pdf: configured });
    configured.customFontBytes.fill(0);
    const instance = await service.generate({ scope: "demo", id: "one", title: "Saved", reportIds: ["report"], expectedRevision: null });
    const defaults = await service.exportInstance({ scope: "demo", id: "one", format: "pdf", fidelity: "strict" });
    expect(defaults.layout?.fontFingerprint).toBe(instance.output?.layout?.fontFingerprint);
    expect(defaults.bytes[0]).toBe(37);
    delay = true;
    const explicit = { customFontBytes: new Uint8Array(bytes) };
    const pending = service.exportInstance({ scope: "demo", id: "one", format: "pdf", fidelity: "strict", pdf: explicit });
    explicit.customFontBytes.fill(0); release();
    expect((await pending).bytes[0]).toBe(37);
  });
});
