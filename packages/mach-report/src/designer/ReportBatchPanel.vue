<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import ReportParamPanel from "../vue/ReportParamPanel.vue";
import { DEFAULT_MESSAGES } from "../vue/config";
import { useReportBatch, type ReportBatchPanelOptions, type ReportBatchReceipt, type ReportBatchRow } from "./useReportBatch";
const props = defineProps<ReportBatchPanelOptions>();
const emit = defineEmits<{ (event: "open-instance", receipt: ReportBatchReceipt): void }>();
const editor = useReportBatch(props);
const { m, rows, validations, running, cancelling, attempted, error, progress, failures, maximum } = editor;
const root = ref<HTMLElement>();
const page = ref(1), pageSize = 10;
const pages = computed(() => Math.max(1, Math.ceil(rows.value.length / pageSize)));
const visibleRows = computed(() => rows.value.slice((page.value - 1) * pageSize, page.value * pageSize).map((row, index) => ({ row, index: (page.value - 1) * pageSize + index })));
const pageLabel = computed(() => m.value.batchPage.replace("{page}", String(page.value)).replace("{pages}", String(pages.value)).replace("{total}", String(rows.value.length)));
watch(pages, value => { page.value = Math.min(page.value, value); });
const paramMessages = computed(() => ({ ...DEFAULT_MESSAGES, ...props.paramMessages }));
const summary = computed(() => m.value.batchProgress.replace("{completed}", String(progress.value.completed)).replace("{total}", String(progress.value.total)).replace("{failed}", String(progress.value.failed)).replace("{cancelled}", String(progress.value.cancelled)));
function status(row: ReportBatchRow): string {
  const labels = { pending: m.value.batchPending, running: m.value.batchRunning, completed: m.value.batchCompleted, failed: m.value.batchFailed, cancelled: m.value.batchCancelled };
  return labels[row.status];
}
async function add(copy?: ReportBatchRow): Promise<void> {
  const previous = rows.value.length; editor.add(copy);
  if (rows.value.length === previous) return;
  page.value = pages.value; await nextTick();
  root.value?.querySelector<HTMLElement>('.mr-batch__row:last-child .mrp-param-input')?.focus();
}
async function run(retry = false): Promise<void> {
  const pending = editor.run(retry);
  if (editor.invalidKey.value !== undefined) {
    const index = rows.value.findIndex(row => row.key === editor.invalidKey.value);
    page.value = Math.max(1, Math.floor(index / pageSize) + 1); await nextTick();
    root.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }
  await pending;
}
</script>

<template>
  <section ref="root" class="mr-batch" :aria-label="m.batchTitle" :aria-busy="running">
    <header class="mr-batch__heading"><div><strong>{{ m.batchTitle }}</strong><p>{{ m.batchDescription }}</p></div><button type="button" :disabled="readonly || running || rows.length >= maximum" @click="add()">+ {{ m.batchAdd }}</button></header>
    <div v-if="!rows.length" class="mr-batch__empty">{{ m.batchEmpty }}</div>
    <div v-else class="mr-batch__rows">
      <article v-for="{ row, index } in visibleRows" :key="row.key" class="mr-batch__row" :class="`is-${row.status}`">
        <header><div><strong>{{ m.batchCase }} {{ index + 1 }}</strong><span class="mr-batch__status" role="status">{{ status(row) }}</span></div><div class="mr-batch__row-actions"><button type="button" :aria-label="`${m.batchDuplicate} ${index + 1}`" :disabled="readonly || running || rows.length >= maximum" @click="add(row)">{{ m.batchDuplicate }}</button><button type="button" :aria-label="`${m.batchRemove} ${index + 1}`" :disabled="readonly || running" @click="editor.remove(row.key)">×</button></div></header>
        <ReportParamPanel :defs="paramDefs" :model-value="row.item.params" :messages="paramMessages" :attempted="attempted" :issues="validations[index]?.issues" :show-actions="false" :show-title="false" :disabled="readonly || running" @update:model-value="editor.setParams(row.key, $event)" />
        <p v-if="row.status === 'failed' && row.error" class="mr-batch__row-error" role="alert">{{ row.error }}</p>
        <div v-if="row.status === 'completed'" class="mr-batch__receipt"><span>{{ row.receipt?.label || (row.receipt?.instanceId ? row.receipt.instanceId : m.batchNoInstance) }}</span><button v-if="row.receipt?.instanceId" type="button" @click="emit('open-instance', { ...row.receipt })">{{ m.batchOpen }} ↗</button></div>
      </article>
    </div>
    <p v-if="error" class="mr-batch__error" role="alert">{{ error }}</p>
    <footer><div class="mr-batch__progress" aria-live="polite"><template v-if="progress.total"><progress :value="progress.completed" :max="progress.total" :aria-label="summary"></progress><span>{{ summary }}</span></template><span v-else>{{ rows.length }} / {{ maximum }}</span></div><div class="mr-batch__actions"><button v-if="failures && !running" type="button" :disabled="readonly" @click="run(true)">{{ m.batchRetry }} ({{ failures }})</button><button v-if="running" type="button" :disabled="cancelling" @click="editor.cancel">{{ cancelling ? m.batchCancelling : m.batchCancel }}</button><button v-else type="button" class="is-primary" :disabled="readonly || !rows.length" @click="run()">{{ m.batchRun }}</button></div><nav v-if="pages > 1" class="mr-batch__pagination" :aria-label="m.batchPages"><span>{{ pageLabel }}</span><button type="button" :disabled="page <= 1" @click="page--">{{ m.batchPrevious }}</button><button type="button" :disabled="page >= pages" @click="page++">{{ m.batchNext }}</button></nav></footer>
  </section>
</template>

<style scoped src="./report-batch.css"></style>
