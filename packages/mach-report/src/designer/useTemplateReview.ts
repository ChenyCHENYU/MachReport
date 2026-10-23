import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import {
  reviewReportTemplateAsync,
  type ReportTemplateReviewProgress,
  type DatasetContract,
  type DatasetRows,
  type OutputFormat,
  type ReportTemplateDocument,
  type ReportTemplateReview,
  type ReportTemplateFixture,
} from "@agile-team/mach-report";

export interface TemplateReviewOptions {
  document: ReportTemplateDocument;
  previous?: ReportTemplateDocument;
  datasets?: DatasetRows;
  dataSchemas?: Readonly<Record<string, DatasetContract>>;
  formats?: readonly OutputFormat[];
  /** Explicit, already de-identified examples; no business data is fetched by the editor. */
  fixtures?: readonly ReportTemplateFixture[];
}
/** A result belongs to one exact input revision; changing any reviewed input invalidates it. */
export function useTemplateReview(
  props: TemplateReviewOptions,
  fixturesInput: () => readonly ReportTemplateFixture[] | undefined = () =>
    props.fixtures,
) {
  const report = shallowRef<ReportTemplateReview>();
  const checkedFixtures = shallowRef<readonly ReportTemplateFixture[]>([]);
  const sampleSize = ref("20"),
    acknowledged = ref(false),
    running = ref(false);
  const stale = ref(false),
    failure = ref("");
  const progress = shallowRef<ReportTemplateReviewProgress>(),
    cancelled = ref(false);
  const checkedScope = shallowRef<{
    requested: string;
    rows: number;
    datasets: number;
    formats: readonly OutputFormat[];
  }>();
  const treeDatasets = computed(
    () =>
      new Set(
        props.document.template.pages
          .flatMap((page) => page.components)
          .flatMap((component) =>
            component.kind === "list" && component.tree
              ? [component.dataset]
              : [],
          ),
      ),
  );
  const hasTree = computed(() => treeDatasets.value.size > 0);
  let revision = 0,
    controller: AbortController | undefined;
  function invalidate(): void {
    revision++;
    controller?.abort();
    controller = undefined;
    running.value = false;
    cancelled.value = false;
    progress.value = undefined;
    stale.value = !!report.value;
    failure.value = "";
  }
  // Deep watching tracks in-place edits too; no repeated serialization or hashing of large datasets.
  for (const input of [() => props.document, () => props.previous])
    watch(
      input,
      () => {
        acknowledged.value = false;
        invalidate();
      },
      { deep: true, flush: "sync" },
    );
  for (const input of [
    () => props.datasets,
    () => props.dataSchemas,
    () => props.formats,
    fixturesInput,
  ])
    watch(input, invalidate, { deep: true, flush: "sync" });
  watch([sampleSize, acknowledged], invalidate, { flush: "sync" });
  onBeforeUnmount(() => {
    revision++;
    controller?.abort();
  });
  const errors = computed(
    () =>
      report.value?.issues.filter((issue) => issue.severity === "error")
        .length ?? 0,
  );
  function run(): void {
    controller?.abort();
    controller = new AbortController();
    const job = ++revision,
      current = controller;
    running.value = true;
    failure.value = "";
    cancelled.value = false;
    progress.value = undefined;
    void execute(job, current);
  }
  async function execute(job: number, current: AbortController): Promise<void> {
    try {
      const limit = Number(sampleSize.value);
      const datasets = Object.fromEntries(
        Object.entries(props.datasets ?? {}).map(([name, rows]) => [
          name,
          limit < 0 || treeDatasets.value.has(name)
            ? rows
            : rows.slice(0, limit),
        ]),
      );
      const named = fixturesInput();
      const fixtures = named?.length
        ? [...named]
        : limit === 0
          ? []
          : [{ name: sampleSize.value, datasets }];
      const result = await reviewReportTemplateAsync(props.document, {
        previous: props.previous,
        dataSchemas: props.dataSchemas,
        formats: props.formats,
        allowBreakingChanges: acknowledged.value,
        ...(!named?.length && hasTree.value && limit > 0
          ? { maxSampleRows: limit }
          : {}),
        fixtures,
        signal: current.signal,
        onProgress: (value) => {
          if (job === revision) progress.value = value;
        },
      });
      if (job !== revision) return;
      report.value = result;
      stale.value = false;
      checkedFixtures.value = fixtures;
      checkedScope.value = {
        requested: sampleSize.value,
        rows: result.samples.reduce((sum, sample) => sum + sample.rows, 0),
        datasets: new Set(
          fixtures.flatMap((fixture) => Object.keys(fixture.datasets)),
        ).size,
        formats: [...(props.formats ?? [])],
      };
    } catch (cause) {
      if (job === revision && !current.signal.aborted)
        failure.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (job === revision) {
        running.value = false;
        controller = undefined;
      }
    }
  }
  function cancel(): void {
    revision++;
    controller?.abort();
    controller = undefined;
    running.value = false;
    cancelled.value = true;
    progress.value = undefined;
  }
  return {
    report,
    sampleSize,
    acknowledged,
    running,
    stale,
    failure,
    checkedScope,
    checkedFixtures,
    hasTree,
    errors,
    run,
    cancel,
    progress,
    cancelled,
  };
}
