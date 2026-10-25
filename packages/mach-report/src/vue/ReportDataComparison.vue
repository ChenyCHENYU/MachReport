<script setup lang="ts">
import { formatDecimal } from "../processing/decimal";
import type { ReportDataReviewMessages, ReportReviewRow } from "./data-review";
import type { ReportDataComparisonState } from "./composables/useReportDataComparison";
import ReportDataReviewTable from "./ReportDataReviewTable.vue";
const props = defineProps<{ state: ReportDataComparisonState; messages: ReportDataReviewMessages }>();
function row(index: number): ReportReviewRow {
  const item = props.state.result.value!.differences[index]!, m = props.messages;
  return { rowKey: item.rowKey, label: item.label, before: item.before, after: item.after, delta: item.delta, ratio: item.changeRatio === undefined ? undefined : formatDecimal(item.changeRatio, undefined, false, true), status: { added: m.comparisonAdded, removed: m.comparisonRemoved, changed: m.comparisonChanged }[item.kind], tone: item.kind, locatable: item.kind !== "removed" };
}
function locate(index: number): void { const item = props.state.result.value?.differences[index]; if (item) props.state.locate(item); }
</script>
<template>
  <section class="mrp-data-review" :aria-label="messages.comparisonTitle" :aria-busy="state.busy.value">
    <header class="mrp-review-heading"><span class="mrp-review-symbol" aria-hidden="true">⇄</span><div><strong>{{ messages.comparisonTitle }}</strong><p>{{ messages.comparisonHint }}</p></div><button v-if="state.busy.value" type="button" @click="state.cancel()">{{ messages.reviewCancel }}</button><button v-else type="button" @click="state.run()">{{ messages.comparisonLoad }}</button></header>
    <p v-if="state.error.value" class="mrp-review-error" role="alert">{{ state.error.value }}</p>
    <template v-if="state.result.value"><div class="mrp-review-summary" role="status"><span data-tone="added">{{ messages.comparisonAdded }} <b>{{ state.result.value.counts.added }}</b></span><span data-tone="removed">{{ messages.comparisonRemoved }} <b>{{ state.result.value.counts.removed }}</b></span><span data-tone="changed">{{ messages.comparisonChanged }} <b>{{ state.result.value.counts.changed }}</b></span><span>{{ messages.comparisonUnchanged }} <b>{{ state.result.value.counts.unchanged }}</b></span></div><ReportDataReviewTable :count="state.result.value.differences.length" :row="row" :messages="messages" delta @locate="locate" /></template>
  </section>
</template>
<style src="./data-review.css"></style>
