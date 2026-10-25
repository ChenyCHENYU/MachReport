import type { ReportCandidateValidationOptions, ReportValidationIssue, ReportCellContext, ReportCellEdit, ReportCellFieldOptions, ReportEditBatch, ReportEditResult } from "../editing";

export interface ReportEditOperation {
  /** Reload, another import or unmount aborts the operation. Save adapters should forward this signal. */
  signal: AbortSignal;
  requestId?: string;
  action?: "edit" | "undo" | "redo" | "restore";
}

/** Opt in with true for local drafts, or provide host validation and persistence. */
export interface ReportEditingOptions {
  /** Optional field controls, keyed by source.field / table.columnKey; a resolver supports dataset-specific rules. */
  fields?: Readonly<Record<string, ReportCellFieldOptions>> | ((context: ReportCellContext) => ReportCellFieldOptions | undefined);
  canEdit?(context: ReportCellContext): boolean;
  /** Return an error message or throw to reject the edit. */
  validate?(edit: Readonly<ReportCellEdit>, operation: ReportEditOperation): void | string | Promise<void | string>;
  /** Same declarative rules can be run in Node via validateReportDataset. Requires a source-backed session. */
  validation?: ReportCandidateValidationOptions;
  /** Optional host batch validation sees the fully recalculated candidate plan. */
  validateBatch?(batch: Readonly<ReportEditBatch>, candidate: import("../schema/render-plan").RenderPlan, operation: ReportEditOperation): void | readonly ReportValidationIssue[] | Promise<void | readonly ReportValidationIssue[]>;
  /** Called before applying the change. A rejection leaves the current report untouched. */
  save?(edit: Readonly<ReportCellEdit>, operation: ReportEditOperation): void | ReportEditResult | Promise<void | ReportEditResult>;
  /** Must commit all edits in one server transaction. Required for multi-cell persisted edits. */
  saveBatch?(batch: Readonly<ReportEditBatch>, operation: ReportEditOperation): void | ReportEditResult | Promise<void | ReportEditResult>;
  /** Restrict persistence to plans that supply stable datasetId/rowKey/field metadata. */
  requireSource?: boolean;
}
