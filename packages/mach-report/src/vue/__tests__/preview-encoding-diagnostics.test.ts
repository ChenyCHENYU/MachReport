import { effectScope } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { RenderPlan } from "@agile-team/mach-report";
import { usePreviewEncoding } from "../composables/usePreviewEncoding";
import type { BrowserReportWorker } from "../../worker/browser";
import type { ReportWorkerRequest } from "../../worker/protocol";
import type { PdfExporter } from "../pdf-exporter";

const plan: RenderPlan = { schemaVersion: "encoding", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [] }] };
function workerResponse(payload: Record<string, unknown>) {
  const listeners = new Set<(event: MessageEvent) => void>();
  const worker: BrowserReportWorker = {
    terminate: vi.fn(),
    addEventListener: (type, listener) => { if (type === "message") listeners.add(listener as (event: MessageEvent) => void); },
    removeEventListener: (type, listener) => { if (type === "message") listeners.delete(listener as (event: MessageEvent) => void); },
    postMessage: value => {
      const request = value as ReportWorkerRequest;
      listeners.forEach(listener => listener({ data: { protocol: request.protocol, id: request.id, ...payload } } as MessageEvent));
    }
  };
  return worker;
}

describe("isolated encoding diagnostic recovery", () => {
  it.each(["local", "worker"])("keeps configured strict-fidelity feedback and diagnostics in the %s encoder", async mode => {
    const entry = { code: "missing-image", severity: "warning", message: "missing", format: "xlsx", pageIndex: 0, componentIndex: 0 };
    const worker = workerResponse({ error: { name: "OutputFidelityError", code: "output-fidelity", message: "raw internal failure", diagnostics: [entry] } });
    const summary = vi.fn(), scope = effectScope();
    const encoding = scope.run(() => usePreviewEncoding({ execution: () => mode === "worker" ? { mode: "worker", workerFactory: () => worker } : undefined,
      fidelity: () => "strict", fidelityMessage: () => "当前格式存在已知内容降级", diagnostic: vi.fn(), diagnosticSummary: summary }))!;
    const invalid: RenderPlan = { ...plan, pages: [{ ...plan.pages[0]!, components: [{ kind: "image", leftMm: 0, topMm: 0, widthMm: 10, heightMm: 10 }] }] };
    await expect(encoding.xlsx(invalid, {}, {})).rejects.toMatchObject({ message: "当前格式存在已知内容降级", cause: expect.any(Error) });
    expect(summary).toHaveBeenCalledWith(expect.objectContaining({ total: 1, counts: { "missing-image": 1 } }), "xlsx");
    scope.stop();
  });
  it("keeps strict Worker failure counts and locations visible without a successful file", async () => {
    const entry = { code: "missing-image", severity: "warning", message: "missing", format: "xlsx", pageIndex: 0, componentIndex: 0 };
    const diagnosticSummary = { total: 1000, counts: { "missing-image": 1000 }, entries: [entry], omitted: 999 };
    const worker = workerResponse({ error: { name: "OutputFidelityError", message: "strict failure", diagnostics: [entry], diagnosticSummary } });
    const summary = vi.fn(), scope = effectScope();
    const encoding = scope.run(() => usePreviewEncoding({ execution: () => ({ mode: "worker", workerFactory: () => worker }), fidelity: () => "strict", diagnostic: vi.fn(), diagnosticSummary: summary }))!;
    await expect(encoding.xlsx(plan, {}, {})).rejects.toThrow("strict failure");
    expect(summary).toHaveBeenCalledWith(expect.objectContaining({ total: 1000, omitted: 999 }), "xlsx");
    expect(worker.terminate).toHaveBeenCalledOnce(); scope.stop();
  });
  it.each([{ componentPath: "bad" }, { pageIndex: -1 }, { format: "unknown" }, { valueState: "missing-source", target: "bad" }])("rejects malformed remote diagnostic locations %s", async patch => {
    const entry = { code: "missing-image", severity: "warning", message: "missing", ...patch };
    const worker = workerResponse({ error: { name: "Error", message: "bad detail", diagnostics: [entry], diagnosticSummary: { total: 1, counts: { "missing-image": 1 }, entries: [entry], omitted: 0 } } });
    const diagnostic = vi.fn(), summary = vi.fn(), scope = effectScope();
    const encoding = scope.run(() => usePreviewEncoding({ execution: () => ({ mode: "worker", workerFactory: () => worker }), fidelity: () => "warn", diagnostic, diagnosticSummary: summary }))!;
    await expect(encoding.xlsx(plan, {}, {})).rejects.toThrow("bad detail");
    expect(diagnostic).not.toHaveBeenCalled();
    expect(summary).toHaveBeenCalledWith(expect.objectContaining({ total: 0, entries: [] }), "xlsx"); scope.stop();
  });
  it("blocks PDF download when the font failure detail was omitted from the sample window", async () => {
    const worker = workerResponse({ result: { bytes: new Uint8Array([1]), format: "pdf", contentType: "application/pdf", revisions: {}, stats: { rows: 0, pages: 1, cells: 0, durationMs: 1 }, diagnostics: [], diagnosticSummary: { total: 1, counts: { "pdf-font": 1 }, entries: [], omitted: 1 } } });
    const scope = effectScope();
    const encoding = scope.run(() => usePreviewEncoding({ execution: () => ({ mode: "worker", workerFactory: () => worker }), fidelity: () => "warn", diagnostic: vi.fn(), diagnosticSummary: vi.fn() }))!;
    const exporter: PdfExporter = Object.assign(async () => new Uint8Array(), { prepare: async () => ({}) });
    await expect(encoding.pdf(plan, exporter, vi.fn())).rejects.toThrow("缺失文本"); scope.stop();
  });
});
