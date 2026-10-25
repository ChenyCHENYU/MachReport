<script setup lang="ts">
import { computed } from "vue";
import type { ReportPrefillItem } from "../editing/prefill";
import type { ReportDataReviewMessages, ReportReviewRow } from "./data-review";
import type { ReportPrefillState } from "./composables/useReportPrefill";
import ReportDataReviewTable from "./ReportDataReviewTable.vue";
const props = defineProps<{ state: ReportPrefillState; messages: ReportDataReviewMessages }>();
const tableMessages = computed(() => ({ ...props.messages, reviewBefore: props.messages.prefillCurrent, reviewAfter: props.messages.prefillReference }));
function status(item: ReportPrefillItem): string {
  const m = props.messages;
  if (item.reason) return { unchanged: m.prefillUnchanged, readonly: m.prefillReadonly, occupied: m.prefillOccupied, "missing-source": m.prefillMissingSource, "missing-target": m.prefillMissingTarget, ambiguous: m.prefillAmbiguous, invalid: m.prefillInvalid }[item.reason];
  return m.prefillChanged;
}
function row(index: number): ReportReviewRow { const item = props.state.result.value!.items[index]!; return { rowKey: item.source.rowKey, label: item.label, before: item.before, after: item.after, status: status(item), tone: item.status }; }
</script>
<template>
  <section class="mrp-data-review" :aria-label="messages.prefillTitle" :aria-busy="state.busy.value || state.applying.value">
    <header class="mrp-review-heading"><span class="mrp-review-symbol" aria-hidden="true">↳</span><div><strong>{{ messages.prefillTitle }}</strong><p>{{ messages.prefillHint }}</p></div><button v-if="state.busy.value" type="button" @click="state.cancel()">{{ messages.reviewCancel }}</button><button v-else type="button" :disabled="state.applying.value" @click="state.run()">{{ messages.prefillLoad }}</button></header>
    <p v-if="state.error.value" class="mrp-review-error" role="alert">{{ state.error.value }}</p>
    <template v-if="state.result.value"><div class="mrp-review-summary" role="status"><span data-tone="changed">{{ messages.prefillChanged }} <b>{{ state.result.value.counts.changed }}</b></span><span>{{ messages.prefillMatched }} <b>{{ state.result.value.counts.matched }}</b></span><span>{{ messages.prefillSkipped }} <b>{{ state.result.value.counts.skipped }}</b></span><span :data-tone="state.result.value.counts.conflict ? 'conflict' : undefined">{{ messages.prefillConflict }} <b>{{ state.result.value.counts.conflict }}</b></span></div><ReportDataReviewTable :count="state.result.value.items.length" :row="row" :messages="tableMessages" /><p v-if="state.blockedReason.value" class="mrp-review-blocked" role="status">{{ state.blockedReason.value }}</p><footer class="mrp-review-footer"><button class="mrp-review-primary" type="button" :disabled="!state.canApply.value" @click="state.apply()">{{ messages.prefillApply }} <span v-if="state.result.value.counts.changed">· {{ state.result.value.counts.changed }}</span></button></footer></template>
  </section>
</template>
<style src="./data-review.css"></style>
