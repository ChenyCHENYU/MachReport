import { createBrowserReportExecutor } from "./browser";
import { createAutoExporterController } from "./auto-core";
import type { ReportAutoExporter, ReportExportExecutionOptions } from "./auto-types";

/** Small exports stay local; large exports use the supplied bundler/CSP-compatible Worker factory. */
export function createAutoReportExporter(options: ReportExportExecutionOptions = {}): ReportAutoExporter {
  const factory = options.workerFactory;
  const workerOptions = { timeoutMs: options.timeoutMs ?? options.budget?.maxDurationMs, budget: { ...options.budget } };
  return createAutoExporterController(options, factory ? timeoutMs => createBrowserReportExecutor(factory, { ...workerOptions, timeoutMs }) : undefined);
}
