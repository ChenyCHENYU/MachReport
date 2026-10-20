import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { reviewReportTemplate, type DatasetContract, type DatasetRows, type OutputFormat, type ReportTemplateDocument, type ReportTemplateReview } from "@agile-team/mach-report";

export interface TemplateReviewOptions {
  document: ReportTemplateDocument;
  previous?: ReportTemplateDocument;
  datasets?: DatasetRows;
  dataSchemas?: Readonly<Record<string, DatasetContract>>;
  formats?: readonly OutputFormat[];
}
/** A result belongs to one exact input revision; changing any reviewed input invalidates it. */
export function useTemplateReview(props: TemplateReviewOptions) {
  const report = shallowRef<ReportTemplateReview>();
  const sampleSize = ref("20"), acknowledged = ref(false), running = ref(false);
  const stale = ref(false), failure = ref("");
  const checkedScope = shallowRef<{ requested: string; rows: number; datasets: number; formats: readonly OutputFormat[] }>();
  let revision = 0, timer: ReturnType<typeof setTimeout> | undefined;
  function invalidate(): void {
    revision++; clearTimeout(timer); running.value = false;
    stale.value = !!report.value; failure.value = "";
  }
  // Deep watching tracks in-place edits too; no repeated serialization or hashing of large datasets.
  for (const input of [() => props.document, () => props.previous, () => props.datasets, () => props.dataSchemas, () => props.formats]) watch(input, invalidate, { deep: true, flush: "sync" });
  watch([sampleSize, acknowledged], invalidate, { flush: "sync" });
  onBeforeUnmount(() => { revision++; clearTimeout(timer); });
  const errors = computed(() => report.value?.issues.filter((issue) => issue.severity === "error").length ?? 0);
  function run(): void {
    clearTimeout(timer); const job = revision;
    running.value = true; failure.value = "";
    timer = setTimeout(() => {
      if (job !== revision) return;
      const limit = Number(sampleSize.value);
      const datasets = Object.fromEntries(Object.entries(props.datasets ?? {}).map(([name, rows]) => [name, limit < 0 ? rows : rows.slice(0, limit)]));
      try {
        const result = reviewReportTemplate(props.document, { previous: props.previous, dataSchemas: props.dataSchemas, formats: props.formats, allowBreakingChanges: acknowledged.value,
          fixtures: limit === 0 ? [] : [{ name: sampleSize.value, datasets }] });
        if (job !== revision) return;
        report.value = result; stale.value = false;
        checkedScope.value = { requested: sampleSize.value, rows: limit === 0 ? 0 : Object.values(datasets).reduce((sum, rows) => sum + rows.length, 0), datasets: limit === 0 ? 0 : Object.keys(datasets).length, formats: [...(props.formats ?? [])] };
      } catch (cause) { failure.value = cause instanceof Error ? cause.message : String(cause); }
      finally { if (job === revision) running.value = false; }
    }, 0);
  }
  return { report, sampleSize, acknowledged, running, stale, failure, checkedScope, errors, run };
}
