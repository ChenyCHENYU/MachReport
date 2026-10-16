import type { OutputFormat } from "@agile-team/mach-report";

export type ReportDiscardReason = "reload" | "import" | "replace" | "leave";

export interface ReportBeforeDiscardContext {
  reason: ReportDiscardReason;
  reportIds: readonly string[];
  /** Local input or a local draft, never a synonym for persisted differences. */
  pendingLocalChanges: true;
}

/** Return false to keep the current report. Without a hook the preview asks inline. */
export type ReportBeforeDiscard = (context: Readonly<ReportBeforeDiscardContext>) => boolean | Promise<boolean>;

export interface ReportOutputOptions {
  /** warn preserves supported output and shows diagnostics; strict rejects known fidelity loss. */
  fidelity?: "warn" | "strict";
}

export type ReportPreviewTaskStage = "query" | "validate" | "layout" | "assets" | "import" | "encode" | "download" | "print";
export interface ReportPreviewTask {
  taskId: string;
  kind: "query" | "import" | "export" | "print";
  stage: ReportPreviewTaskStage;
  status: "running" | "completed" | "cancelled" | "failed";
  /** Counts refer to the current stage, not an invented overall percentage. */
  completed?: number;
  total?: number;
  cancellable: boolean;
}

export interface ReportPreviewDiagnostic {
  code: string;
  severity: "warning" | "error" | "info";
  message: string;
  path?: string;
  format?: OutputFormat;
  pageIndex?: number;
  componentIndex?: number;
  componentPath?: readonly number[];
}
