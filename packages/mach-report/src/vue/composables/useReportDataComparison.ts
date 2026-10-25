import type { Ref } from "vue";
import type { RenderPlan, ReportCellSource } from "../../schema/render-plan";
import { ReportDataError } from "../../processing/data-records";
import { indexReportDataCells, reportDataSnapshotFromPlan } from "../../editing/data-source";
import { compareReportData, type ReportDataDifference, type ReportDataComparison } from "../../processing/data-comparison";
import type { ReportCellAddress } from "../../editing/context";
import { reportCellEditKey } from "../../editing/batch";
import type { ReportDataComparisonReviewOptions } from "../data-review";
import { resolveReportReviewScope } from "../report-data-scope";
import { useReportDataReview, type ReportDataReviewState } from "./useReportDataReview";

export interface ReportDataComparisonHost {
  plan: Ref<RenderPlan | null>;
  options: Readonly<Ref<ReportDataComparisonReviewOptions | false | undefined>>;
  blocked(): boolean;
  locate?(address: ReportCellAddress): void;
  onError?(message: string, cause: unknown): void;
}
export interface ReportDataComparisonState extends ReportDataReviewState<ReportDataComparison> {
  locate(item: ReportDataDifference): boolean;
}
export function useReportDataComparison(host: ReportDataComparisonHost): ReportDataComparisonState {
  const review = useReportDataReview(host, (plan, options, rows) => {
    const sourceScope = resolveReportReviewScope(plan, options);
    const current = reportDataSnapshotFromPlan(plan, { ...options, sourceScope, fields: options.fields.map(field => field.field) });
    const provided = new Set<string>();
    for (const row of current.rows) for (const field of Object.keys(row.values)) provided.add(field);
    if (!options.fields.every(({ field }) => provided.has(field))) throw new ReportDataError("identity", "Comparison fields are not present in the current report; check visible field mappings");
    return compareReportData({ sourceScope, datasetId: options.datasetId, rows }, current, options);
  });
  function locate(item: ReportDataDifference): boolean {
    const plan = host.plan.value, options = host.options.value;
    if (!plan || !options || !host.locate || item.kind === "removed") return false;
    const sourceScope = review.result.value?.sourceScope;
    const source: ReportCellSource = { sourceScope, datasetId: options.datasetId, rowKey: item.rowKey, field: item.field };
    const cells = indexReportDataCells(plan, { ...options, sourceScope, fields: [item.field] });
    const target = cells.get(reportCellEditKey({ source, address: { pageIndex: 0, componentIndex: 0, rowIndex: 0, columnIndex: 0 } }));
    if (!target || target.ambiguous) return false;
    host.locate({ ...target.context.address }); return true;
  }
  return { ...review, locate };
}
