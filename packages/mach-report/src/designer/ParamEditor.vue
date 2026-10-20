<script setup lang="ts">
import { watch } from "vue";
import { PARAM_TYPES, PARAM_WIRE_FORMAT, useParamEditor, type ParamDraft, type ParamEditorOptions } from "./useParamEditor";
const props = defineProps<ParamEditorOptions>();
const emit = defineEmits<{ (event: "dirty", pending: boolean): void }>();
const editor = useParamEditor(props);
const { m, rows, selected, current, currentIssues, changes, pending, conflicted, error } = editor;
watch(pending, value => emit("dirty", value), { immediate: true });
function typeLabel(type: ParamDraft["type"]): string {
  const labels = { text: m.value.paramText, number: m.value.paramNumber, date: m.value.paramDate, month: m.value.paramMonth, year: m.value.paramYear, dateRange: m.value.paramDateRange, select: m.value.paramSelect };
  return labels[type];
}
function addOption(): void { if (current.value && !props.readonly) current.value.options.push({ value: "", label: "" }); }
function removeOption(index: number): void { if (!props.readonly) current.value?.options.splice(index, 1); }
defineExpose({ pending, reset: editor.reset, apply: editor.apply });
</script>

<template>
  <section class="mr-param-editor" :aria-label="m.paramsTool">
    <aside class="mr-param-editor__directory">
      <header><strong>{{ m.paramsDirectory }}</strong><span>{{ rows.length }}</span></header>
      <nav :aria-label="m.paramsDirectory">
        <button v-for="(row, index) in rows" :key="index" type="button" :aria-pressed="selected === index" @click="selected = index">
          <strong>{{ row.label || row.field }}</strong><small>{{ row.field }} · {{ typeLabel(row.type) }}<span v-if="row.required"> *</span></small>
        </button>
      </nav>
      <button type="button" class="mr-param-editor__add" :disabled="readonly" @click="editor.add">+ {{ m.paramAdd }}</button>
      <p>{{ m.paramsDescription }}</p>
    </aside>
    <div class="mr-param-editor__main">
      <template v-if="current">
        <header class="mr-param-editor__heading"><div><strong>{{ current.label || current.field }}</strong><code>{{ PARAM_WIRE_FORMAT[current.type] }}</code></div><span :class="{ 'is-pending': pending || editor.issues.value.length > 0 }">{{ editor.issues.value.length ? m.paramInvalid : pending ? m.paramPending : m.paramReady }}</span></header>
        <div class="mr-param-editor__grid">
          <label>{{ m.paramField }}<input v-model="current.field" :aria-label="m.paramField" :disabled="readonly" autocomplete="off"></label>
          <label>{{ m.paramLabel }}<input v-model="current.label" :aria-label="m.paramLabel" :disabled="readonly"></label>
          <label>{{ m.paramType }}<select :value="current.type" :aria-label="m.paramType" :disabled="readonly" @change="editor.setType(($event.target as HTMLSelectElement).value as ParamDraft['type'])"><option v-for="type in PARAM_TYPES" :key="type" :value="type">{{ typeLabel(type) }}</option></select></label>
          <label>{{ m.paramPlaceholder }}<input v-model="current.placeholder" :aria-label="m.paramPlaceholder" :disabled="readonly"></label>
          <div class="mr-param-editor__checks"><label><input v-model="current.required" type="checkbox" :disabled="readonly">{{ m.paramRequired }}</label><label><input v-model="current.defaultEnabled" type="checkbox" :disabled="readonly">{{ m.paramDefaultEnabled }}</label></div>
          <label v-if="current.defaultEnabled">{{ m.paramDefault }}<select v-if="current.type === 'select'" v-model="current.defaultValue" :aria-label="m.paramDefault" :disabled="readonly"><option value=""></option><option v-for="(option, index) in current.options" :key="index" :value="option.value">{{ option.label || option.value }}</option></select><input v-else v-model="current.defaultValue" :aria-label="m.paramDefault" :type="['date', 'month', 'number'].includes(current.type) ? current.type : 'text'" :placeholder="PARAM_WIRE_FORMAT[current.type]" :disabled="readonly"></label>
          <template v-if="['number', 'date', 'month', 'year', 'dateRange'].includes(current.type)">
            <label v-for="bound in ['min', 'max'] as const" :key="bound">{{ bound === 'min' ? m.paramMinimum : m.paramMaximum }}<input v-model="current[bound]" :aria-label="bound === 'min' ? m.paramMinimum : m.paramMaximum" :type="current.type === 'dateRange' ? 'date' : ['date', 'month', 'number'].includes(current.type) ? current.type : 'text'" :disabled="readonly"></label>
          </template>
          <template v-if="current.type === 'text'">
            <label v-for="bound in ['minLength', 'maxLength'] as const" :key="bound">{{ bound === 'minLength' ? m.paramMinLength : m.paramMaxLength }}<input v-model="current[bound]" type="number" min="0" step="1" :aria-label="bound === 'minLength' ? m.paramMinLength : m.paramMaxLength" :disabled="readonly"></label>
          </template>
        </div>
        <p v-if="current.type === 'dateRange'" class="mr-param-editor__hint">{{ m.paramRangeHint }}</p>
        <fieldset v-if="current.type === 'select'" class="mr-param-editor__options"><legend>{{ m.paramOptions }}</legend><div class="mr-param-editor__option-head"><span>{{ m.paramOptionValue }}</span><span>{{ m.paramOptionLabel }}</span></div><div v-for="(option, index) in current.options" :key="index" class="mr-param-editor__option"><input v-model="option.value" :aria-label="`${m.paramOptionValue} ${index + 1}`" :disabled="readonly"><input v-model="option.label" :aria-label="`${m.paramOptionLabel} ${index + 1}`" :disabled="readonly"><button type="button" :aria-label="`${m.paramOptionRemove} ${index + 1}`" :disabled="readonly" @click="removeOption(index)">×</button></div><button type="button" :disabled="readonly" @click="addOption">+ {{ m.paramOptionAdd }}</button></fieldset>
        <ul v-if="currentIssues.length" class="mr-param-editor__errors" role="alert"><li v-for="(issue, index) in currentIssues" :key="index">{{ issue.message }}</li></ul>
        <div class="mr-param-editor__row-actions"><button type="button" :disabled="readonly || selected === 0" @click="editor.move(-1)">↑ {{ m.paramMoveUp }}</button><button type="button" :disabled="readonly || selected === rows.length - 1" @click="editor.move(1)">↓ {{ m.paramMoveDown }}</button><button type="button" class="is-danger" :disabled="readonly" @click="editor.remove">{{ m.paramRemove }}</button></div>
      </template>
      <div v-else class="mr-param-editor__empty"><strong>{{ m.paramEmpty }}</strong><p>{{ m.paramEmptyHint }}</p><button type="button" :disabled="readonly" @click="editor.add">+ {{ m.paramAdd }}</button></div>
      <aside v-if="changes.added.length || changes.removed.length" class="mr-param-editor__impact"><strong>{{ m.paramChanges }}</strong><p v-if="changes.added.length">{{ m.paramAdded }}：<code>{{ changes.added.join(', ') }}</code></p><p v-if="changes.removed.length">{{ m.paramRemoved }}：<code>{{ changes.removed.join(', ') }}</code></p><small>{{ m.paramRenameHint }}</small></aside>
      <p v-if="conflicted || error" class="mr-param-editor__errors" role="alert">{{ conflicted ? m.paramConflict : error }}</p>
      <footer><button type="button" :disabled="!pending && !conflicted" @click="editor.reset">{{ m.paramRestore }}</button><button type="button" class="is-primary" :disabled="readonly || !pending || conflicted || !!editor.issues.value.length" @click="editor.apply">{{ m.paramApply }}</button></footer>
    </div>
  </section>
</template>

<style scoped src="./param-editor.css"></style>
