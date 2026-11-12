// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createReportRuntime } from "../server/runtime";
import type { PreparedReport, ReportRuntimeExecutor, ReportRuntimeExportResult, ReportRuntimePreparedExportInput } from "../server/types";
import { createAutoReportExporter } from "../worker/auto";
import { createAutoExporterController } from "../worker/auto-core";
import { createReportWorkerExecutor } from "../worker/client";
import { REPORT_WORKER_PROTOCOL, validReportWorkerResult } from "../worker/protocol";
import * as planValidation from "../schema/validate";

const reports = { sample: { template: { pages: [{ widthMm: 100, heightMm: 80, components: [] }] }, load: async () => ({}) } };
function prepared(): PreparedReport {
  return {
    plan: { schemaVersion: "mach-report/1", pages: [{ pageWidthMm: 100, pageHeightMm: 80, components: [{ kind: "rect", leftMm: 0, topMm: 0, widthMm: 90, heightMm: 10, grid: { cells: [[{ value: 0, text: "0" }, { value: "001", text: "001" }]] } }] }] },
    stats: { rows: 1, pages: 1, cells: 2, durationMs: 2 }, diagnostics: [], revisions: { sample: { revision: "v1", sourceToken: "token1" } },
    sources: [{ reportId: "sample", reportIndex: 0, reportScope: '[0,"sample"]', revision: "v1", sourceToken: "token1" }], layout: { textMetrics: "heuristic" }
  };
}
function output(format: "pdf" | "xlsx" = "pdf"): ReportRuntimeExportResult {
  return { ...prepared(), format, bytes: new Uint8Array([1, 2, 3]), contentType: format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
}
function executor(result: unknown): ReportRuntimeExecutor {
  return { prepare: async () => result as PreparedReport, export: async () => output() };
}
function request(): ReportRuntimePreparedExportInput { return { prepared: prepared(), format: "pdf" }; }

afterEach(() => vi.restoreAllMocks());

describe("extension result contract boundaries", () => {
  it.each([
    ["null result", (): unknown => null],
    ["missing stats", (): unknown => ({ ...prepared(), stats: undefined })],
    ["fractional rows", (): unknown => ({ ...prepared(), stats: { ...prepared().stats, rows: 0.5 } })],
    ["nonfinite duration", (): unknown => ({ ...prepared(), stats: { ...prepared().stats, durationMs: NaN } })],
    ["null diagnostics", (): unknown => ({ ...prepared(), diagnostics: null })],
    ["malformed diagnostic", (): unknown => ({ ...prepared(), diagnostics: [{ code: "bad", message: "missing severity" }] })],
    ["invalid source token", (): unknown => ({ ...prepared(), revisions: { sample: { sourceToken: 42 } } })],
    ["invalid source list", (): unknown => ({ ...prepared(), sources: [{ reportId: "sample", reportIndex: -1, reportScope: "sample" }] })],
    ["null layout", (): unknown => ({ ...prepared(), layout: null })],
    ["invalid fingerprint", (): unknown => ({ ...prepared(), layout: { textMetrics: "font-bytes", fontFingerprint: 42 } })],
    ["inconsistent summary", (): unknown => ({ ...prepared(), diagnosticSummary: { total: 1, counts: { bad: 1 }, entries: [], omitted: 0 } })],
  ] as const)("rejects direct prepare %s just as the Worker contract does", async (_name, make) => {
    const result = make();
    expect(validReportWorkerResult(result, "prepare")).toBe(false);
    const validate = vi.spyOn(planValidation, "validateRenderPlan");
    await expect(createReportRuntime({ reports, executor: executor(result) }).prepare({ reportIds: ["sample"] })).rejects.toMatchObject({ code: "validate" });
    expect(validate).not.toHaveBeenCalled();
  });

  it("keeps one geometry validation and recomputes exact counts for legitimate prepared results", async () => {
    const result = prepared(); result.stats.pages = 99; result.stats.cells = 99;
    const validate = vi.spyOn(planValidation, "validateRenderPlan");
    const actual = await createReportRuntime({ reports, executor: executor(result) }).prepare({ reportIds: ["sample"] });
    expect(validate).toHaveBeenCalledOnce();
    expect(actual).toMatchObject({ stats: { rows: 1, pages: 1, cells: 2 }, revisions: result.revisions, sources: result.sources, layout: result.layout });
    expect(actual.plan).toBe(result.plan);
    expect(actual.plan.pages[0]!.components[0]!.grid!.cells[0]!.map(cell => cell!.value)).toEqual([0, "001"]);
  });

  it("still rejects invalid geometry, budgets and cancellation without calling an extension twice", async () => {
    const result = prepared(); result.plan.pages[0]!.pageWidthMm = 0;
    await expect(createReportRuntime({ reports, executor: executor(result) }).prepare({ reportIds: ["sample"] })).rejects.toMatchObject({ code: "validate" });
    const run = vi.fn(async () => prepared());
    const runtime = createReportRuntime({ reports, executor: { ...executor(prepared()), prepare: run }, budget: { maxCells: 1 } });
    await expect(runtime.prepare({ reportIds: ["sample"] })).rejects.toMatchObject({ code: "budget", path: "$.budget.maxCells" });
    const controller = new AbortController(); controller.abort();
    await expect(runtime.prepare({ reportIds: ["sample"], signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(run).toHaveBeenCalledOnce();
  });

  it.each([
    ["wrong format", (): unknown => output("xlsx")],
    ["wrong MIME", (): unknown => ({ ...output(), contentType: "application/zip" })],
    ["nonbinary bytes", (): unknown => ({ ...output(), bytes: [1, 2] })],
    ["null diagnostics", (): unknown => ({ ...output(), diagnostics: null })],
    ["nonfinite duration", (): unknown => ({ ...output(), stats: { ...output().stats, durationMs: NaN } })],
    ["malformed revision", (): unknown => ({ ...output(), revisions: { sample: { revision: false } } })],
    ["missing stats", (): unknown => ({ ...output(), stats: undefined })],
    ["null result", (): unknown => null],
  ] as const)("rejects local override %s before delivery and releases its active slot", async (_name, make) => {
    const exporter = createAutoReportExporter({ mode: "local" });
    try {
      const encode = vi.fn(async () => make() as ReportRuntimeExportResult);
      for (let attempt = 0; attempt < 3; attempt++) await expect(exporter.exportPrepared(request(), encode)).rejects.toMatchObject({ code: "validate" });
      expect(encode).toHaveBeenCalledTimes(3);
      expect(await exporter.exportPrepared(request(), async () => output())).toMatchObject({ format: "pdf" });
    } finally { exporter.dispose(); }
  });

  it("matches the requested format even when a Worker returns an otherwise valid file", async () => {
    let emit!: (value: unknown) => void;
    const terminate = vi.fn();
    const worker = createReportWorkerExecutor(() => ({ terminate, subscribe: next => { emit = next; return () => {}; }, postMessage: message => {
      emit({ protocol: REPORT_WORKER_PROTOCOL, id: message.id, result: output("xlsx") });
    } }));
    const exporter = createAutoExporterController({ mode: "worker" }, () => worker);
    try { await expect(exporter.exportPrepared(request())).rejects.toThrow("无效响应"); }
    finally { exporter.dispose(); }
    expect(terminate).toHaveBeenCalledOnce();
  });

  it("keeps raw bytes, a single geometry check and exact metadata for matching overrides", async () => {
    const expected = output(), encode = vi.fn(async () => expected);
    const validate = vi.spyOn(planValidation, "validateRenderPlan"), exporter = createAutoReportExporter({ mode: "local" });
    try {
      const actual = await exporter.exportPrepared(request(), encode);
      expect(actual.bytes).toBe(expected.bytes);
      expect(actual).toMatchObject({ format: "pdf", contentType: "application/pdf", diagnostics: [], revisions: expected.revisions, sources: expected.sources, execution: { mode: "local" } });
      expect(validate).toHaveBeenCalledOnce(); expect(encode).toHaveBeenCalledOnce();
    } finally { exporter.dispose(); }
  });

  it.each(["pdf", "xlsx"] as const)("accepts a real %s encoded through a matching custom callback", async format => {
    const runtime = createReportRuntime({ reports: {} });
    const encode = vi.fn((next: ReportRuntimePreparedExportInput) => runtime.exportPrepared(next));
    const exporter = createAutoReportExporter({ mode: "local" });
    try {
      const actual = await exporter.exportPrepared({ ...request(), format, fidelity: "strict", xlsx: { valueMode: "raw" } }, encode);
      expect(actual).toMatchObject({ format, stats: { rows: 1, pages: 1, cells: 2 }, revisions: prepared().revisions, sources: prepared().sources });
      expect(actual.stats.outputBytes).toBe(actual.bytes.byteLength);
      expect(encode).toHaveBeenCalledOnce();
      if (format === "pdf") {
        const { PDFDocument } = await import("pdf-lib");
        expect((await PDFDocument.load(actual.bytes)).getPageCount()).toBe(1);
      } else {
        const { default: ExcelJS } = await import("exceljs");
        const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(actual.bytes as unknown as import("exceljs").Buffer);
        expect(workbook.worksheets[0]!.getCell("A1").value).toBe(0);
        expect(workbook.worksheets[0]!.getCell("B1").value).toBe("001");
      }
    } finally { exporter.dispose(); }
  });
});
