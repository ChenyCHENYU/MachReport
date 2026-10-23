<script setup lang="ts">
import { computed, getCurrentInstance } from "vue";
import type { DatasetContract, PlanComponent, ReportTemplate } from "@agile-team/mach-report";
import { TEMPLATE_EDITOR_MESSAGES, type TemplateEditorMessages } from "./messages";
const props = defineProps<{ component: PlanComponent; repeat?: ReportTemplate["repeat"]; schema?: DatasetContract; disabled?: boolean; messages?: Partial<TemplateEditorMessages> }>();
const emit = defineEmits<{ (event: "change", binding: PlanComponent["binding"]): void }>();
const m = computed(() => ({ ...TEMPLATE_EDITOR_MESSAGES, ...props.messages }));
const binding = computed(() => props.component.binding);
const id = `mr-component-fields-${getCurrentInstance()?.uid ?? 0}`;
function input(event: Event): string { return (event.target as HTMLInputElement).value; }
function patch(value: Partial<NonNullable<PlanComponent["binding"]>>): void { if (!props.disabled && binding.value) emit("change", { ...binding.value, ...value }); }
function mode(event: Event): void {
  if (props.disabled) return;
  if (input(event) === "static") emit("change", undefined);
  else if (props.repeat) emit("change", { field: props.schema?.fields[0]?.field ?? "value" });
}
function format(event: Event): void {
  if (!binding.value || props.disabled) return;
  const next = { ...binding.value }, kind = input(event);
  if (kind === "natural") delete next.format;
  else next.format = kind === "date" ? { kind: "date", pattern: "YYYY-MM-DD" } : { kind: kind as "number" | "percent", digits: 2 };
  emit("change", next);
}
function digits(event: Event): void {
  const value = input(event), current = binding.value?.format;
  if (value.trim() && current && current.kind !== "date") patch({ format: { ...current, digits: Number(value) } });
}
</script>
<template>
  <div class="mr-component-binding">
    <h3>{{ m.componentContent }}</h3>
    <label>{{ m.contentSource }}<select :value="binding ? 'field' : 'static'" :disabled="disabled" @change="mode"><option value="static">{{ m.staticContent }}</option><option value="field" :disabled="!repeat">{{ m.recordField }}</option></select></label>
    <p v-if="!repeat" class="mr-binding-hint">{{ m.bindingNeedsRepeat }}</p>
    <template v-if="binding">
      <label>{{ m.bindingField }}<input :value="binding.field" :list="id" :disabled="disabled" @change="input($event).trim() && patch({ field: input($event).trim() })" /></label>
      <datalist :id="id"><option v-for="field in schema?.fields ?? []" :key="field.field" :value="field.field">{{ field.label }}</option></datalist>
      <div v-if="component.kind === 'text'" class="mr-binding-grid"><label>{{ m.valueFormat }}<select :value="binding.format?.kind ?? 'natural'" :disabled="disabled" @change="format"><option value="natural">{{ m.naturalFormat }}</option><option value="number">{{ m.numberFormat }}</option><option value="percent">{{ m.percentFormat }}</option><option value="date">{{ m.dateFormat }}</option></select></label><label v-if="binding.format && binding.format.kind !== 'date'">{{ m.decimalPlaces }}<input type="number" min="0" max="100" step="1" :value="binding.format.digits ?? 2" :disabled="disabled" @change="digits" /></label><label v-else-if="binding.format?.kind === 'date'">{{ m.datePattern }}<input :value="binding.format.pattern ?? 'YYYY-MM-DD'" :disabled="disabled" @change="patch({ format: { kind: 'date', pattern: input($event) } })" /></label></div>
      <details v-if="component.kind !== 'image'"><summary>{{ m.bindingDecoration }}</summary><div class="mr-binding-grid"><label>{{ m.valuePrefix }}<input :value="binding.prefix ?? ''" :disabled="disabled" @change="patch({ prefix: input($event) })" /></label><label>{{ m.valueSuffix }}<input :value="binding.suffix ?? ''" :disabled="disabled" @change="patch({ suffix: input($event) })" /></label></div><label>{{ m.emptyValueText }}<input :value="binding.emptyText ?? ''" :disabled="disabled" @change="patch({ emptyText: input($event) })" /></label></details>
      <p class="mr-binding-hint">{{ repeat?.dataset }} · {{ component.kind === 'image' ? m.bindingImageHint : m.bindingRecordHint }}</p>
    </template>
  </div>
</template>
<style scoped>
.mr-component-binding{margin-top:0}.mr-component-binding h3{font-size:11px;color:#64748b;margin:0 0 8px}.mr-component-binding label{display:flex;flex-direction:column;gap:4px;margin:8px 0;color:#64748b;font-size:11px}.mr-component-binding input,.mr-component-binding select{min-width:0;width:100%;padding:5px 7px;border:1px solid #dbe3ec;border-radius:5px;background:#fff;color:#334155;font:inherit;font-size:12px;line-height:1.5;box-sizing:border-box}.mr-binding-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0 10px}.mr-binding-hint{margin:5px 0;color:#7890ad;font-size:10px;line-height:1.6;overflow-wrap:anywhere}.mr-component-binding details{margin:8px 0;font-size:11px;color:#64748b}.mr-component-binding summary{cursor:pointer}.mr-component-binding :focus-visible{outline:2px solid #2563eb;outline-offset:2px}
</style>
