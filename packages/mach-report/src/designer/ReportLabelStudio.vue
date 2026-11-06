<script setup lang="ts">
import { markRaw, nextTick, onScopeDispose, ref, shallowRef, watch, type Component } from "vue";
import { ReportPreview } from "@agile-team/mach-report/vue";
import type { ReportTemplateDocument } from "@agile-team/mach-report";
import ReportIcon from "../vue/ReportIcon.vue";
import { useLabelStudio, type LabelStudioOptions } from "./useLabelStudio";
import { useDesignerViews } from "./useDesignerViews";
const props = withDefaults(defineProps<LabelStudioOptions>(), { showSave: true });
const emit = defineEmits<{ (event: "update:modelValue", document: ReportTemplateDocument): void }>();
const studio = useLabelStudio(props, document => emit("update:modelValue", document));
const { m, notice, title, document, mode, record, recordIndex, sheet, busy, editor, rows, designDatasets, schemas, bindings, paper, labelCount, fetcher, preset, presets, brandName, brandTagline, fields, fieldQuery, selectedFields, availableFields, fieldCount, configurationDirty, pendingLocalChanges, custom, confirmation, editorVisited, editorInitialDocument, sheetLayout, sheetHint, rebuilding, layoutChanged } = studio;
const { previewVisited, visibleFetcher } = useDesignerViews(document, mode, fetcher);
const LabelEditor = shallowRef<Component>();
let disposed = false;
onScopeDispose(() => { disposed = true; });
watch(studio.editorVisited, async requested => {
  if (!requested || LabelEditor.value) return;
  try {
    const module = await import("./ReportTemplateEditor.vue");
    if (!disposed) LabelEditor.value = markRaw(module.default);
  } catch (cause) { if (!disposed) studio.failDesignLoad(cause); }
});
const keepEditingButton = ref<HTMLButtonElement>();
let previousFocus: HTMLElement | null = null;
watch(confirmation, async value => {
  if (value) {
    previousFocus = window.document.activeElement as HTMLElement | null;
    await nextTick();
    keepEditingButton.value?.focus();
  } else if (previousFocus?.isConnected) {
    previousFocus.focus();
    previousFocus = null;
  }
});
defineExpose({ guardChanges: studio.guardChanges, prepare: studio.prepare, preview: studio.showPreview, print: studio.print, get mode() { return mode.value; }, get canPrint() { return studio.canPrint.value; }, get busy() { return busy.value; }, get pendingLocalChanges() { return pendingLocalChanges.value; } });
</script>
<template>
  <section class="mr-label-studio" :class="{ 'is-design': mode === 'design' }" :aria-label="title">
    <aside class="mr-label-context">
      <div class="mr-label-identity"><ReportIcon name="file" :size="18" /><strong>{{ title }}</strong><small>{{ custom ? m.customTemplate : m.readyTemplate }}</small></div>
      <div class="mr-label-spec"><strong>{{ paper?.widthMm }} <i>×</i> {{ paper?.heightMm }}</strong><span>mm · {{ document.template.pages.length }} {{ m.faces }}</span></div>
      <fieldset class="mr-label-quick" :disabled="busy">
        <legend>{{ m.layout }}</legend>
        <div class="mr-label-presets" :aria-label="m.layout">
          <button v-for="item in presets" :key="item.id" type="button" :aria-pressed="preset === item.id" @click="preset = item.id">
            <span class="mr-label-preset-art" :class="`is-${item.id}`" aria-hidden="true"><i></i><i></i><i></i></span>
            <span><strong>{{ m[`${item.id}Preset`] }}</strong><small>{{ item.widthMm }} × {{ item.heightMm }} · {{ item.faces }} {{ m.faces }}</small></span>
          </button>
        </div>
        <details class="mr-label-fields">
          <summary>{{ m.fields }} <span>{{ fields.length }} / 5</span></summary>
          <div v-if="selectedFields.length" class="mr-label-selected-fields"><button v-for="item in selectedFields" :key="item.field" type="button" :aria-label="`${m.removeField} ${item.label}`" @click="studio.toggleField(item.field, false)">{{ item.label }} <span aria-hidden="true">×</span></button></div>
          <label class="mr-label-field-search"><ReportIcon name="search" :size="13" /><input v-model="fieldQuery" type="search" :aria-label="m.findField" :placeholder="m.findField" /></label>
          <div class="mr-label-field-options">
            <label v-for="field in availableFields" :key="field.field"><input type="checkbox" :checked="fields.includes(field.field)" :disabled="!fields.includes(field.field) && fields.length >= 5" @change="studio.toggleField(field.field, ($event.target as HTMLInputElement).checked)" /><span>{{ field.label ?? field.field }}</span></label>
            <p v-if="!availableFields.length">{{ m.noFields }}</p>
          </div>
          <small>{{ m.fieldLimit }}</small>
          <small v-if="fieldCount > 30">{{ m.fieldSearchHint }}</small>
        </details>
        <details class="mr-label-brand">
          <summary>{{ m.brand }}</summary>
          <label>{{ m.brandName }}<input v-model="brandName" maxlength="80" :placeholder="title" /></label>
          <label>{{ m.brandTagline }}<input v-model="brandTagline" maxlength="120" /></label>
        </details>
        <button class="mr-label-apply" type="button" :disabled="!configurationDirty || !preset" @click="studio.applyConfiguration()"><ReportIcon name="arrow-right" :size="13" />{{ layoutChanged ? m.applyLayout : m.applyContent }}</button>
        <button v-if="custom && preset && !rebuilding" class="mr-label-reset-configuration mr-label-rebuild-current" type="button" @click="studio.requestRebuild">{{ m.rebuildCurrent }}</button>
        <div v-if="rebuilding" class="mr-label-rebuild" role="alert"><strong>{{ m.rebuildTitle }}</strong><p>{{ m.rebuildDescription }}</p><div><button type="button" @click="studio.cancelRebuild">{{ m.cancelRebuild }}</button><button type="button" @click="studio.applyConfiguration(true)">{{ m.confirmRebuild }}</button></div></div>
        <button v-if="configurationDirty" class="mr-label-reset-configuration" type="button" @click="studio.restoreConfiguration">{{ m.restoreConfiguration }}</button>
        <p v-if="configurationDirty && !preset" class="mr-label-reflow-hint">{{ m.choosePreset }}</p>
        <p class="mr-label-reflow-hint">{{ layoutChanged ? m.reflowHint : m.contentHint }}</p>
      </fieldset>
      <label class="mr-label-record">{{ m.records }}<select v-model="record" :disabled="busy || !props.rows.length"><option value="all">{{ m.all }} · {{ props.rows.length }}</option><option value="single">{{ m.single }}</option></select></label>
      <label v-if="record === 'single'" class="mr-label-record-index">{{ m.record }}<input v-model.number="recordIndex" type="number" min="1" :max="props.rows.length" :aria-label="m.record" :disabled="busy" /> / {{ props.rows.length }}</label>
      <p class="mr-label-count"><strong>{{ rows.length }}</strong> {{ m.count }} <span>→</span> <template v-if="labelCount !== undefined"><strong>{{ labelCount }}</strong> {{ m.labels }}</template><template v-else>{{ m.invalidCopies }}</template></p>
      <details class="mr-label-help"><summary>{{ m.guide }}</summary><p>{{ m.help }}</p><p>{{ m.printHint }}</p></details>
    </aside>
    <div class="mr-label-main">
      <header class="mr-label-bar"><nav :aria-label="title"><button type="button" :aria-pressed="mode === 'preview'" :disabled="busy" @click="studio.navigate('preview')"><ReportIcon name="file" :size="14" />{{ m.preview }}</button><button type="button" :aria-pressed="mode === 'design'" :disabled="busy" @click="studio.navigate('design')"><ReportIcon name="settings" :size="14" />{{ m.design }}</button></nav><span>{{ mode === 'design' ? m.designHint : m.flow }}</span></header>
      <p v-if="notice" class="mr-label-notice" role="status">{{ notice }}</p>
      <div v-if="confirmation" class="mr-label-confirm" role="alertdialog" :aria-label="m.discardTitle" @keydown.esc.prevent.stop="studio.decideDiscard(false)"><div><strong>{{ m.discardTitle }}</strong><p>{{ m.discardDescription }}</p></div><button ref="keepEditingButton" type="button" @click="studio.decideDiscard(false)">{{ m.keepEditing }}</button><button type="button" @click="studio.decideDiscard(true)">{{ m.discard }}</button></div>
      <ReportPreview v-if="previewVisited" v-show="mode === 'preview'" :key="document.id" :ref="studio.preview.ref" report-id="labels" :fetcher="visibleFetcher" :refresh="{ retainPrevious: true, key: document.id }" :show-params="false" height="100%" :toolbar="{ exportFormats: ['pdf','png','html'], editing: false, excelImport: false }" :messages="{ title, empty: m.empty }">
        <template #settings><label class="mr-label-imposition"><input v-model="sheet" type="checkbox" :disabled="!sheetLayout">{{ m.sheet }}<small>{{ sheetHint }}</small></label></template>
      </ReportPreview>
      <div v-if="editorVisited" v-show="mode === 'design'" class="mr-label-editor">
        <p v-if="!LabelEditor" class="mr-label-editor-loading" role="status">{{ m.designLoading }}</p>
        <component :is="LabelEditor" v-if="LabelEditor" ref="editor" :model-value="editorInitialDocument ?? document" mode="design" :show-mode-switch="false" :show-save="showSave" :capabilities="{ params: false }" :datasets="designDatasets" :data-schemas="schemas" :binding-datasets="bindings" :binding-data-contract="dataContract" :save="studio.save" :before-discard="studio.beforeDiscard" :preview="preview" @update:model-value="studio.update" />
      </div>
    </div>
  </section>
</template>
<style src="./label-studio.css"></style>
