// @vitest-environment node
import { Workbook } from "exceljs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { createReportRuntime } from "../server/runtime";
import { createTableTemplate } from "../builder/table-template";
import { outputDiagnostics } from "../server/runtime-output";
import { renderPlanToPdf } from "../pdf/render-pdf";
import { renderPlanToXlsx } from "../xlsx/render-xlsx";
import { validReportWorkerResult, runReportWorkerRequest, REPORT_WORKER_PROTOCOL } from "../worker/protocol";
import type { PreparedReport } from "../server/types";
import type { RenderPlan, PlanComponent } from "../schema/render-plan";

const rect: PlanComponent = { kind: "rect", leftMm: 0, topMm: 0, widthMm: 40, heightMm: 5 };
function prepared(components: PlanComponent[]): PreparedReport {
  return { plan: { schemaVersion: "summary", pages: [{ pageWidthMm: 210, pageHeightMm: 297, components }] }, diagnostics: [], revisions: {}, stats: { rows: 0, pages: 1, cells: 0, durationMs: 0 }, layout: { textMetrics: "heuristic" } };
}
function cellPlan(rows = 3): PreparedReport {
  return prepared([{ ...rect, heightMm: rows * 5, grid: { colWidthsMm: [40], rowHeightsMm: Array(rows).fill(5), cells: Array.from({ length: rows }, (_, index) => [{ text: String(index), value: index, style: { letterSpacing: 0.1 } }]) } }]);
}

describe("runtime diagnostic windows", () => {
  it("preserves query occurrence metadata and counts omitted business explanations before encoding", async () => {
    const query = vi.fn(() => ({ datasets: { detail: [{ id: "ROW", qty: 0 }] }, revision: "v1", sourceToken: "t1", diagnostics: Array.from({ length: 500 }, (_, index) => ({ code: "source", message: `missing ${index}`, severity: "info" as const, valueState: "missing-source" as const, target: { datasetId: "detail", field: "qty" } })) }));
    const runtime = createReportRuntime({ reports: { daily: { template: createTableTemplate({ columns: [{ header: "Qty", field: "qty" }] }), provider: { query } } } });
    const value = await runtime.prepare({ reportIds: ["daily"], diagnosticLimit: 2 });
    expect(value.diagnostics).toHaveLength(2);
    expect(value.diagnosticSummary).toMatchObject({ total: 500, omitted: 498, explanations: { total: 500 } });
    expect(value.sources?.[0]).toMatchObject({ reportId: "daily", revision: "v1", sourceToken: "t1" });
    expect(validReportWorkerResult(value, "prepare")).toBe(true);
    expect((await runtime.prepare({ reportIds: ["daily"] })).diagnostics).toHaveLength(500);
    await expect(runtime.prepare({ reportIds: ["daily"], diagnosticLimit: -1 })).rejects.toThrow("diagnosticLimit");
    expect(query).toHaveBeenCalledTimes(2);
  });
  it("round-trips real Excel values with bounded diagnostics and precise cell positions across RPC", async () => {
    const runtime = createReportRuntime({ reports: {} }), input = cellPlan();
    const result = await runtime.exportPrepared({ prepared: input, format: "xlsx", diagnosticLimit: 2, xlsx: { valueMode: "raw" } });
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnosticSummary).toMatchObject({ total: 3, omitted: 1, counts: { "unsupported-style": 3 } });
    expect(result.diagnostics[1]).toMatchObject({ path: "$.pages.0.components.0.grid.cells.1.0", format: "xlsx", componentPath: [1, 0] });
    const workbook = new Workbook(); await workbook.xlsx.load(result.bytes as never);
    expect(workbook.worksheets[0]!.getCell("A1").value).toBe(0);
    expect(workbook.worksheets[0]!.getCell("A3").value).toBe(2);
    const rpc = await runReportWorkerRequest(runtime, { protocol: REPORT_WORKER_PROTOCOL, id: "bounded", operation: "exportPrepared", input: { prepared: input, format: "xlsx", diagnosticLimit: 1 } });
    expect(rpc.error).toBeUndefined();
    expect(validReportWorkerResult(rpc.result, "exportPrepared")).toBe(true);
    expect(rpc.result?.diagnosticSummary).toMatchObject({ total: 3, omitted: 2 });
  });
  it("rejects omitted asset degradation in strict mode and malformed summary/detail pairs", async () => {
    const runtime = createReportRuntime({ reports: {} }), input = prepared([]);
    input.diagnosticSummary = { total: 1, omitted: 1, entries: [], counts: { "asset-render-failed": 1 } };
    await expect(runtime.exportPrepared({ prepared: input, format: "xlsx", fidelity: "strict", diagnosticLimit: 0 })).rejects.toThrow("资产渲染降级");
    input.diagnosticSummary = { total: 1, omitted: 0, entries: [{ code: "a", severity: "warning", message: "sample" }], counts: { a: 1 } };
    expect(validReportWorkerResult(input, "prepare")).toBe(false);
    await expect(runtime.exportPrepared({ prepared: input, format: "xlsx" })).rejects.toThrow("诊断摘要无效");
    input.diagnostics = [{ code: "b", severity: "warning", message: "different" }];
    expect(validReportWorkerResult(input, "prepare")).toBe(false);
  });
  it("retains nested grid and extension identities through the runtime mapper", () => {
    expect(outputDiagnostics([{ code: "nested-components-omitted", message: "nested", severity: "warning", format: "xlsx", pageIndex: 2, componentIndex: 3, componentPath: [0, 1, 2, 4, 5], kind: "rect", extension: { id: "custom", version: "1" } }])[0]).toMatchObject({
      path: "$.pages.2.components.3.grid.cells.0.1.children.2.grid.cells.4.5", componentPath: [0, 1, 2, 4, 5], extension: { id: "custom", version: "1" }
    });
    expect(outputDiagnostics([{ code: "output-degraded", message: "page", severity: "warning", format: "pdf", pageIndex: 1, componentIndex: -1, kind: "page" }])[0]!.path).toBe("$.pages.1");
  });
  it("bounds legacy Excel warning details and merges their exact counts", async () => {
    const input = prepared(Array.from({ length: 300 }, () => ({ ...rect })));
    const direct = await renderPlanToXlsx(input.plan, { diagnosticLimit: 2 });
    expect(direct.diagnostics).toHaveLength(2);
    expect(direct.warnings).toHaveLength(2);
    expect(direct.warningCount).toBe(300);
    const runtime = await createReportRuntime({ reports: {} }).exportPrepared({ prepared: input, format: "xlsx", diagnosticLimit: 2 });
    expect(runtime.diagnosticSummary).toMatchObject({ total: 600, omitted: 598, counts: { "unsupported-component": 300, "xlsx-fidelity": 300 } });
    const legacy = await renderPlanToXlsx(prepared([{ ...rect }, { ...rect }, { ...rect }]).plan);
    expect(legacy.warnings).toHaveLength(3); expect(legacy.warningCount).toBeUndefined();
  });
  it("bounds PDF overflow strings while retaining per-cell fidelity totals and a readable file", async () => {
    const plan: RenderPlan = { schemaVersion: "overflow", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [{ ...rect, heightMm: 60, grid: { paddingMm: 0, colWidthsMm: [40], rowHeightsMm: Array(300).fill(0.2), cells: Array.from({ length: 300 }, () => [{ text: "visible overflow" }]) } }] }] };
    const direct = await renderPlanToPdf(plan, { diagnosticLimit: 2 });
    expect(direct.fidelityWarnings).toHaveLength(2);
    expect(direct.fidelityWarningCount).toBe(300);
    expect(direct.diagnosticSummary).toMatchObject({ total: 300, omitted: 298, counts: { "output-degraded": 300 } });
    expect((await PDFDocument.load(direct.bytes)).getPageCount()).toBe(1);
    await expect(renderPlanToPdf(plan, { fidelity: "strict", diagnosticLimit: 0 })).rejects.toMatchObject({ diagnosticSummary: { total: 300, omitted: 300 } });
  });
  it("counts omitted PDF component failures independently of its retained error strings", async () => {
    const plan = prepared(Array.from({ length: 5 }, () => ({ ...rect, kind: "text", text: "overflowing word" }))).plan;
    const direct = await renderPlanToPdf(plan, { diagnosticLimit: 1, measurer: { measureMm: () => { throw new Error("measure failed"); } } });
    expect(direct.pageErrors).toHaveLength(1); expect(direct.pageErrorCount).toBe(5);
    expect(direct.diagnosticSummary).toMatchObject({ total: 5, omitted: 4, counts: { "component-render-failed": 5 } });
  });
});
