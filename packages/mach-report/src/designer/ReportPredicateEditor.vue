<script setup lang="ts">
import { computed } from "vue";
import type { ReportComparison, ReportPredicate, ReportPredicateScalar } from "../processing/predicate";
import type { RuleEditorMessages } from "./rule-messages";
const props = defineProps<{ modelValue: ReportPredicate; fields: readonly { field: string; label: string }[]; messages: RuleEditorMessages; readonly?: boolean; depth?: number }>();
const emit = defineEmits<{ (event: "update:modelValue", value: ReportPredicate): void }>();
const mode = computed(() => "all" in props.modelValue ? "all" : "any" in props.modelValue ? "any" : "not" in props.modelValue ? "not" : "comparison");
const children = computed(() => "all" in props.modelValue ? props.modelValue.all : "any" in props.modelValue ? props.modelValue.any : "not" in props.modelValue ? [props.modelValue.not] : []);
const comparison = computed(() => "field" in props.modelValue ? props.modelValue : undefined);
function update(value: ReportPredicate): void { if (!props.readonly) emit("update:modelValue", value); }
function initial(): ReportComparison { return { field: props.fields[0]?.field ?? "", op: ">", value: 0, valueType: "number" }; }
function setMode(value: string): void {
  const child = props.modelValue;
  update(value === "all" ? { all: [child] } : value === "any" ? { any: [child] } : value === "not" ? { not: child } : initial());
}
function setChild(index: number, value?: ReportPredicate): void {
  const nodes = [...children.value]; if (value) nodes[index] = value; else nodes.splice(index, 1);
  update(mode.value === "all" ? { all: nodes } : mode.value === "any" ? { any: nodes } : { not: nodes[0]! });
}
function addChild(): void { const nodes = [...children.value, initial()]; update(mode.value === "all" ? { all: nodes } : { any: nodes }); }
function patch(value: Partial<ReportComparison>): void { if (comparison.value) update({ ...comparison.value, ...value }); }
function setOperator(op: string): void {
  if (!comparison.value) return;
  const next = { ...comparison.value, op: op as ReportComparison["op"] };
  delete next.right; delete next.values;
  if (op === "between") { next.values = [0, 1]; delete next.value; }
  else if (op === "isNull" || op === "isNotNull") delete next.value;
  else next.value = op === "contains" ? "" : 0;
  update(next);
}
function valueInput(value: string): ReportPredicateScalar {
  const type = comparison.value?.valueType ?? comparison.value?.numeric;
  return type === "number" && value.trim() && Number.isFinite(Number(value)) ? Number(value) : type === "boolean" ? value === "true" : value;
}
function threshold(value: string, index?: number): void {
  if (!comparison.value) return;
  if (index !== undefined) { const values: [ReportPredicateScalar, ReportPredicateScalar] = [...(comparison.value.values ?? [0, 1])]; values[index] = valueInput(value); patch({ values }); }
  else patch({ value: valueInput(value), right: undefined });
}
function setRightMode(value: string): void { patch(value === "field" ? { value: undefined, right: { field: props.fields[0]?.field ?? "" } } : { value: 0, right: undefined }); }
</script>
<template>
  <div class="mr-predicate" :class="{ 'is-nested': (depth ?? 0) > 0 }">
    <label class="mr-predicate__mode">{{ messages.conditionGroup }}<select :aria-label="messages.conditionGroup" :value="mode" :disabled="readonly" @change="setMode(($event.target as HTMLSelectElement).value)"><option value="comparison">{{ messages.comparison }}</option><option v-if="(depth ?? 0) < 8" value="all">{{ messages.all }}</option><option v-if="(depth ?? 0) < 8" value="any">{{ messages.any }}</option><option v-if="(depth ?? 0) < 8" value="not">{{ messages.not }}</option></select></label>
    <template v-if="comparison">
      <div class="mr-predicate__pair">
<label>{{ messages.field }}<select :aria-label="messages.condition" :value="comparison.field" :disabled="readonly" @change="patch({ field: ($event.target as HTMLSelectElement).value })"><option v-for="item in fields" :key="item.field" :value="item.field">{{ item.label }}</option></select></label>
      <label>{{ messages.comparison }}<select :aria-label="messages.comparison" :value="comparison.op" :disabled="readonly" @change="setOperator(($event.target as HTMLSelectElement).value)"><option v-for="op in ['>', '>=', '<', '<=', '==', '!=']" :key="op" :value="op">{{ op }}</option><option v-for="op in ['between','contains','isNull','isNotNull'] as const" :key="op" :value="op">{{ messages[op] }}</option></select></label>
</div>
      <template v-if="!['isNull','isNotNull'].includes(comparison.op)">
        <label>{{ messages.valueKind }}<select :aria-label="messages.valueKind" :value="comparison.valueType ?? comparison.numeric ?? (typeof comparison.value === 'number' ? 'number' : 'text')" :disabled="readonly" @change="patch({ valueType: ($event.target as HTMLSelectElement).value as ReportComparison['valueType'] })"><option value="text">{{ messages.text }}</option><option value="number">{{ messages.number }}</option><option value="decimal">{{ messages.decimal }}</option><option value="date">{{ messages.calendarDate }}</option><option value="boolean">{{ messages.boolean }}</option></select></label>
        <div v-if="comparison.op === 'between'" class="mr-predicate__pair"><label>{{ messages.lowerBound }}<input :value="comparison.values?.[0]" :disabled="readonly" @input="threshold(($event.target as HTMLInputElement).value, 0)" /></label><label>{{ messages.upperBound }}<input :value="comparison.values?.[1]" :disabled="readonly" @input="threshold(($event.target as HTMLInputElement).value, 1)" /></label></div>
        <template v-else>
          <label>{{ messages.threshold }}<select :aria-label="messages.threshold" :value="comparison.right && 'field' in comparison.right ? 'field' : 'value'" :disabled="readonly" @change="setRightMode(($event.target as HTMLSelectElement).value)"><option value="value">{{ messages.compareValue }}</option><option value="field">{{ messages.compareField }}</option></select></label>
          <select v-if="comparison.right && 'field' in comparison.right" :value="comparison.right.field" :aria-label="messages.compareField" :disabled="readonly" @change="patch({ right: { field: ($event.target as HTMLSelectElement).value } })"><option v-for="item in fields" :key="item.field" :value="item.field">{{ item.label }}</option></select>
          <input v-else :value="comparison.right && 'value' in comparison.right ? comparison.right.value : comparison.value" :aria-label="messages.compareValue" :disabled="readonly" @input="threshold(($event.target as HTMLInputElement).value)" />
        </template>
      </template>
    </template>
    <template v-else><div v-for="(child,index) in children" :key="index" class="mr-predicate__child"><ReportPredicateEditor :model-value="child" :fields="fields" :messages="messages" :readonly="readonly" :depth="(depth ?? 0) + 1" @update:model-value="setChild(index,$event)" /><button v-if="children.length > 1" type="button" :aria-label="messages.removeCondition" :disabled="readonly" @click="setChild(index)">×</button></div><button v-if="mode !== 'not' && children.length < 8" type="button" :disabled="readonly" @click="addChild">+ {{ messages.addCondition }}</button></template>
  </div>
</template>
<style scoped>
.mr-predicate{display:grid;gap:8px;font:inherit;color:inherit;min-width:0}.mr-predicate.is-nested{border-left:2px solid var(--mr-color-border,#dce5f0);padding-left:10px}.mr-predicate label{display:grid;gap:4px;font-size:11px;color:var(--mr-color-muted,#5e718a)}.mr-predicate__pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}.mr-predicate__child{display:flex;align-items:flex-start;gap:6px}.mr-predicate__child>.mr-predicate{flex:1}.mr-predicate select,.mr-predicate input,.mr-predicate button{font:inherit;color:var(--mr-color-text,#253951);border:1px solid var(--mr-color-border,#dce5f0);border-radius:6px;background:var(--mr-color-surface,#fff);height:30px;padding:4px 7px;min-width:0;box-sizing:border-box}.mr-predicate input,.mr-predicate select{width:100%}.mr-predicate button{cursor:pointer}.mr-predicate :disabled{opacity:.55;cursor:default}.mr-predicate :focus-visible{outline:2px solid var(--mr-color-primary,#2563eb);outline-offset:2px}
</style>
