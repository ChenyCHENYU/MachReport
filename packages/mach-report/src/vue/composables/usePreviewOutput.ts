import { computed, onScopeDispose, ref, watch, type Ref } from "vue";
import type { OutputFormat, RenderPlan } from "@agile-team/mach-report";
import type { MachReportStateError } from "../controller";
import type { MachReportErrorCode } from "../errors";
import type { MachReportMessages } from "../config";
import type { ReportPrintOptions, ReportPrintCalibration } from "../print-options";
import type { ReportPreviewDiagnostic } from "../guards";
import type { PdfExporter } from "../pdf-exporter";
import type { XlsxRenderOptions } from "../../xlsx/render-xlsx";
import { createPrintCalibrationPlan } from "../print-calibration";
import { usePrintExport, printPlans } from "./usePrintExport";
import type { useCellEditing } from "./useCellEditing";
import type { usePreviewDiagnostics } from "./usePreviewDiagnostics";
import type { usePreviewTask } from "./usePreviewTask";
import type { PreviewNotice } from "./usePreviewSession";
import type { ReportExportExecutionOptions } from "../../worker/auto-types";
import { usePreviewEncoding } from "./usePreviewEncoding";

/** Preview output policy and physical-print calibration wrap the encoder task lifecycle. */
export function usePreviewOutput(host: {
  plan: Ref<RenderPlan | null>;
  busy(): boolean;
  wide(): boolean;
  defaultsPrint(): ReportPrintOptions | undefined;
  printOverrides(): ReportPrintOptions | undefined;
  messages(): MachReportMessages;
  fidelity(): "warn" | "strict" | undefined;
  execution(): ReportExportExecutionOptions | undefined;
  getPdfExporter(): PdfExporter;
  getXlsxOptions(): XlsxRenderOptions;
  editing: Pick<ReturnType<typeof useCellEditing>, "settle" | "active" | "saving">;
  diagnostics: ReturnType<typeof usePreviewDiagnostics>;
  task: ReturnType<typeof usePreviewTask>;
  feedback: { lastError: Ref<Readonly<MachReportStateError> | null>; notice: Ref<PreviewNotice | null>; reportError(message: string, code: MachReportErrorCode, cause?: unknown): void; warning(message: string): void };
}) {
  const { plan, editing, diagnostics, task } = host;
  const { lastError, notice: exportNotice, reportError } = host.feedback;
  const exporting = ref<string | null>(null), printing = ref(false);
  const localPrintCalibration = ref<ReportPrintCalibration>();
  const effectivePrintOptions = computed<ReportPrintOptions>(() => ({ ...host.defaultsPrint(), ...host.printOverrides(), calibration: localPrintCalibration.value ?? { ...host.defaultsPrint()?.calibration, ...host.printOverrides()?.calibration } }));
  watch([() => host.printOverrides(), () => host.defaultsPrint()], () => { localPrintCalibration.value = undefined; });
  let calibrationPrintController: AbortController | undefined;
  function outputAllowed(format: string): boolean {
    const snapshot = plan.value;
    if (!snapshot) return false;
    const normalized = ({ excel: "xlsx", image: "png", doc: "word" } as Record<string, string>)[format] ?? format;
    const target: OutputFormat = normalized === "pdf" ? "pdf" : normalized === "xlsx" ? "xlsx" : normalized === "png" ? "canvas" : "dom";
    const issues = diagnostics.inspect(snapshot, target);
    if (plan.value !== snapshot) return false;
    if (issues.length && host.fidelity() === "strict") {
      exportNotice.value = { kind: "error", message: host.messages().diagnosticsStrict ?? "输出存在已知降级" };
      reportError(exportNotice.value.message, "export", { diagnostics: issues });
      return false;
    }
    return true;
  }
  function getOutputDiagnostics(format: OutputFormat): readonly Readonly<ReportPreviewDiagnostic>[] {
    return plan.value ? diagnostics.inspect(plan.value, format) : [];
  }
  const exportApi = usePrintExport(plan, {
    encoding: usePreviewEncoding({ execution: host.execution, fidelity: host.fidelity, diagnostic: diagnostics.add }),
    getPdfExporter: host.getPdfExporter,
    beforeOutput: () => editing.settle(),
    onTask: (value) => task.receive(value, () => exportApi.cancel()),
    onDiagnostic: diagnostics.add,
    onNote: message => diagnostics.add({ code: "xlsx-snapshot", message, severity: "info" }),
    getXlsxOptions: () => host.getXlsxOptions(),
    getPrintOptions: () => effectivePrintOptions.value,
    getPrintMessages: () => host.messages(),
    onError: (message, code) => {
      exportNotice.value = { kind: "error", message };
      reportError(message, (code ?? "print") as MachReportErrorCode);
    },
    onWarning: (message) => {
      exportNotice.value = { kind: "warning", message };
      diagnostics.add({ code: "output", severity: "warning", message });
      host.feedback.warning(message);
    },
    onBusy: (format) => {
      exporting.value = format;
      if (format) {
        exportNotice.value = {
          kind: "progress",
          message: host.messages().exporting.replace("{format}", format)
        };
      } else if (exportNotice.value?.kind === "progress") {
        exportNotice.value = null;
      }
    },
    onPrinting: (value) => { printing.value = value; }
  });
  const { releasePrintFrame, dispose } = exportApi;
  const canCalibratePrint = computed(() => {
    const page = plan.value?.pages[0];
    return !!page && !host.wide() && [page.pageWidthMm, page.pageHeightMm].every(size => size >= 25 && size <= 600);
  });
  async function testPrintCalibration(): Promise<void> {
    if (!canCalibratePrint.value || printing.value || host.busy()) return;
    const page = plan.value!.pages[0]!;
    printing.value = true;
    const controller = new AbortController(); calibrationPrintController = controller;
    try { await printPlans([createPrintCalibrationPlan(page.pageWidthMm, page.pageHeightMm)], { printOptions: effectivePrintOptions.value, signal: controller.signal, messages: host.messages(), onError: message => { exportNotice.value = { kind: "error", message }; } }); }
    catch { /* Superseded calibration output is cancelled without replacing the next report's status. */ }
    finally { if (calibrationPrintController === controller) { printing.value = false; calibrationPrintController = undefined; } }
  }
  async function print(): Promise<void> {
    if (host.busy()) return;
    const ready = editing.settle();
    if (!(typeof ready === "boolean" ? ready : await ready)) return;
    lastError.value = null;
    if (outputAllowed("html")) await exportApi.print();
  }
  async function exportAs(format: string): Promise<void> {
    if (host.busy()) return;
    const ready = editing.settle();
    if (!(typeof ready === "boolean" ? ready : await ready)) return;
    lastError.value = null;
    if (outputAllowed(format)) await exportApi.exportAs(format);
  }
  function openPdfWindow(): void {
    if (host.busy() || editing.active.value || editing.saving.value) {
      exportNotice.value = { kind: "warning", message: host.messages().editingHint ?? "请先确认单元格修改" };
      return;
    }
    lastError.value = null;
    if (outputAllowed("pdf")) exportApi.openPdfWindow();
  }


  function invalidate(): void { calibrationPrintController?.abort(); releasePrintFrame(); }
  onScopeDispose(() => { calibrationPrintController?.abort(); dispose(); });
  return { exporting, printing, localPrintCalibration, effectivePrintOptions, canCalibratePrint, testPrintCalibration,
    print, exportAs, openPdfWindow, getOutputDiagnostics, invalidate, invalidatePending: exportApi.invalidatePending,
    cancel: exportApi.cancel };
}
