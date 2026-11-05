<script setup lang="ts">
import { computed } from "vue";
import {
  calculationErrorMessage,
  type ReportCalculationMessages,
  type ReportSelectionCalculationState,
} from "./composables/useSelectionCalculation";
const props = defineProps<{
  state: ReportSelectionCalculationState;
  messages: ReportCalculationMessages;
}>();
const summary = computed(() => props.state.summary.result.value);
const average = computed(() => {
  const value = summary.value;
  return value?.numericCells && value.value !== null
    ? value.value / value.numericCells
    : null;
});
const diagnostic = computed(() => calculationErrorMessage(props.messages, props.state.summary.error.value));
</script>
<template>
  <div
    class="mrp-selection-summary"
    :aria-label="messages.calculationSummary"
    role="status"
    :aria-busy="state.summary.busy.value"
    :title="messages.calculationLocal"
  >
    <span class="mrp-summary-label">{{ messages.calculationSummary }}</span>
    <span v-if="state.summary.busy.value">{{
      messages.calculationPending
    }}</span>
    <span v-else-if="state.summary.requiresConfirmation.value">{{
      messages.calculationMixedColumns
    }}</span>
    <span v-else-if="diagnostic">{{ diagnostic }}</span>
    <template v-else-if="summary">
<span>{{ messages.calculationSummarySum }}
        <strong>{{ summary.value ?? "—" }}</strong></span><span>{{ messages.calculationSummaryAverage }}
        <strong>{{ average ?? "—" }}</strong></span><span>{{ messages.calculationSummaryCount }}
        <strong>{{ summary.numericCells }}</strong></span>
</template>
    <span v-else>{{ messages.calculationHint }}</span>
  </div>
</template>
<style scoped>
.mrp-selection-summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  min-width: 0;
  color: var(--mrp-toolbar-fg);
  font-size: 11px;
}
.mrp-selection-summary strong {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
</style>
