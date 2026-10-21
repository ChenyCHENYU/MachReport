<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import ReportParamPanel from "../vue/ReportParamPanel.vue";
import { DEFAULT_MESSAGES } from "../vue/config";
import { useReportBatch, type ReportBatchPanelOptions, type ReportBatchReceipt, type ReportBatchRow } from "./useReportBatch";
const props = defineProps<ReportBatchPanelOptions>();
const emit = defineEmits<{ (event: "open-instance", receipt: ReportBatchReceipt): void }>();
const editor = useReportBatch(props);
const { m, rows, validations, running, cancelling, attempted, error, progress, failures, unfinished, cancelled, maximum } = editor;
const root = ref<HTMLElement>();
const page = ref(1), pageSize = 10;
type BatchFilter = "all" | ReportBatchRow["status"];
const filter = ref<BatchFilter>("all"), locatedKey = ref<number>(), failureKey = ref<number>();
const indexedRows = computed(() => rows.value.map((row, index) => ({ row, index })));
const filteredRows = computed(() => indexedRows.value.filter(({ row }) => filter.value === "all" || row.status === filter.value));
const pages = computed(() => Math.max(1, Math.ceil(filteredRows.value.length / pageSize)));
const visibleRows = computed(() => filteredRows.value.slice((page.value - 1) * pageSize, page.value * pageSize));
const pageLabel = computed(() => m.value.batchPage.replace("{page}", String(page.value)).replace("{pages}", String(pages.value)).replace("{total}", String(filteredRows.value.length)));
watch(pages, value => { page.value = Math.min(page.value, value); });
watch(filter, () => { page.value = 1; });
const paramMessages = computed(() => ({ ...DEFAULT_MESSAGES, ...props.paramMessages }));
const summary = computed(() => m.value.batchProgress.replace("{completed}", String(progress.value.completed)).replace("{total}", String(progress.value.total)).replace("{failed}", String(progress.value.failed)).replace("{cancelled}", String(progress.value.cancelled)));
const filters = computed(() => {
  const counts = { all: rows.value.length, pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
  for (const row of rows.value) counts[row.status]++;
  return (Object.keys(counts) as BatchFilter[]).filter(value => value !== "running" || running.value || counts.running > 0 || filter.value === "running")
    .map(value => ({ value, count: counts[value], label: value === "all" ? m.value.batchAll : status({ status: value }) }));
});
function status(row: Pick<ReportBatchRow, "status">): string {
  const labels = { pending: m.value.batchPending, running: m.value.batchRunning, completed: m.value.batchCompleted, failed: m.value.batchFailed, cancelled: m.value.batchCancelled };
  return labels[row.status];
}
async function add(copy?: ReportBatchRow): Promise<void> {
  const row = editor.add(copy); if (!row) return;
  await locate(row.key, "all");
  rowElement(row.key)?.querySelector<HTMLElement>('.mrp-param-input')?.focus();
}
function rowElement(key: number): HTMLElement | null | undefined {
  return root.value?.querySelector<HTMLElement>(`[data-batch-key="${key}"]`);
}
async function locate(key: number, nextFilter: BatchFilter): Promise<void> {
  filter.value = nextFilter; await nextTick();
  const index = filteredRows.value.findIndex(({ row }) => row.key === key);
  if (index < 0) return;
  page.value = Math.floor(index / pageSize) + 1; locatedKey.value = key; await nextTick();
}
async function nextFailure(): Promise<void> {
  const candidates = rows.value.filter(row => row.status === "failed");
  const index = candidates.findIndex(row => row.key === failureKey.value);
  const row = candidates[(index + 1) % candidates.length]; if (!row) return;
  failureKey.value = row.key; await locate(row.key, "failed"); rowElement(row.key)?.focus();
}
async function run(retry = false): Promise<void> {
  const pending = editor.run(retry);
  if (editor.invalidKey.value !== undefined) {
    const key = editor.invalidKey.value; await locate(key, "all");
    rowElement(key)?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }
  await pending;
}
</script>

<template>
  <section ref="root" class="mr-batch" :aria-label="m.batchTitle" :aria-busy="running">
    <header class="mr-batch__heading"><div><strong>{{ m.batchTitle }}</strong><p>{{ m.batchDescription }}</p></div><button type="button" :disabled="readonly || running || rows.length >= maximum" @click="add()">+ {{ m.batchAdd }}</button></header>
    <div v-if="rows.length" class="mr-batch__toolbar"><div class="mr-batch__filters" role="group" :aria-label="m.batchFilter"><button v-for="item in filters" :key="item.value" type="button" :aria-pressed="filter === item.value" @click="filter = item.value">{{ item.label }} <span>{{ item.count }}</span></button></div><button v-if="failures" type="button" class="mr-batch__next-failure" :disabled="running" @click="nextFailure">{{ m.batchNextFailure }} ↓</button></div>
    <div v-if="!rows.length" class="mr-batch__empty">{{ m.batchEmpty }}</div>
    <div v-else-if="!filteredRows.length" class="mr-batch__empty">{{ m.batchNoMatches }}</div>
    <div v-else class="mr-batch__rows">
      <article v-for="{ row, index } in visibleRows" :key="row.key" class="mr-batch__row" :class="[`is-${row.status}`, { 'is-located': row.key === locatedKey }]" :data-batch-key="row.key" tabindex="-1" :aria-label="`${m.batchCase} ${index + 1} · ${status(row)}`">
        <header><div><strong>{{ m.batchCase }} {{ index + 1 }}</strong><span class="mr-batch__status" role="status">{{ status(row) }}</span></div><div class="mr-batch__row-actions"><button type="button" :aria-label="`${row.status === 'completed' ? m.batchDuplicateCompleted : m.batchDuplicate} ${index + 1}`" :disabled="readonly || running || rows.length >= maximum" @click="add(row)">{{ row.status === 'completed' ? m.batchDuplicateCompleted : m.batchDuplicate }}</button><button type="button" :aria-label="`${m.batchRemove} ${index + 1}`" :disabled="readonly || running" @click="editor.remove(row.key)">×</button></div></header>
        <ReportParamPanel :defs="paramDefs" :model-value="row.item.params" :messages="paramMessages" :attempted="attempted" :issues="validations[index]?.issues" :show-actions="false" :show-title="false" :disabled="readonly || running || row.status === 'completed'" @update:model-value="editor.setParams(row.key, $event)" />
        <p v-if="row.status === 'completed'" class="mr-batch__hint">{{ m.batchCompletedHint }}</p>
        <p v-if="row.status === 'failed' && row.error" class="mr-batch__row-error" role="alert">{{ row.error }}</p>
        <div v-if="row.status === 'completed'" class="mr-batch__receipt"><span :title="row.receipt?.label || row.receipt?.instanceId">{{ row.receipt?.label || (row.receipt?.instanceId ? row.receipt.instanceId : m.batchNoInstance) }}</span><button v-if="row.receipt?.instanceId" type="button" @click="emit('open-instance', { ...row.receipt })">{{ m.batchOpen }} ↗</button></div>
      </article>
    </div>
    <p v-if="error" class="mr-batch__error" role="alert">{{ error }}</p>
    <footer><div class="mr-batch__progress" aria-live="polite"><template v-if="progress.total"><progress :value="progress.completed" :max="progress.total" :aria-label="summary"></progress><span>{{ summary }}</span></template><span v-else>{{ rows.length }} / {{ maximum }}</span></div><div class="mr-batch__actions"><button v-if="failures && !running" type="button" :disabled="readonly" @click="run(true)">{{ m.batchRetry }} ({{ failures }})</button><button v-if="running" type="button" :disabled="cancelling" @click="editor.cancel">{{ cancelling ? m.batchCancelling : m.batchCancel }}</button><button v-else type="button" class="is-primary" :disabled="readonly || !unfinished" @click="run()">{{ cancelled ? m.batchContinue : m.batchRun }}<template v-if="unfinished"> ({{ unfinished }})</template></button></div><nav v-if="pages > 1" class="mr-batch__pagination" :aria-label="m.batchPages"><span>{{ pageLabel }}</span><button type="button" :disabled="page <= 1" @click="page--">{{ m.batchPrevious }}</button><button type="button" :disabled="page >= pages" @click="page++">{{ m.batchNext }}</button></nav></footer>
  </section>
</template>

<style scoped src="./report-batch.css"></style>
