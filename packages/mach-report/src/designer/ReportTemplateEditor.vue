<script setup lang="ts">
import { ReportPreview } from "@agile-team/mach-report/vue";
import type { ReportTemplateDocument } from "@agile-team/mach-report";
import { useTemplateEditor, type TemplateEditorOptions } from "./useTemplateEditor";

const props = defineProps<TemplateEditorOptions>();
const emit = defineEmits<{
  (event: "update:modelValue", document: ReportTemplateDocument): void;
  (event: "saved", document: ReportTemplateDocument): void;
}>();
const editor = useTemplateEditor(props, (event, document) => {
  if (event === "saved") emit("saved", document);
  else emit("update:modelValue", document);
});
const { draft, json, selected, error, saving, dirty, validation, lists, activeList, fetcher, messages: m } = editor;
function value(event: Event): string { return (event.target as HTMLInputElement).value; }
function checked(event: Event): boolean { return (event.target as HTMLInputElement).checked; }
</script>

<template>
  <section class="mr-designer" :aria-label="m.title">
    <header class="mr-designer-bar">
      <div><strong>{{ m.heading }}</strong><span>{{ draft.id }} · {{ draft.revision || m.unpublished }}<b v-if="dirty"> · {{ m.dirty }}</b></span></div>
      <div><button type="button" :disabled="readonly || saving || !dirty" @click="editor.reset">{{ m.reset }}</button><button v-if="save" type="button" :disabled="readonly || saving || !validation.ok || !dirty" @click="editor.save">{{ saving ? m.saving : m.save }}</button></div>
    </header>
    <div class="mr-designer-body">
      <aside class="mr-designer-panel">
        <label>{{ m.name }}<input :value="draft.name" :disabled="readonly || saving" @input="editor.setName(value($event))" /></label>
        <label>{{ m.description }}<textarea :value="draft.description" :disabled="readonly || saving" @input="editor.setDescription(value($event))" /></label>
        <label v-if="lists.length">{{ m.area }}<select v-model="selected"><option v-for="(item, index) in lists" :key="index" :value="index">{{ item.pageIndex + 1 }} {{ m.page }} · {{ item.component.title || item.component.dataset }}</option></select></label>
        <div v-if="activeList" class="mr-designer-columns">
          <fieldset v-for="(column, index) in activeList.columns" :key="index" :disabled="readonly || saving">
            <legend>{{ index + 1 }} · {{ column.header }}</legend>
            <label>{{ m.header }}<input :value="column.header" @input="editor.setColumn(index, 'header', value($event))" /></label>
            <label>{{ m.field }}<input :value="column.field" @change="editor.setColumn(index, 'field', value($event))" /></label>
            <label>{{ m.width }}<input type="number" min="0.1" step="0.5" :value="column.widthMm" @change="editor.setColumn(index, 'widthMm', value($event))" /></label>
            <label>{{ m.semantic }}<select :value="column.semanticRole || 'text'" @change="editor.setColumn(index, 'semanticRole', value($event))"><option value="identifier">{{ m.identifier }}</option><option value="dimension">{{ m.dimension }}</option><option value="measure">{{ m.measure }}</option><option value="date">{{ m.date }}</option><option value="text">{{ m.text }}</option></select></label>
            <label>{{ m.bodyAlign }}<select :value="column.align ?? column.style?.align ?? activeList.align ?? 'left'" @change="editor.setColumn(index, 'align', value($event))"><option value="auto">{{ m.auto }}</option><option value="left">{{ m.left }}</option><option value="center">{{ m.center }}</option><option value="right">{{ m.right }}</option><option value="justify">{{ m.justify }}</option></select></label>
            <label>{{ m.headerAlign }}<select :value="editor.headerAlignments.value[index]" @change="editor.setColumn(index, 'headerAlign', value($event))"><option value="left">{{ m.left }}</option><option value="center">{{ m.center }}</option><option value="right">{{ m.right }}</option><option value="justify">{{ m.justify }}</option></select></label>
            <label class="mr-designer-toggle">{{ m.editable }}<input type="checkbox" :checked="column.editable === true" @change="editor.setColumn(index, 'editable', checked($event))" /></label>
          </fieldset>
        </div>
        <details><summary>{{ m.json }}</summary><textarea v-model="json" class="mr-designer-json" :aria-label="m.json" :disabled="readonly || saving" spellcheck="false" /><button type="button" :disabled="readonly || saving" @click="editor.applyJson">{{ m.applyJson }}</button></details>
        <p class="mr-designer-note">{{ m.note }}</p>
      </aside>
      <div class="mr-designer-preview">
        <div v-if="error" role="alert" class="mr-designer-error">{{ error }}</div>
        <ul v-if="!validation.ok" role="alert" class="mr-designer-error"><li v-for="issue in validation.errors" :key="issue.path">{{ issue.path }}：{{ issue.message }}</li></ul>
        <ReportPreview v-if="fetcher && validation.ok" report-id="draft" :fetcher="fetcher" :show-params="false" :editable="false" :excel-import="false" />
        <p v-else class="mr-designer-note">{{ m.invalid }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.mr-designer { display: flex; flex-direction: column; min-height: 480px; height: 100%; color: var(--mrp-toolbar-fg, #334155); background: var(--mrp-toolbar-bg, #fff); border: 1px solid var(--mrp-toolbar-border, #e2e8f0); border-radius: 10px; overflow: hidden; font: 13px/1.5 sans-serif; }
.mr-designer-bar { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--mrp-toolbar-border, #e2e8f0); }
.mr-designer-bar span { display: block; font-size: 11px; opacity: .7; }.mr-designer-bar b { font-weight: 400; }
.mr-designer-body { display: grid; grid-template-columns: minmax(230px, 300px) minmax(0, 1fr); flex: 1; min-height: 0; }
.mr-designer-panel { overflow: auto; padding: 14px; border-right: 1px solid var(--mrp-toolbar-border, #e2e8f0); }
.mr-designer label { display: grid; grid-template-columns: 90px minmax(0, 1fr); align-items: center; gap: 8px; margin: 8px 0; }
.mr-designer input,.mr-designer select,.mr-designer textarea,.mr-designer button { box-sizing: border-box; min-width: 0; color: inherit; font: inherit; border: 1px solid var(--mrp-toolbar-border, #cbd5e1); border-radius: 5px; padding: 5px 7px; background: var(--mrp-toolbar-bg, #fff); }
.mr-designer input:focus-visible,.mr-designer select:focus-visible,.mr-designer textarea:focus-visible,.mr-designer button:focus-visible { outline: 2px solid var(--mrp-btn-active-bg, #2563eb); outline-offset: 2px; }
.mr-designer button { cursor: pointer; margin-right: 6px; }.mr-designer :disabled { cursor: default; opacity: .55; }
.mr-designer fieldset { margin: 12px 0; border: 1px solid var(--mrp-toolbar-border, #e2e8f0); border-radius: 7px; }.mr-designer legend { padding: 0 6px; font-weight: 600; }
.mr-designer .mr-designer-toggle { display: flex; justify-content: space-between; }
.mr-designer-preview { min-width: 0; min-height: 380px; display: flex; flex-direction: column; }.mr-designer-preview :deep(.mrp-root) { flex: 1; }
.mr-designer-note { opacity: .7; font-size: 11px; }.mr-designer-error { padding: 10px 16px; color: #b91c1c; background: #fef2f2; }
.mr-designer-json { width: 100%; height: 240px; font-family: monospace !important; margin: 8px 0; }
@media (max-width: 720px) { .mr-designer-body { grid-template-columns: 1fr; }.mr-designer-panel { max-height: 300px; border-right: 0; border-bottom: 1px solid var(--mrp-toolbar-border, #e2e8f0); } }
</style>
