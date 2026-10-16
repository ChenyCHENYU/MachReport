// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { shallowRef } from "vue";
import { flushPromises } from "@vue/test-utils";
import { usePrintExport } from "../composables/usePrintExport";
import type { PdfExporter } from "../pdf-exporter";
import type { RenderPlan } from "@agile-team/mach-report";

const plan: RenderPlan = { schemaVersion: "cancel-output", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [{ kind: "text", leftMm: 1, topMm: 1, widthMm: 40, heightMm: 10, text: "0001" }] }] };
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });
describe("output observers cannot publish a cancelled snapshot", () => {
  it.each(["pdf", "html", "word"])("%s does not download when an observer cancels at the download boundary", async (format) => {
    const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const onError = vi.fn();
    const api = usePrintExport(shallowRef(plan), { getPdfExporter: () => async () => new Uint8Array([37, 80, 68, 70]), onError, onTask: (task) => { if (task.stage === "download") api.cancel(); } });
    await api.exportAs(format); expect(download).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled(); api.dispose();
  });
  it("can cancel the first started event after its task is registered", async () => {
    const exporter = vi.fn(async () => new Uint8Array([37, 80, 68, 70]));
    const states: string[] = [];
    const api = usePrintExport(shallowRef(plan), { getPdfExporter: () => exporter, onError: vi.fn(), onTask: (task) => { states.push(task.status); if (task.status === "running") api.cancel(); } });
    await api.exportAs("pdf"); expect(exporter).not.toHaveBeenCalled(); expect(states).toEqual(["running", "cancelled"]); api.dispose();
  });
  it("settles an ignored signal and suppresses late diagnostics, rejection and downloads", async () => {
    let context!: Parameters<PdfExporter>[2]; let reject!: (cause: unknown) => void;
    const diagnostic = vi.fn(); const onError = vi.fn(); const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const exporter: PdfExporter = (_plan, _warning, task) => { context = task; return new Promise((_resolve, no) => { reject = no; }); };
    const api = usePrintExport(shallowRef(plan), { getPdfExporter: () => exporter, onError, onDiagnostic: diagnostic });
    const pending = api.exportAs("pdf"); await flushPromises(); api.cancel(); await pending;
    context!.onDiagnostic!({ code: "missing-image", severity: "warning", format: "pdf", pageIndex: 0, componentIndex: 0, kind: "image", message: "old snapshot" });
    reject(new Error("late failure")); await flushPromises();
    expect(context!.signal!.aborted).toBe(true); expect(diagnostic).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled(); expect(download).not.toHaveBeenCalled(); api.dispose();
  });
  it("does not leave an iframe when printing is cancelled by its first observer", async () => {
    const api = usePrintExport(shallowRef(plan), { getPdfExporter: () => async () => new Uint8Array(), onError: vi.fn(), onTask: (task) => { if (task.status === "running") api.cancel(); } });
    await api.print(); expect(document.querySelector("iframe")).toBeNull(); api.dispose();
  });
});
