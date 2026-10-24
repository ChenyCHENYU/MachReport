import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderPlan } from "../../schema/render-plan";
import type { ReportRuntimePreparedExportInput, ReportRuntimeExportResult } from "../../server/types";
import type { ReportLocalExport } from "../../worker/auto-types";
import type { PdfExporter } from "../pdf-exporter";
import { usePreviewEncoding } from "../composables/usePreviewEncoding";

const mock = vi.hoisted(() => ({ execute: vi.fn(), renderXlsx: vi.fn() }));
vi.mock("../composables/useReportExportExecution", () => ({ useReportExportExecution: () => ({ exportPrepared: mock.execute }) }));
vi.mock("@agile-team/mach-report/xlsx", () => ({ renderPlanToXlsx: mock.renderXlsx }));
const plan: RenderPlan = { schemaVersion: "test", pages: [{ pageWidthMm: 80, pageHeightMm: 50, components: [] }] };
function result(input: ReportRuntimePreparedExportInput): ReportRuntimeExportResult {
  return { ...input.prepared, format: input.format, contentType: "test", bytes: new Uint8Array([7]), diagnostics: [] };
}
function harness() {
  const diagnostic = vi.fn();
  return { diagnostic, encoding: usePreviewEncoding({ execution: () => ({ mode: "auto" }), fidelity: () => "strict", diagnostic }) };
}
beforeEach(() => { mock.execute.mockReset().mockImplementation(async (input: ReportRuntimePreparedExportInput) => result(input)); mock.renderXlsx.mockReset(); });
describe("preview prepared encoding boundary", () => {
  it("prepares font bytes once, keeps the exact displayed geometry and carries strict encoding", async () => {
    const h = harness(); const font = new Uint8Array([1, 2]);
    const exporter: PdfExporter = Object.assign(vi.fn(), { prepare: vi.fn().mockResolvedValue({ customFontBytes: font }) });
    const controller = new AbortController(), progress = vi.fn();
    expect(await h.encoding.pdf(plan, exporter, vi.fn(), { signal: controller.signal, onProgress: progress })).toEqual(new Uint8Array([7]));
    expect(exporter).not.toHaveBeenCalled(); expect(exporter.prepare).toHaveBeenCalledWith(controller.signal);
    const input = mock.execute.mock.calls[0]![0] as ReportRuntimePreparedExportInput;
    expect(input.prepared.plan).toBe(plan); expect(input).toMatchObject({ format: "pdf", layoutPolicy: "preserve", fidelity: "strict", pdf: { customFontBytes: font } });
    input.onEvent?.({ taskId: "one", stage: "encode", status: "started", completed: 1, total: 2 }); expect(progress).toHaveBeenCalledWith(1, 2);
  });
  it("does not bypass an injected custom exporter", async () => {
    const exporter = vi.fn<PdfExporter>().mockResolvedValue(new Uint8Array([9]));
    expect(await harness().encoding.pdf(plan, exporter, vi.fn())).toEqual(new Uint8Array([9]));
    expect(exporter).toHaveBeenCalledOnce(); expect(mock.execute).not.toHaveBeenCalled();
  });
  it("cancellation during font preparation cannot start another encoder", async () => {
    const controller = new AbortController();
    const exporter: PdfExporter = Object.assign(vi.fn(), { prepare: vi.fn(async () => { controller.abort(); return {}; }) });
    await expect(harness().encoding.pdf(plan, exporter, vi.fn(), { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(mock.execute).not.toHaveBeenCalled();
  });
  it("surfaces actual PDF text/page failures even when a configured encoder returns bytes", async () => {
    mock.execute.mockImplementation(async (input: ReportRuntimePreparedExportInput) => ({ ...result(input), diagnostics: [{ code: "pdf-font", severity: "warning", message: "missing glyph" }] }));
    const h = harness(); const exporter: PdfExporter = Object.assign(vi.fn(), { prepare: vi.fn().mockResolvedValue({}) });
    await expect(h.encoding.pdf(plan, exporter, vi.fn())).rejects.toThrow("missing glyph");
    expect(h.diagnostic).toHaveBeenCalledWith(expect.objectContaining({ code: "pdf-font" }));
  });
  it("serializable Excel settings retain image budgets without introducing callbacks that disable isolation", async () => {
    const h = harness(); await h.encoding.xlsx(plan, { sheetMode: "continuous", maxImagePixels: 500, maxTotalImageBytes: 1000 }, {});
    expect(mock.execute.mock.calls[0]![0]).toMatchObject({ format: "xlsx", fidelity: "strict", xlsx: { sheetMode: "continuous", maxImagePixels: 500, maxTotalImageBytes: 1000 } });
    expect(mock.execute.mock.calls[0]![1]).toBeUndefined();
  });
  it("keeps custom Excel names and observers in the explicit local encoder", async () => {
    mock.execute.mockImplementation((input: ReportRuntimePreparedExportInput, local: ReportLocalExport) => local(input));
    mock.renderXlsx.mockImplementation(async (_plan, options) => { options.onProgress(1, 1); options.onDiagnostic({ code: "unsupported-style", message: "style", severity: "warning" }); return { buffer: new Uint8Array([8]), warnings: [] }; });
    const sheetName = () => "业务表", onProgress = vi.fn(), onDiagnostic = vi.fn(), taskProgress = vi.fn();
    const output = await harness().encoding.xlsx(plan, { sheetName, onProgress, onDiagnostic }, { onProgress: taskProgress });
    expect(output.buffer).toEqual(new Uint8Array([8])); expect(mock.renderXlsx.mock.calls[0]![1].sheetName).toBe(sheetName);
    expect(onProgress).toHaveBeenCalledWith(1, 1); expect(taskProgress).toHaveBeenCalledWith(1, 1); expect(onDiagnostic).toHaveBeenCalledOnce();
  });
});
