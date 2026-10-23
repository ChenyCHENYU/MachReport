<script setup lang="ts">
import { computed, getCurrentInstance } from "vue";
import type { DatasetContract, ReportTemplateDocument, ReportTemplate } from "@agile-team/mach-report";
import { TEMPLATE_EDITOR_MESSAGES, type TemplateEditorMessages } from "./messages";
import { pageOverflow } from "./page-commands";
const props = defineProps<{ document: ReportTemplateDocument; datasets?: string[]; schemas?: Record<string, DatasetContract>; disabled?: boolean; messages?: Partial<TemplateEditorMessages> }>();
const emit = defineEmits<{ (event: "change", value: ReportTemplate["repeat"]): void }>();
const m = computed(() => ({ ...TEMPLATE_EDITOR_MESSAGES, ...props.messages }));
const repeat = computed(() => props.document.template.repeat);
const fields = computed(() => props.schemas?.[repeat.value?.dataset ?? ""]?.fields ?? []);
const datasets = computed(() => [...new Set([...(props.datasets ?? []), ...Object.keys(props.schemas ?? {}), ...(repeat.value ? [repeat.value.dataset] : [])])]);
const hasBindings = computed(() => props.document.template.pages.some(page => page.components.some(component => component.kind !== "list" && component.binding)));
const incompatible = computed(() => props.document.template.pages.some(page => page.layout === "wide" || !!page.flow || page.components.some(component => component.kind === "list") || pageOverflow(page).length > 0));
const mode = computed(() => typeof repeat.value?.copies === "object" ? "field" : "fixed");
const id = `mr-repeat-fields-${getCurrentInstance()?.uid ?? 0}`;
function input(event: Event): string { return (event.target as HTMLInputElement).value; }
function patch(value: Partial<NonNullable<ReportTemplate["repeat"]>>): void { if (!props.disabled && repeat.value) emit("change", { ...repeat.value, ...value }); }
function toggle(event: Event): void {
  if (props.disabled) return;
  if ((event.target as HTMLInputElement).checked) {
    if (!incompatible.value) emit("change", { dataset: datasets.value[0] ?? "detail", copies: 1 });
  } else if (!hasBindings.value) emit("change", undefined);
}
function rowKey(event: Event): void {
  if (!repeat.value || props.disabled) return;
  const next = { ...repeat.value }, value = input(event).trim();
  if (value) next.rowKey = value; else delete next.rowKey;
  emit("change", next);
}
function copiesMode(event: Event): void {
  patch({ copies: input(event) === "field" ? { field: fields.value.find(field => field.type === "number")?.field ?? "copies" } : 1 });
}
</script>
<template>
  <fieldset class="mr-repeat-properties" :disabled="disabled">
    <label class="mr-repeat-toggle"><span><strong>{{ m.repeatRecords }}</strong><small>{{ incompatible ? m.repeatNeedsFixed : m.repeatRecordsHint }}</small></span><input type="checkbox" :checked="!!repeat" :disabled="disabled || (!!repeat && hasBindings) || (!repeat && incompatible)" @change="toggle" /></label>
    <template v-if="repeat">
      <label>{{ m.recordDataset }}<input :value="repeat.dataset" :list="`${id}-datasets`" @change="input($event).trim() && patch({ dataset: input($event).trim() })" /></label>
      <datalist :id="`${id}-datasets`"><option v-for="dataset in datasets" :key="dataset" :value="dataset" /></datalist>
      <label>{{ m.recordRowKey }}<input :value="repeat.rowKey ?? ''" :list="id" @change="rowKey" /></label>
      <datalist :id="id"><option v-for="field in fields" :key="field.field" :value="field.field">{{ field.label }}</option></datalist>
      <div class="mr-repeat-grid"><label>{{ m.labelCopies }}<select :value="mode" @change="copiesMode"><option value="fixed">{{ m.fixedCopies }}</option><option value="field">{{ m.fieldCopies }}</option></select></label><label v-if="mode === 'fixed'">{{ m.copiesPerRecord }}<input type="number" min="1" max="1000" step="1" :value="repeat.copies ?? 1" @change="input($event).trim() && patch({ copies: Number(input($event)) })" /></label><label v-else>{{ m.copiesField }}<input :value="typeof repeat.copies === 'object' ? repeat.copies.field : ''" :list="id" @change="input($event).trim() && patch({ copies: { field: input($event).trim() } })" /></label></div>
      <p class="mr-repeat-note">{{ hasBindings ? m.repeatBoundHint : m.repeatOrderHint }}</p>
    </template>
  </fieldset>
</template>
<style scoped>
.mr-repeat-properties{border:0;margin:14px 0 0;padding:14px 0 0;border-top:1px solid #e2e8f0;min-width:0}.mr-repeat-properties label{display:flex;flex-direction:column;gap:5px;margin:9px 0;color:#64748b;font-size:11px}.mr-repeat-properties input,.mr-repeat-properties select{min-width:0;width:100%;padding:5px 7px;border:1px solid #dbe3ec;border-radius:5px;background:#fff;color:#334155;font:inherit;font-size:12px;line-height:1.5;box-sizing:border-box}.mr-repeat-properties .mr-repeat-toggle{flex-direction:row;align-items:center;gap:10px;margin:0 0 10px}.mr-repeat-toggle>span{flex:1;min-width:0}.mr-repeat-toggle strong{display:block;color:#334155;font-size:12px;font-weight:650}.mr-repeat-toggle small{display:block;margin-top:3px;color:#7a8da3;font-size:10px;line-height:1.5}.mr-repeat-toggle input{width:15px;height:15px;accent-color:#2563eb;flex-shrink:0}.mr-repeat-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px}.mr-repeat-note{margin:8px 0 0;color:#7890ad;font-size:10px;line-height:1.6}.mr-repeat-properties :disabled{opacity:.45;cursor:default}.mr-repeat-properties :focus-visible{outline:2px solid #2563eb;outline-offset:2px}
</style>
