import type { ReportCellContext, ReportCellEdit } from "../editing";

export interface ReportEditOperation {
  /** Reload, another import or unmount aborts the operation. Save adapters should forward this signal. */
  signal: AbortSignal;
}

/** Opt in with true for local drafts, or provide host validation and persistence. */
export interface ReportEditingOptions {
  canEdit?(context: ReportCellContext): boolean;
  /** Return an error message or throw to reject the edit. */
  validate?(edit: Readonly<ReportCellEdit>, operation: ReportEditOperation): void | string | Promise<void | string>;
  /** Called before applying the change. A rejection leaves the current report untouched. */
  save?(edit: Readonly<ReportCellEdit>, operation: ReportEditOperation): void | Promise<void>;
}
