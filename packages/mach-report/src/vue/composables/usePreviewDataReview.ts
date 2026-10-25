import { computed, ref, watch, type Ref } from "vue";
import type { RenderPlan } from "../../schema/render-plan";
import type { ReportCellAddress, ReportCellContext } from "../../editing/context";
import type { ReportCellInput } from "../../editing/batch";
import type { ReportValidationIssue } from "../../editing/validation";
import { indexReportDataCells } from "../../editing/data-source";
import { reportCellEditKey } from "../../editing/batch";
import type { ReportEditingOptions } from "../editing";
import type { ReportDataComparisonReviewOptions, ReportPrefillReviewOptions, ReportDataReviewTool } from "../data-review";
import { resolveDataReviewMessages, type MachReportMessages } from "../config";
import { useReportPrefill } from "./useReportPrefill";
import { useReportDataComparison } from "./useReportDataComparison";

interface PreviewDataReviewHost {
  plan: Ref<RenderPlan | null>;
  prefill: Readonly<Ref<ReportPrefillReviewOptions | false | undefined>>;
  comparison: Readonly<Ref<ReportDataComparisonReviewOptions | false | undefined>>;
  editingOptions: Readonly<Ref<boolean | ReportEditingOptions>>;
  issues: Readonly<Ref<readonly ReportValidationIssue[]>>;
  messages: Readonly<Ref<MachReportMessages>>;
  busy(): boolean;
  replacing(): boolean;
  settle(): boolean | Promise<boolean>;
  editError(): string | null;
  apply(inputs: readonly ReportCellInput[]): Promise<boolean>;
  locate(address: ReportCellAddress): void;
  missing(): void;
  error(message: string, cause: unknown): void;
}
/** Preview integration stays small; loaders and atomic edits retain their existing owners. */
export function usePreviewDataReview(host: PreviewDataReviewHost) {
  const opened = ref<ReportDataReviewTool | null>(null);
  const messages = computed(() => ({ ...host.messages.value, ...resolveDataReviewMessages(host.messages.value) }));
  const availablePrefill = computed(() => !!host.prefill.value && typeof host.prefill.value.load === "function");
  const availableComparison = computed(() => !!host.comparison.value && typeof host.comparison.value.load === "function");
  function canEdit(context: ReportCellContext): boolean { const option = host.editingOptions.value; return !!option && (typeof option !== "object" || option.canEdit?.(context) !== false); }
  const prefill = useReportPrefill({
    plan: host.plan, options: host.prefill, blocked: host.busy, canEdit, apply: async inputs => { const success = await host.apply(inputs); if (!success && host.issues.value.length) opened.value = "validation"; return success; }, failure: host.editError, onError: host.error,
    applyBlocked: () => {
      const option = host.editingOptions.value;
      if (!option) return host.messages.value.editReadOnly;
      if (typeof option === "object" && option.save && !option.saveBatch && (prefill.result.value?.edits.length ?? 0) > 1) return host.messages.value.editAtomicRequired;
      return undefined;
    }
  });
  const comparison = useReportDataComparison({ plan: host.plan, options: host.comparison, blocked: host.busy, onError: host.error, locate: address => { close(); host.locate(address); } });
  function close(): void { opened.value = null; prefill.cancel(); comparison.cancel(); }
  async function open(tool: ReportDataReviewTool): Promise<void> {
    if (host.busy()) return;
    if (tool === "prefill" && !availablePrefill.value || tool === "comparison" && !availableComparison.value || tool === "validation" && !host.issues.value.length) return;
    if (!await host.settle() || host.busy()) return;
    opened.value = tool;
  }
  const title = computed(() => opened.value === "prefill" ? messages.value.prefillTitle : opened.value === "comparison" ? messages.value.comparisonTitle : host.messages.value.validationTitle ?? "数据校验");
  const validationMessages = computed(() => ({ title: host.messages.value.validationTitle, error: host.messages.value.validationError, warning: host.messages.value.validationWarning, locate: messages.value.reviewLocate, dataset: host.messages.value.validationDataset, row: host.messages.value.validationRow, more: host.messages.value.validationMore }));
  function locateIssue(issue: ReportValidationIssue): void {
    const plan = host.plan.value;
    if (!plan || issue.rowKey === undefined || !issue.dataset || !issue.field) { host.missing(); return; }
    const cells = indexReportDataCells(plan, { datasetId: issue.dataset, sourceScope: issue.sourceScope, fields: [issue.field] });
    const key = reportCellEditKey({ source: { sourceScope: issue.sourceScope, datasetId: issue.dataset, rowKey: issue.rowKey, field: issue.field }, address: { pageIndex: 0, componentIndex: 0, rowIndex: 0, columnIndex: 0 } });
    const target = cells.get(key);
    if (!target || target.ambiguous) { host.missing(); return; }
    close(); host.locate({ ...target.context.address });
  }
  const reset = () => { close(); prefill.clear(); comparison.clear(); };
  // Plans publish by replacement. Never traverse thousands of immutable cells to watch a toolbar.
  watch(host.plan, reset, { flush: "sync" });
  watch([() => host.replacing(), host.prefill, host.comparison], reset, { deep: true, flush: "sync" });
  watch(host.issues, issues => { if (opened.value === "validation" && !issues.length) close(); });
  return { opened, messages, availablePrefill, availableComparison, prefill, comparison, title, validationMessages, open, close, locateIssue };
}
