import type { ReportCellContext, ReportCellEdit, ReportEditBatch, ReportEditResult } from "../editing";

export interface ReportEditOperation {
  /** Reload, another import or unmount aborts the operation. Save adapters should forward this signal. */
  signal: AbortSignal;
  requestId?: string;
  action?: "edit" | "undo" | "redo" | "restore";
}

/** Opt in with true for local drafts, or provide host validation and persistence. */
export interface ReportEditingOptions {
  canEdit?(context: ReportCellContext): boolean;
  /** Return an error message or throw to reject the edit. */
  validate?(edit: Readonly<ReportCellEdit>, operation: ReportEditOperation): void | string | Promise<void | string>;
  /** Called before applying the change. A rejection leaves the current report untouched. */
  save?(edit: Readonly<ReportCellEdit>, operation: ReportEditOperation): void | ReportEditResult | Promise<void | ReportEditResult>;
  /** Must commit all edits in one server transaction. Required for multi-cell persisted edits. */
  saveBatch?(batch: Readonly<ReportEditBatch>, operation: ReportEditOperation): void | ReportEditResult | Promise<void | ReportEditResult>;
  /** Restrict persistence to plans that supply stable datasetId/rowKey/field metadata. */
  requireSource?: boolean;
}
