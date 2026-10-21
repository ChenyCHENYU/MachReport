<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import ReportIcon from "../vue/ReportIcon.vue";
import { columnName, parseImportRange } from "../xlsx/import-range";
import type { ExcelBindingDataset } from "../xlsx/binding-workflow";
import type { ExcelBindingMessages } from "./excel-binding-messages";
import type { useExcelRegionBindings } from "./useExcelRegionBindings";

const props = defineProps<{ controller: ReturnType<typeof useExcelRegionBindings>; datasets: readonly ExcelBindingDataset[]; disabled: boolean; messages: ExcelBindingMessages }>();
const page = ref(0);
const panel = ref<HTMLElement>();
const fieldSearch = ref("");
const active = props.controller.active;
const dataset = computed(() => props.datasets.find(item => item.id === active.value?.dataset));
const columns = computed(() => {
  if (!active.value) return [];
  let left = 1;
  try { left = parseImportRange(active.value.range).left; } catch { /* Validation owns invalid draft coordinates. */ }
  return active.value.fields.slice(page.value * 12, page.value * 12 + 12).map((field, index) => ({ field, index: page.value * 12 + index, physical: columnName(left + page.value * 12 + index) }));
});
const pages = computed(() => Math.max(1, Math.ceil((active.value?.fields.length ?? 0) / 12)));
const fieldChoices = computed(() => {
  const query = fieldSearch.value.trim().toLocaleLowerCase(), fields = dataset.value?.fields ?? [];
  const visible = fields.filter(field => [field.field, field.label, field.unit].some(text => text?.toLocaleLowerCase().includes(query))).slice(0, 64);
  const selected = new Set(columns.value.map(column => column.field));
  return [...visible, ...fields.filter(field => selected.has(field.field) && !visible.includes(field))];
});
function value(event: Event): string { return (event.target as HTMLInputElement).value; }
function select(id: string): void { props.controller.setActive(id); page.value = 0; fieldSearch.value = ""; }
watch(() => props.controller.focusTarget.value, async value => {
  if (!value) return;
  page.value = Math.floor((value.target.fieldIndex ?? 0) / 12);
  fieldSearch.value = "";
  await nextTick();
  const control = value.target.control === "field" ? `field-${value.target.fieldIndex}` : value.target.control === "contract" ? "dataset" : value.target.control;
  const element = panel.value?.querySelector<HTMLElement>(`[data-binding-control="${control}"]`);
  const details = element?.closest("details");
  if (details) details.open = true;
  const target = props.disabled && element?.matches("input,select,textarea,button") ? element.closest<HTMLElement>("label") : element;
  target?.focus(); target?.scrollIntoView?.({ block: "nearest" });
});
function rangeChanged(event: Event): void {
  if (!active.value || props.disabled) return;
  active.value.range = value(event);
  try {
    const range = parseImportRange(active.value.range), length = range.right - range.left + 1;
    if (length <= 2048) active.value.fields = Array.from({ length }, (_, index) => active.value!.fields[index] ?? "");
  } catch { /* Keep incomplete user input, then explain it through validation. */ }
}
</script>

<template>
  <section ref="panel" class="mr-binding-multi" :aria-label="messages.multiRegions">
    <div class="mr-binding-group">
      <h3>{{ messages.multiRegions }}<span>{{ controller.recipe.value.regions.length }}/128</span></h3>
      <p class="mr-binding-note">{{ messages.multiHint }}</p>
      <button type="button" class="mr-binding-add-region" :title="controller.recipe.value.regions.length >= 128 ? messages.limitRegions : !controller.selection.value ? messages.noCellSelection : messages.addRegion" :disabled="disabled || !controller.selection.value || controller.recipe.value.regions.length >= 128" @click="controller.add">
        <ReportIcon name="grid" :size="13" />{{ messages.addRegion }}<code>{{ controller.selection.value || '—' }}</code>
      </button>
      <div class="mr-binding-region-list" role="list" tabindex="-1" data-binding-control="regions">
        <div v-for="entry in controller.directory.value" :key="entry.region.id" class="mr-binding-region-entry" :class="{ 'is-active': entry.region.id === controller.activeId.value }" :data-state="entry.state">
          <button type="button" :aria-pressed="entry.region.id === controller.activeId.value" @click="select(entry.region.id)">
            <strong :title="entry.region.id">{{ entry.region.id }}</strong><code>{{ entry.region.range }}</code><small>{{ entry.region.mode === 'record' ? messages.recordMode : messages.repeatMode }} · {{ entry.region.dataset || messages.chooseDataset }}</small>
            <span class="mr-binding-region-state">{{ entry.state === 'ready' ? messages.regionReady : entry.state === 'pending' ? messages.regionPending : messages.regionError }}<span v-if="entry.issues.length"> · {{ entry.issues.length }}</span></span>
          </button><button type="button" :aria-label="`${messages.removeRegion} ${entry.region.id}`" :disabled="disabled" @click="controller.remove(entry.region.id)"><ReportIcon name="close" :size="12" /></button>
        </div>
      </div>
    </div>
    <fieldset :disabled="disabled" class="mr-binding-region-editor">
      <section v-if="active" class="mr-binding-group">
        <h3>{{ messages.regionProperties }}<code>{{ active.id }}</code></h3>
        <label class="mr-binding-label" tabindex="-1">{{ messages.regionCoordinates }}<input data-binding-control="range" :value="active.range" :aria-label="messages.regionCoordinates" @change="rangeChanged" /></label>
        <label class="mr-binding-label">{{ messages.regionMode }}<select :value="active.mode" :aria-label="messages.regionMode" @change="controller.property('mode', value($event))"><option value="record">{{ messages.recordMode }}</option><option value="repeat">{{ messages.repeatMode }}</option></select></label>
        <p class="mr-binding-note">{{ active.mode === 'record' ? messages.recordHint : messages.repeatHint }}</p>
        <label class="mr-binding-label" tabindex="-1">{{ messages.dataset }}<select data-binding-control="dataset" :value="active.dataset" :aria-label="messages.dataset" @change="controller.dataset(value($event))"><option value="">{{ messages.chooseDataset }}</option><option v-for="item in datasets" :key="item.id" :value="item.id">{{ item.label || item.id }}</option></select></label>
        <label v-if="dataset" class="mr-binding-label" tabindex="-1">{{ messages.rowKey }}<select data-binding-control="rowKey" :value="active.rowKey" :aria-label="messages.rowKey" @change="controller.property('rowKey', value($event))"><option value="">{{ messages.chooseRowKey }}</option><option v-for="field in dataset.fields.filter(item => item.type !== 'boolean')" :key="field.field" :value="field.field">{{ field.label || field.field }}</option></select></label>
        <div class="mr-binding-region-tools"><button type="button" :disabled="!controller.selection.value" @click="controller.header">{{ messages.bindRegionHeader }}</button><code>{{ active.headerRange || messages.noRegionHeader }}</code><button v-if="active.headerRange" type="button" :aria-label="messages.clearHeader" @click="controller.clearHeader"><ReportIcon name="close" :size="11" /></button></div>
        <div v-if="dataset" class="mr-binding-mappings">
          <label class="mr-binding-field-search"><ReportIcon name="search" :size="13" /><input v-model="fieldSearch" type="search" :placeholder="messages.searchFields" :aria-label="messages.searchFields" /></label>
          <small v-if="dataset.fields.length > 64" class="mr-binding-note">{{ messages.fieldLimit }}</small>
          <label v-for="column in columns" :key="column.index" class="mr-binding-map" tabindex="-1"><span>{{ column.physical }}</span><div><select :data-binding-control="`field-${column.index}`" :value="active.fields[column.index]" @change="controller.mapping(column.index, value($event))" :aria-label="`${messages.physical} ${column.physical} · ${messages.business}`"><option value="">{{ messages.chooseField }}</option><option v-for="field in fieldChoices" :key="field.field" :value="field.field">{{ field.label || field.field }} · {{ field.field }}</option></select><small v-if="column.field">{{ dataset.fields.find(field => field.field === column.field)?.type }} · {{ dataset.fields.find(field => field.field === column.field)?.unit || '—' }}</small></div></label>
        </div>
        <div v-if="pages > 1" class="mr-binding-map-pages"><button type="button" :disabled="page <= 0" :aria-label="messages.previousColumns" @click="page--"><ReportIcon name="chevron-left" :size="13" /></button><span>{{ page + 1 }}/{{ pages }}</span><button type="button" :disabled="page + 1 >= pages" :aria-label="messages.nextColumns" @click="page++"><ReportIcon name="chevron-right" :size="13" /></button></div>
        <details v-if="dataset" class="mr-binding-concurrency"><summary>{{ messages.concurrency }}</summary><label v-for="key in (['revisionField', 'sourceTokenField'] as const)" :key="key" class="mr-binding-label" tabindex="-1">{{ key === 'revisionField' ? messages.revisionField : messages.sourceTokenField }}<select :data-binding-control="key" :value="active[key] || ''" @change="controller.property(key, value($event))"><option value="">{{ messages.optional }}</option><option v-for="field in dataset.fields" :key="field.field" :value="field.field">{{ field.label || field.field }}</option></select></label></details>
      </section>
      <section class="mr-binding-group" tabindex="-1" data-binding-control="footer">
        <h3>{{ messages.flowFooter }}</h3><p class="mr-binding-note">{{ messages.flowFooterHint }}</p>
        <div class="mr-binding-region-tools"><button type="button" :disabled="!controller.selection.value" @click="controller.footer">{{ messages.bindFooter }}</button><code>{{ controller.recipe.value.footerRange || '—' }}</code><button v-if="controller.recipe.value.footerRange" type="button" :aria-label="messages.clearFooter" @click="controller.clearFooter"><ReportIcon name="close" :size="11" /></button></div>
      </section>
    </fieldset>
  </section>
</template>
