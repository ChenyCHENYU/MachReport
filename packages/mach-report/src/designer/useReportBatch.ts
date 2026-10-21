import { computed, onBeforeUnmount, ref, watch } from "vue";
import { validateReportParams, type ReportParamDef } from "@agile-team/mach-report";
import { runReportBatch, snapshotReportBatchCases, type ReportBatchCase, type ReportBatchOutcome, type ReportBatchProgress } from "../server/batch";
import type { MachReportMessages } from "../vue/config";
import { REPORT_BATCH_MESSAGES, type ReportBatchMessages } from "./batch-messages";

export interface ReportBatchReceipt { instanceId?: string; label?: string }
export interface ReportBatchPanelOptions {
  paramDefs: ReportParamDef[];
  execute(item: ReportBatchCase, context: { index: number; signal: AbortSignal }): Promise<ReportBatchReceipt>;
  initialCases?: ReportBatchCase[];
  readonly?: boolean;
  concurrency?: number;
  maxCases?: number;
  messages?: Partial<ReportBatchMessages>;
  paramMessages?: Partial<MachReportMessages>;
}
export interface ReportBatchRow {
  key: number;
  item: ReportBatchCase;
  status: "pending" | "running" | ReportBatchOutcome<ReportBatchReceipt>["status"];
  receipt?: ReportBatchReceipt;
  error?: string;
  /** A changed request must never reuse the identity of a previously submitted intent. */
  submitted?: boolean;
}

/** Extract a bounded receipt; never retain an arbitrary business response or generated file. */
function receipt(value: ReportBatchReceipt): ReportBatchReceipt {
  const next: ReportBatchReceipt = {};
  if (!value || typeof value !== "object") return next;
  if (typeof value.instanceId === "string" && value.instanceId.length > 0 && value.instanceId.length <= 512) next.instanceId = value.instanceId;
  if (typeof value.label === "string") next.label = value.label.slice(0, 512);
  return next;
}
function initialValues(defs: readonly ReportParamDef[]): Record<string, string> {
  return Object.fromEntries((Array.isArray(defs) ? defs : []).filter(def => def && typeof def.field === "string").map(def => [def.field, def.defaultValue ?? ""]));
}
function textError(error: unknown): string { return (error instanceof Error ? error.message : String(error)).slice(0, 1000); }
function initialCases(props: ReportBatchPanelOptions): { cases: ReportBatchCase[]; error: string } {
  try { return { cases: snapshotReportBatchCases(props.initialCases ?? [], props.maxCases ?? 100), error: "" }; }
  catch (cause) { return { cases: [], error: textError(cause) }; }
}

export function useReportBatch(props: ReportBatchPanelOptions) {
  let nextKey = 0;
  const toRow = (item: ReportBatchCase): ReportBatchRow => ({ key: ++nextKey, item: { id: item.id, params: { ...item.params } }, status: "pending" });
  const initial = initialCases(props);
  const initialIds = new Set(initial.cases.map(item => item.id));
  let nextCaseId = initial.cases.length + 1;
  const rows = ref<ReportBatchRow[]>(initial.cases.map(toRow));
  const running = ref(false), cancelling = ref(false), attempted = ref(false), error = ref(initial.error);
  const invalidKey = ref<number>();
  const progress = ref<ReportBatchProgress>({ completed: 0, total: 0, failed: 0, cancelled: 0 });
  const m = computed(() => ({ ...REPORT_BATCH_MESSAGES, ...props.messages }));
  const validations = computed(() => rows.value.map(row => validateReportParams(props.paramDefs, row.item.params)));
  const failures = computed(() => rows.value.filter(row => row.status === "failed").length);
  const unfinished = computed(() => rows.value.filter(row => row.status === "pending" || row.status === "cancelled").length);
  const cancelled = computed(() => rows.value.filter(row => row.status === "cancelled").length);
  const maximum = computed(() => props.maxCases ?? 100);
  let controller: AbortController | undefined, generation = 0;
  function newCase(values = initialValues(props.paramDefs)): ReportBatchCase {
    while (initialIds.has(`case-${nextCaseId}`)) nextCaseId++;
    const id = `case-${nextCaseId++}`;
    return { id, params: { ...values } };
  }
  function add(copy?: ReportBatchRow): ReportBatchRow | undefined {
    if (props.readonly || running.value) return;
    if (rows.value.length >= maximum.value) { error.value = m.value.batchLimit.replace("{count}", String(maximum.value)); return; }
    const row = toRow(newCase(copy?.item.params));
    rows.value.push(row); error.value = ""; return row;
  }
  function remove(key: number): void { if (!running.value && !props.readonly) rows.value = rows.value.filter(row => row.key !== key); }
  function setParams(key: number, params: Record<string, string>): void {
    if (running.value || props.readonly) return;
    const row = rows.value.find(item => item.key === key);
    if (!row || row.status === "completed" || JSON.stringify(row.item.params) === JSON.stringify(params)) return;
    row.item = row.submitted ? newCase(params) : { ...row.item, params: { ...params } };
    row.submitted = false; row.status = "pending"; delete row.receipt; delete row.error;
  }
  function cancel(): void { if (running.value) { cancelling.value = true; controller?.abort(); } }
  function selectedRows(retry: boolean): ReportBatchRow[] {
    return rows.value.filter(row => retry ? row.status === "failed" : row.status === "pending" || row.status === "cancelled");
  }
  function runInputs(selected: ReportBatchRow[]): ReportBatchCase[] | undefined {
    const checked = selected.map(row => validateReportParams(props.paramDefs, row.item.params));
    const invalid = checked.findIndex(result => !result.ok);
    if (invalid >= 0) { invalidKey.value = selected[invalid]!.key; error.value = m.value.batchInvalid; return undefined; }
    return selected.map((row, index) => ({ id: row.item.id, params: { ...checked[index]!.values } }));
  }
  function applyOutcome(row: ReportBatchRow, outcome: ReportBatchOutcome<ReportBatchReceipt>): void {
    row.status = outcome.status;
    if (outcome.status === "completed") row.receipt = outcome.value;
    if (outcome.status === "failed") row.error = outcome.error.message.slice(0, 1000);
  }
  async function executeRow(row: ReportBatchRow, item: ReportBatchCase, context: { index: number; signal: AbortSignal }, job: number, execute: ReportBatchPanelOptions["execute"]): Promise<ReportBatchReceipt> {
    if (job === generation) row.status = "running";
    try {
      const result = receipt(await execute(item, context));
      if (job === generation) { row.receipt = result; row.status = "completed"; }
      return result;
    } catch (cause) {
      if (job === generation) { row.status = context.signal.aborted ? "cancelled" : "failed"; row.error = textError(cause); }
      throw cause;
    }
  }
  async function run(retry = false): Promise<void> {
    if (props.readonly || running.value) return;
    const selected = selectedRows(retry); if (!selected.length) return;
    attempted.value = true; error.value = ""; invalidKey.value = undefined;
    const input = runInputs(selected); if (!input) return;
    const job = ++generation, execute = props.execute; controller = new AbortController(); running.value = true; cancelling.value = false;
    progress.value = { completed: 0, total: selected.length, failed: 0, cancelled: 0 };
    for (const row of selected) { row.status = "pending"; row.submitted = true; delete row.receipt; delete row.error; }
    try {
      const outcomes = await runReportBatch(input, (item, context) => executeRow(selected[context.index]!, item, context, job, execute), {
        concurrency: props.concurrency, maxCases: maximum.value, signal: controller.signal,
        onProgress: value => { if (job === generation) progress.value = value; },
      });
      if (job === generation) outcomes.forEach((outcome, index) => applyOutcome(selected[index]!, outcome));
    } catch (cause) { if (job === generation) error.value = textError(cause); }
    finally { if (job === generation) { running.value = false; cancelling.value = false; controller = undefined; } }
  }
  watch(() => [JSON.stringify(props.paramDefs), props.execute, props.readonly, props.concurrency, props.maxCases], () => {
    if (running.value) { cancel(); error.value = m.value.batchChanged; }
  });
  onBeforeUnmount(() => { generation++; controller?.abort(); });
  return { m, rows, validations, running, cancelling, attempted, error, progress, failures, unfinished, cancelled, maximum, invalidKey, add, remove, setParams, cancel, run };
}
