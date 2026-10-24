import type { ReportRuntimeBudget, ReportRuntimeExportResult, ReportRuntimePreparedExportInput } from "../server/types";
import type { BrowserReportWorker } from "./browser";

export interface ReportExportThresholds { cells?: number; pages?: number; bytes?: number }
export type ReportExportDecisionReason = "small-task" | "threshold" | "scan-limit" | "explicit-local" | "explicit-worker" | "worker-unavailable" | "worker-start-failed" | "nonserializable-options";
export interface ReportExportDecision {
  mode: "local" | "worker";
  reason: ReportExportDecisionReason;
  /** Lower bounds: traversal stops as soon as isolation is warranted. No font or image hashing. */
  estimate: { pages: number; cells: number; bytes: number };
  hardCancellation: boolean;
}
export interface ReportExportExecutionOptions {
  mode?: "auto" | "worker" | "local";
  /** A fresh bundler-managed module Worker for every call; never a shared worker. */
  workerFactory?: () => BrowserReportWorker;
  thresholds?: ReportExportThresholds;
  /** Auto only. Startup unavailability may use local; encoding failures never retry. */
  fallback?: "local" | "error";
  timeoutMs?: number;
  budget?: ReportRuntimeBudget;
  onDecision?: (decision: ReportExportDecision) => void;
}
export interface ReportAutoExportResult extends ReportRuntimeExportResult { execution: ReportExportDecision }
export type ReportLocalExport = (input: ReportRuntimePreparedExportInput) => Promise<ReportRuntimeExportResult>;
export interface ReportAutoExporter {
  exportPrepared(input: ReportRuntimePreparedExportInput, localOverride?: ReportLocalExport): Promise<ReportAutoExportResult>;
  cancel(): void;
  dispose(): void;
}
