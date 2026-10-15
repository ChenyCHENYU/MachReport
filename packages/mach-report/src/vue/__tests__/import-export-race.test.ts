// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import type { RenderPlan } from "@agile-team/mach-report";
import type { MachReportHandle } from "../controller";
import { MACH_REPORT_PDF_EXPORTER_KEY } from "../injection-keys";
import type { PdfExporter } from "../pdf-exporter";
import ReportPreview from "../ReportPreview.vue";

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.restoreAllMocks();
});

const original: RenderPlan = { schemaVersion: "race", pages: [{
  pageWidthMm: 210, pageHeightMm: 297,
  components: [{ kind: "text", leftMm: 10, topMm: 10, widthMm: 100, heightMm: 10, text: "原报表" }]
}] };

describe("import cancels prior output without discarding the last usable plan", () => {
  it.each(["pdf", "xlsx"] as const)("a pending %s export cannot download while a new import runs or after it fails", async (format) => {
    let finishPdf!: (bytes: Uint8Array) => void;
    const exporter = vi.fn<PdfExporter>(() => new Promise((resolve) => { finishPdf = resolve; }));
    const xlsx = await import("@agile-team/mach-report/xlsx");
    type XlsxResult = Awaited<ReturnType<typeof xlsx.renderPlanToXlsx>>;
    let finishXlsx!: (result: XlsxResult) => void;
    const renderExcel = vi.spyOn(xlsx, "renderPlanToXlsx").mockImplementation(() => new Promise((resolve) => { finishXlsx = resolve; }));
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:stale-output");
    const onError = vi.fn();
    const onWarning = vi.fn();
    const wrapper = mount(ReportPreview, {
      props: { autoLoad: false, reportId: "A", fetcher: async () => original, showExport: false, showPdfWindow: false, onError, onWarning },
      global: { provide: { [MACH_REPORT_PDF_EXPORTER_KEY as symbol]: exporter } },
      attachTo: document.body
    });
    wrappers.push(wrapper);
    const report = wrapper.vm as unknown as MachReportHandle;
    await report.reload();
    const exporting = report.exportAs(format);
    await vi.waitFor(() => expect(format === "pdf" ? exporter : renderExcel).toHaveBeenCalledOnce());

    let finishRead!: (bytes: ArrayBuffer) => void;
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    const read = vi.spyOn(blob, "arrayBuffer").mockImplementation(() => new Promise((resolve) => { finishRead = resolve; }));
    const importing = report.importExcel(blob);
    const failedImport = expect(importing).rejects.toMatchObject({ code: "import" });
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    expect(report.state.importing).toBe(true);
    expect(report.getPlan()).toEqual(original);
    if (format === "pdf") finishPdf(new Uint8Array([37, 80, 68, 70]));
    else finishXlsx({ workbook: {} as XlsxResult["workbook"], buffer: new ArrayBuffer(2), warnings: ["过期的内容遗漏"] });
    await exporting;
    expect(createUrl).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onWarning).not.toHaveBeenCalled();

    finishRead(new Uint8Array([1, 2, 3]).buffer);
    await failedImport;
    expect(report.state.importing).toBe(false);
    expect(report.getPlan()).toEqual(original);
    expect(createUrl).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    expect(onWarning).not.toHaveBeenCalled();

    // A failure keeps the old report usable; a new export must start a fresh task/epoch.
    const next = report.exportAs(format);
    await vi.waitFor(() => expect(format === "pdf" ? exporter : renderExcel).toHaveBeenCalledTimes(2));
    if (format === "pdf") finishPdf(new Uint8Array([37, 80, 68, 70]));
    else finishXlsx({ workbook: {} as XlsxResult["workbook"], buffer: new ArrayBuffer(2), warnings: [] });
    await next;
    expect(createUrl).toHaveBeenCalledOnce();
  });
});
