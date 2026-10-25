<script setup lang="ts">
import { computed } from "vue";
import type { DatasetContract, DatasetRows, PlanComponent, ReportChartBinding, ReportChartMeasure } from "@agile-team/mach-report";
import { TEMPLATE_EDITOR_MESSAGES, type TemplateEditorMessages } from "./messages";
const props = defineProps<{ component: PlanComponent; schemas?: Record<string, DatasetContract>; datasets?: DatasetRows; disabled?: boolean; messages?: Partial<TemplateEditorMessages> }>();
const emit = defineEmits<{ (event: "change", binding: ReportChartBinding): void }>();
const m = computed(() => ({ ...TEMPLATE_EDITOR_MESSAGES, ...props.messages }));
const binding = computed<ReportChartBinding>(() => props.component.chartBinding ?? { dataset: "detail", categoryField: "field", type: "bar", measures: [{ op: "sum", field: "value" }] });
const datasets = computed(() => [...new Set([binding.value.dataset, ...Object.keys(props.schemas ?? {}), ...Object.keys(props.datasets ?? {})])]);
const fields = computed(() => {
  const declared = props.schemas?.[binding.value.dataset]?.fields;
  if (declared) return declared.map(field => ({ field: field.field, label: field.label ?? field.field, type: field.type }));
  const row = props.datasets?.[binding.value.dataset]?.[0];
  return [...new Set([binding.value.categoryField, ...binding.value.measures.flatMap(item => item.field ? [item.field] : []), ...Object.keys(row ?? {}).slice(0, 200)])].map(field => ({ field, label: field, type: undefined }));
});
function change(patch: Partial<ReportChartBinding>): void { if (!props.disabled) emit("change", { ...binding.value, ...patch }); }
function measure(index: number, patch: Partial<ReportChartMeasure>): void {
  change({ measures: binding.value.measures.map((item, position) => {
    if (position !== index) return item;
    const next = { ...item, ...patch };
    if (next.op === "weightedAvg" && !next.weightField) next.weightField = fields.value.find(field => field.field !== next.field && ["number", "decimal"].includes(field.type ?? ""))?.field ?? next.field ?? "value";
    if (next.op !== "count" && !next.field) next.field = fields.value[0]?.field ?? "value";
    return next;
  }) });
}
function selectField(index: number, field: string): void {
  measure(index, { field: field || undefined, numeric: fields.value.find(item => item.field === field)?.type === "decimal" ? "decimal" : "number" });
}
function digits(index: number, value: string): void { if (value === "" || /^\d+$/.test(value) && Number(value) <= 100) measure(index, { digits: value === "" ? undefined : Number(value) }); }
function add(): void { if (binding.value.measures.length < 12) change({ measures: [...binding.value.measures, { op: "sum", field: fields.value[0]?.field ?? "value" }] }); }
function remove(index: number): void { if (binding.value.measures.length > 1) change({ measures: binding.value.measures.filter((_, position) => position !== index) }); }
const input = (event: Event) => (event.target as HTMLInputElement).value;
</script>
<template>
  <fieldset class="mr-chart-binding" :disabled="disabled">
    <label>{{ m.chartDataset }}<select :aria-label="m.chartDataset" :value="binding.dataset" @change="change({ dataset: input($event) })"><option v-for="dataset in datasets" :key="dataset" :value="dataset">{{ dataset }}</option></select></label>
    <label>{{ m.chartCategory }}<select :aria-label="m.chartCategory" :value="binding.categoryField" @change="change({ categoryField: input($event) })"><option v-for="field in fields" :key="field.field" :value="field.field">{{ field.label }}</option></select></label>
    <div class="mr-chart-series-heading"><strong>{{ m.chartMeasure }}</strong><button type="button" :disabled="disabled || binding.measures.length >= 12" @click="add">+ {{ m.chartAddSeries }}</button></div>
    <div v-for="(item, index) in binding.measures" :key="index" class="mr-chart-series">
      <div class="mr-chart-series-row"><select :value="item.field ?? ''" :aria-label="m.chartMeasure" @change="selectField(index, input($event))"><option v-if="item.op === 'count'" value="">{{ m.chartRecordCount }}</option><option v-for="field in fields" :key="field.field" :value="field.field">{{ field.label }}</option></select><button type="button" :aria-label="m.chartRemoveSeries" :disabled="disabled || binding.measures.length === 1" @click="remove(index)">×</button></div>
      <div class="mr-chart-series-row"><select :value="item.op" :aria-label="m.chartAggregation" @change="measure(index, { op: input($event) as ReportChartMeasure['op'] })"><option value="sum">{{ m.chartSum }}</option><option value="avg">{{ m.chartAverage }}</option><option value="weightedAvg">{{ m.chartWeightedAverage }}</option><option value="count">{{ m.chartRecordCount }}</option><option value="min">{{ m.chartMinimum }}</option><option value="max">{{ m.chartMaximum }}</option></select><input :value="item.label" :aria-label="m.chartSeries" :placeholder="m.chartSeries" maxlength="256" @change="measure(index, { label: input($event) || undefined })"></div>
      <label v-if="item.op === 'weightedAvg'">{{ m.chartWeight }}<select :aria-label="m.chartWeight" :value="item.weightField ?? ''" @change="measure(index, { weightField: input($event) || undefined })"><option value="" disabled>—</option><option v-for="field in fields" :key="field.field" :value="field.field">{{ field.label }}</option></select></label>
      <details><summary>{{ m.chartNumberOptions }}</summary><div class="mr-chart-series-row"><select :value="item.numeric ?? 'number'" :aria-label="m.chartNumeric" @change="measure(index, { numeric: input($event) as 'number' | 'decimal' })"><option value="number">{{ m.chartNumber }}</option><option value="decimal">{{ m.chartDecimal }}</option></select><input type="number" min="0" max="100" :value="item.digits" :aria-label="m.chartDigits" :placeholder="m.chartDigits" @change="digits(index, input($event))"></div></details>
    </div>
    <div class="mr-chart-series-row"><label>{{ m.chartType }}<select :aria-label="m.chartType" :value="binding.type" @change="change({ type: input($event) as ReportChartBinding['type'] })"><option value="bar">{{ m.chartBar }}</option><option value="line">{{ m.chartLine }}</option><option value="stackedBar">{{ m.chartStacked }}</option><option value="percentBar">{{ m.chartPercent }}</option></select></label><label>{{ m.chartSort }}<select :aria-label="m.chartSort" :value="binding.sort ?? ''" @change="change({ sort: input($event) as ReportChartBinding['sort'] || undefined })"><option value="">{{ m.chartNatural }}</option><option value="asc">{{ m.chartAscending }}</option><option value="desc">{{ m.chartDescending }}</option></select></label></div>
    <label>{{ m.chartTitle }}<input :aria-label="m.chartTitle" :value="binding.title" maxlength="512" @change="change({ title: input($event) || undefined })"></label>
    <label class="mr-chart-check"><input type="checkbox" :checked="binding.showValues" @change="change({ showValues: ($event.target as HTMLInputElement).checked })">{{ m.chartValues }}</label>
    <p>{{ m.chartBindingNote }}</p>
  </fieldset>
</template>
<style scoped>
.mr-chart-binding { border: 0; padding: 0; margin: 0; min-width: 0; font: inherit; }
.mr-chart-series-heading,.mr-chart-series-row { display: flex; gap: 7px; align-items: center; min-width: 0; }
.mr-chart-series-heading { justify-content: space-between; margin: 10px 0 7px; font-size: 11px; }
.mr-chart-series { border: 1px solid var(--mrp-toolbar-border,#e2e8f0); border-radius: 7px; background: var(--mrp-shell-bg,#f8fafc); padding: 8px; margin: 0 0 7px; }
.mr-chart-series-row { margin: 5px 0; }
.mr-chart-series-row>select,.mr-chart-series-row>input,.mr-chart-series-row>label { flex: 1; width: 0; min-width: 0; }
.mr-chart-binding label { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; font-size: 11px; }
.mr-chart-binding input,.mr-chart-binding select,.mr-chart-binding button { box-sizing: border-box; min-width: 0; border: 1px solid var(--mrp-toolbar-border,#dbe3ec); border-radius: 5px; background: #fff; padding: 5px 7px; color: inherit; font: inherit; }
.mr-chart-binding button { cursor: pointer; }
.mr-chart-binding :focus-visible { outline: 2px solid var(--mrp-btn-active-bg,#2563eb); outline-offset: 2px; }
.mr-chart-binding :disabled { opacity: .5; cursor: default; }
.mr-chart-binding .mr-chart-check { flex-direction: row; align-items: center; }
.mr-chart-check input { accent-color: #2563eb; width: 14px; }
.mr-chart-binding p { margin: 8px 0 0; font-size: 10px; line-height: 1.6; color: var(--mrp-btn-fg,#64748b); }
</style>
