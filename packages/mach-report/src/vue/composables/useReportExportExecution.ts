import { onScopeDispose, shallowRef } from "vue";
import { forwardOutputAbort, observeOutput, waitForOutput } from "../../output/progress";
import { snapshotPdfFonts, capturePreparedHandoff, snapshotXlsxOptions } from "../../server/prepared";
import { throwIfAborted } from "../../server/control";
import type { ReportAutoExporter, ReportExportDecision, ReportExportExecutionOptions, ReportLocalExport } from "../../worker/auto-types";
import type { ReportRuntimePreparedExportInput } from "../../server/types";

type ExportFactory = typeof import("../../worker/auto").createAutoReportExporter;
let loadedFactory: ExportFactory | undefined;
function snapshotDuringImport(input: ReportRuntimePreparedExportInput, options?: ReportExportExecutionOptions): ReportRuntimePreparedExportInput {
  return { ...input, prepared: capturePreparedHandoff(input.prepared, options?.budget?.maxPreparedBytes ?? 64_000_000, input.signal).forward(),
    pdf: snapshotPdfFonts(input.pdf), xlsx: snapshotXlsxOptions(input.xlsx) };
}
/** The optional runtime is loaded only at the first export; pending imports obey preview cancellation too. */
export function useReportExportExecution(options: () => ReportExportExecutionOptions | undefined) {
  const decision = shallowRef<ReportExportDecision>();
  const tasks = new Set<{ abort: AbortController; exporter?: ReportAutoExporter }>();
  let closed = false, sequence = 0;
  const cancel = () => { sequence++; for (const task of tasks) { task.abort.abort(); task.exporter?.cancel(); } };
  const dispose = () => { closed = true; cancel(); for (const task of tasks) task.exporter?.dispose(); };
  onScopeDispose(dispose);
  return {
    decision,
    async exportPrepared(input: ReportRuntimePreparedExportInput, localOverride?: ReportLocalExport) {
      if (closed) throw new Error("报表预览已卸载");
      throwIfAborted(input.signal);
      const current = ++sequence, configured = options();
      const config = { ...configured, thresholds: { ...configured?.thresholds }, budget: { ...configured?.budget } };
      const task: { abort: AbortController; exporter?: ReportAutoExporter } = { abort: new AbortController() };
      const unlink = forwardOutputAbort(input.signal, task.abort); tasks.add(task);
      try {
        const request = { ...(loadedFactory ? input : snapshotDuringImport(input, config)), signal: task.abort.signal };
        const factory = loadedFactory ?? await waitForOutput<ExportFactory>(import("../../worker/auto").then(module => { const factory = module.createAutoReportExporter; loadedFactory = factory; return factory; }), task.abort.signal);
        throwIfAborted(task.abort.signal);
        task.exporter = factory({ ...config, onDecision: next => {
          if (current !== sequence || closed) return;
          decision.value = next; observeOutput(() => configured?.onDecision?.(next));
        } });
        return await task.exporter.exportPrepared(request, localOverride);
      } finally { unlink(); task.exporter?.dispose(); tasks.delete(task); }
    },
    cancel, dispose
  };
}
