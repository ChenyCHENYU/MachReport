import type { ReportCellValue } from "../editing/context";
import type { ReportDataLimits, ReportDataRecord } from "../processing/data-records";
import type { ReportDataComparisonField } from "../processing/data-comparison";
import type { ReportPrefillField } from "../editing/prefill";

export interface ReportDataReviewSource extends ReportDataLimits {
  sourceScope?: string;
  datasetId: string;
  label?: string;
  /** The host chooses history/instances; this package never guesses an endpoint or period. */
  load(operation: { signal: AbortSignal }): readonly ReportDataRecord[] | Promise<readonly ReportDataRecord[]>;
  /** Cancel loaders that do not finish; default 15 seconds, bounded at 120 seconds. */
  timeoutMs?: number;
}
export interface ReportPrefillReviewOptions extends ReportDataReviewSource {
  fields: readonly ReportPrefillField[];
  mode?: "empty" | "replace";
  maxChanges?: number;
}
export interface ReportDataComparisonReviewOptions extends ReportDataReviewSource {
  fields: readonly ReportDataComparisonField[];
  maxDifferences?: number;
}
export interface ReportDataReviewMessages {
  prefillTitle: string;
  prefillHint: string;
  prefillCurrent: string;
  prefillReference: string;
  prefillLoad: string;
  prefillApply: string;
  prefillMatched: string;
  prefillChanged: string;
  prefillSkipped: string;
  prefillConflict: string;
  prefillUnchanged: string;
  prefillReadonly: string;
  prefillOccupied: string;
  prefillMissingSource: string;
  prefillMissingTarget: string;
  prefillAmbiguous: string;
  prefillInvalid: string;
  comparisonTitle: string;
  comparisonHint: string;
  comparisonLoad: string;
  comparisonAdded: string;
  comparisonRemoved: string;
  comparisonChanged: string;
  comparisonUnchanged: string;
  reviewCancel: string;
  reviewClose: string;
  reviewBefore: string;
  reviewAfter: string;
  reviewField: string;
  reviewKey: string;
  reviewDelta: string;
  reviewRatio: string;
  reviewLocate: string;
  reviewEmpty: string;
  reviewPrevious: string;
  reviewNext: string;
  reviewPage: string;
}

export type ReportDataReviewTool = "prefill" | "comparison" | "validation";
export interface ReportReviewRow { rowKey: string | number; label: string; before?: ReportCellValue; after?: ReportCellValue; status: string; tone: string; delta?: string; ratio?: string; locatable?: boolean }
