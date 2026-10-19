<script setup lang="ts">
import { computed, getCurrentInstance } from "vue";
import type { ReportCalculationOperation } from "@agile-team/mach-report";
import type { ReportCalculationMessages, ReportSelectionCalculationState } from "./composables/useSelectionCalculation";

const props = defineProps<{ state: ReportSelectionCalculationState; messages: ReportCalculationMessages }>();
const expressionHintId = `mrp-calculation-expression-hint-${getCurrentInstance()?.uid ?? 0}`;
const choices = computed(() => [
  ["sum", props.messages.calculationSum], ["average", props.messages.calculationAverage],
  ["min", props.messages.calculationMin], ["max", props.messages.calculationMax],
  ["count", props.messages.calculationCount], ["median", props.messages.calculationMedian],
  ["expression", props.messages.calculationCustom]
]);
const diagnostic = computed(() => {
  const key = props.state.error.value;
  if (!key) return "";
  const messages = props.messages;
  return { selection: messages.calculationErrorSelection, limit: messages.calculationErrorLimit, expression: messages.calculationErrorExpression, division: messages.calculationErrorDivision, overflow: messages.calculationErrorOverflow, precision: messages.calculationErrorPrecision }[key];
});
</script>

<template>
  <section class="mrp-calculation" :aria-label="messages.calculationTitle" :aria-busy="state.busy.value">
    <header class="mrp-calculation-heading"><span class="mrp-calculation-symbol" aria-hidden="true">∑</span><div><strong>{{ messages.calculationTitle }}</strong><p>{{ messages.calculationHint }}</p></div></header>
    <div class="mrp-calculation-controls">
      <label><span>{{ messages.calculationFormula }}</span><select :aria-label="messages.calculationFormula" :value="state.operation.value" @change="state.setOperation(($event.target as HTMLSelectElement).value as ReportCalculationOperation)" :disabled="state.busy.value"><option v-for="[value, label] in choices" :key="value" :value="value">{{ label }}</option></select></label>
      <label class="mrp-calculation-precision"><span>{{ messages.calculationPrecision }}</span><input :aria-label="messages.calculationPrecision" :value="state.precision.value" @change="state.setPrecision(Number(($event.target as HTMLInputElement).value))" type="number" min="0" max="12" step="1" :disabled="state.busy.value" /></label>
    </div>
    <label v-if="state.operation.value === 'expression'" class="mrp-calculation-expression"><span>{{ messages.calculationExpression }}</span><input :aria-label="messages.calculationExpression" :aria-describedby="expressionHintId" :value="state.expression.value" @input="state.setExpression(($event.target as HTMLInputElement).value)" type="text" maxlength="256" spellcheck="false" :disabled="state.busy.value" placeholder="SUM / COUNT" /><small :id="expressionHintId">{{ messages.calculationExpressionHint }}</small></label>
    <div class="mrp-calculation-actions"><button v-if="state.busy.value" type="button" @click="state.cancel()">{{ messages.calculationCancel }}</button><button v-else class="mrp-calculation-run" type="button" @click="state.run()">{{ messages.calculationRun }}</button></div>
    <p v-if="diagnostic" class="mrp-calculation-diagnostic" role="alert">{{ diagnostic }}</p>
    <div v-else-if="state.result.value" class="mrp-calculation-result" role="status" aria-live="polite"><span>{{ messages.calculationResult }}</span><output>{{ state.result.value.formatted }}</output><small><span>{{ messages.calculationIncluded }} {{ state.result.value.numericCells }}</span><span>{{ messages.calculationExcluded }} {{ state.result.value.excludedCells }}</span></small><p v-if="state.result.value.numericCells === 0">{{ messages.calculationEmpty }}</p></div>
    <p v-else class="mrp-calculation-empty">{{ messages.calculationNoSelection }}</p>
    <p class="mrp-calculation-local">{{ messages.calculationLocal }}</p>
  </section>
</template>

<style scoped>
.mrp-calculation { --calculation-accent: var(--mrp-btn-active-bg, #2964da); padding: 16px; border: 1px solid var(--mrp-toolbar-border); border-radius: 14px; background: var(--mrp-toolbar-bg); color: var(--mrp-toolbar-fg); font-size: 12px; }
.mrp-calculation-heading { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.mrp-calculation-symbol { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; color: var(--calculation-accent); background: color-mix(in srgb, var(--calculation-accent) 10%, transparent); font-size: 24px; }
.mrp-calculation-heading strong { font-size: 14px; font-weight: 650; }
.mrp-calculation-heading p { margin: 4px 0 0; opacity: .7; line-height: 1.5; }
.mrp-calculation-controls { display: flex; gap: 10px; }
.mrp-calculation-controls label { flex: 1; min-width: 0; }
.mrp-calculation-controls .mrp-calculation-precision { flex: 0 0 76px; }
.mrp-calculation label > span { display: block; margin-bottom: 6px; font-weight: 500; }
.mrp-calculation input, .mrp-calculation select { box-sizing: border-box; width: 100%; height: 34px; padding: 0 10px; border: 1px solid var(--mrp-btn-border); border-radius: 8px; color: inherit; background: var(--mrp-toolbar-bg); font: inherit; }
.mrp-calculation :is(input, select, button):focus-visible { outline: 2px solid var(--calculation-accent); outline-offset: 2px; }
.mrp-calculation-expression { display: block; margin-top: 12px; }
.mrp-calculation-expression input { font-family: ui-monospace, monospace; }
.mrp-calculation-expression small { display: block; margin-top: 6px; line-height: 1.6; opacity: .7; overflow-wrap: anywhere; }
.mrp-calculation-actions { display: flex; justify-content: flex-end; margin-top: 12px; }
.mrp-calculation-actions button { min-height: 32px; padding: 0 15px; border: 1px solid var(--mrp-btn-border); border-radius: 8px; background: var(--mrp-btn-bg, transparent); color: inherit; font: inherit; cursor: pointer; }
.mrp-calculation-actions .mrp-calculation-run { background: var(--calculation-accent); color: var(--mrp-btn-active-fg, #fff); border-color: transparent; }
.mrp-calculation button:disabled, .mrp-calculation input:disabled, .mrp-calculation select:disabled { opacity: .55; cursor: not-allowed; }
.mrp-calculation-result { padding: 14px; margin-top: 14px; border-radius: 10px; background: color-mix(in srgb, var(--calculation-accent) 7%, transparent); }
.mrp-calculation-result output { display: block; margin: 6px 0 10px; color: var(--calculation-accent); font-size: 25px; font-weight: 650; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.mrp-calculation-result small { display: flex; flex-wrap: wrap; gap: 14px; opacity: .8; }
.mrp-calculation-diagnostic { padding: 10px 12px; border-radius: 8px; color: var(--mrp-error-fg, #b42318); background: color-mix(in srgb, var(--mrp-error-fg, #b42318) 8%, transparent); line-height: 1.6; }
.mrp-calculation-empty, .mrp-calculation-local { margin: 12px 0 0; line-height: 1.7; opacity: .65; }
.mrp-calculation-local { border-top: 1px solid var(--mrp-toolbar-border); padding-top: 10px; font-size: 11px; }
</style>
