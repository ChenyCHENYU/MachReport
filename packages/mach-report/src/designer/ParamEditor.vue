<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, ref, watch } from "vue";
import { PARAM_TYPES, PARAM_WIRE_FORMAT, useParamEditor, type ParamControl, type ParamDraft, type ParamEditorOptions } from "./useParamEditor";
const props = defineProps<ParamEditorOptions>();
const emit = defineEmits<{ (event: "dirty", pending: boolean): void }>();
const editor = useParamEditor(props);
const { m, rows, selected, current, changes, pending, conflicted, error, issues, issuesByRow } = editor;
const dependencyChoices = computed(() => {
  const choices = rows.value.filter((_, index) => index !== selected.value).map(row => ({ field: row.field, label: row.label || row.field || m.value.paramUnnamed }));
  for (const field of current.value?.dependsOn ?? []) if (!choices.some(choice => choice.field === field)) choices.push({ field, label: `${field} · ${m.value.paramDependencyUnavailable}` });
  return choices;
});
const main = ref<HTMLElement>();
const id = `mr-param-${getCurrentInstance()?.uid ?? 0}`;
watch(pending, value => emit("dirty", value), { immediate: true });
function typeLabel(type: ParamDraft["type"]): string {
  const labels = { text: m.value.paramText, number: m.value.paramNumber, date: m.value.paramDate, month: m.value.paramMonth, year: m.value.paramYear, dateRange: m.value.paramDateRange, select: m.value.paramSelect };
  return labels[type];
}
function addOption(): void { if (current.value && !props.readonly) current.value.options.push({ value: "", label: "" }); }
function removeOption(index: number): void { if (!props.readonly) current.value?.options.splice(index, 1); }
function controlAttrs(control: ParamControl): Record<string, string | undefined> {
  const invalid = editor.controlIssues(control).length > 0;
  return { "aria-invalid": invalid ? "true" : undefined, "aria-describedby": invalid ? `${id}-${selected.value}-${control}` : undefined };
}
function inputType(type: ParamDraft["type"]): string {
  if (type === "year") return "number";
  if (type === "dateRange") return "date";
  return ["date", "month", "number"].includes(type) ? type : "text";
}
function inputValue(event: Event): string { return (event.target as HTMLInputElement).value; }
function setValue(key: "defaultValue" | "min" | "max" | "minLength" | "maxLength", event: Event): void {
  if (current.value && !props.readonly) current.value[key] = inputValue(event);
}
function rangeValue(side: 0 | 1): string { return current.value?.defaultValue.split("/")[side] ?? ""; }
function setRange(side: 0 | 1, event: Event): void {
  if (!current.value || props.readonly) return;
  const pair = [rangeValue(0), rangeValue(1)]; pair[side] = inputValue(event);
  current.value.defaultValue = pair.some(Boolean) ? pair.join("/") : "";
}
async function locateIssue(): Promise<void> {
  const index = editor.firstIssueIndex.value;
  if (index === undefined) return;
  selected.value = index;
  await nextTick();
  const target = main.value?.querySelector<HTMLElement>('[aria-invalid="true"]');
  target?.focus({ preventScroll: true }); target?.scrollIntoView?.({ block: "nearest" });
}
defineExpose({ pending, reset: editor.reset, apply: editor.apply, locateIssue });
</script>

<template>
  <section class="mr-param-editor" :aria-label="m.paramsTool">
    <aside class="mr-param-editor__directory">
      <header><strong>{{ m.paramsDirectory }}</strong><span>{{ rows.length }}</span></header>
      <nav :aria-label="m.paramsDirectory">
        <button v-for="(row, index) in rows" :key="index" type="button" :aria-pressed="selected === index" :aria-label="`${row.label || row.field || m.paramUnnamed}${issuesByRow.get(index)?.length ? ` · ${m.paramIssueCount} ${issuesByRow.get(index)?.length}` : ''}`" :class="{ 'has-errors': issuesByRow.has(index) }" @click="selected = index">
          <span class="mr-param-editor__directory-title"><strong>{{ row.label || row.field || m.paramUnnamed }}</strong><span v-if="issuesByRow.has(index)" class="mr-param-editor__error-count" aria-hidden="true">{{ issuesByRow.get(index)?.length }}</span></span><small>{{ row.field }} · {{ typeLabel(row.type) }}<span v-if="row.required"> *</span></small>
        </button>
      </nav>
      <button type="button" class="mr-param-editor__add" :disabled="readonly" @click="editor.add">+ {{ m.paramAdd }}</button>
      <p>{{ m.paramsDescription }}</p>
    </aside>
    <div ref="main" class="mr-param-editor__main">
      <div v-if="issues.length" class="mr-param-editor__validation" role="status"><span>{{ m.paramIssueCount }} <strong>{{ issues.length }}</strong></span><button type="button" @click="locateIssue">{{ m.paramLocateFirst }}</button></div>
      <template v-if="current">
        <header class="mr-param-editor__heading"><div><strong>{{ current.label || current.field || m.paramUnnamed }}</strong><small>{{ typeLabel(current.type) }}</small></div><span :class="{ 'is-pending': pending || issues.length > 0 }">{{ issues.length ? m.paramInvalid : pending ? m.paramPending : m.paramReady }}</span></header>
        <div class="mr-param-editor__grid">
          <label>{{ m.paramField }}<input v-model="current.field" :aria-label="m.paramField" :disabled="readonly" autocomplete="off" v-bind="controlAttrs('field')"><small v-if="editor.controlIssues('field').length" :id="`${id}-${selected}-field`" class="mr-param-editor__field-error">{{ editor.controlIssues('field').join('；') }}</small></label>
          <label>{{ m.paramLabel }}<input v-model="current.label" :aria-label="m.paramLabel" :disabled="readonly"></label>
          <label>{{ m.paramType }}<select :value="current.type" :aria-label="m.paramType" :disabled="readonly" v-bind="controlAttrs('type')" @change="editor.setType(($event.target as HTMLSelectElement).value as ParamDraft['type'])"><option v-for="type in PARAM_TYPES" :key="type" :value="type">{{ typeLabel(type) }}</option></select><small v-if="editor.controlIssues('type').length" :id="`${id}-${selected}-type`" class="mr-param-editor__field-error">{{ editor.controlIssues('type').join('；') }}</small></label>
          <label>{{ m.paramPlaceholder }}<input v-model="current.placeholder" :aria-label="m.paramPlaceholder" :disabled="readonly"></label>
          <div class="mr-param-editor__checks"><label><input v-model="current.required" type="checkbox" :disabled="readonly">{{ m.paramRequired }}</label><label><input v-model="current.defaultEnabled" type="checkbox" :disabled="readonly">{{ m.paramDefaultEnabled }}</label></div>
          <div v-if="current.defaultEnabled" class="mr-param-editor__default" :class="{ 'is-range': current.type === 'dateRange' }">
            <template v-if="current.type === 'dateRange'"><span class="mr-param-editor__default-label">{{ m.paramDefault }}</span><div class="mr-param-editor__range"><label>{{ m.paramRangeStart }}<input :value="rangeValue(0)" type="date" :aria-label="m.paramRangeStart" :disabled="readonly" v-bind="controlAttrs('defaultValue')" @input="setRange(0, $event)"></label><span aria-hidden="true">—</span><label>{{ m.paramRangeEnd }}<input :value="rangeValue(1)" type="date" :aria-label="m.paramRangeEnd" :disabled="readonly" v-bind="controlAttrs('defaultValue')" @input="setRange(1, $event)"></label></div></template>
            <label v-else>{{ m.paramDefault }}<select v-if="current.type === 'select' && current.optionsMode !== 'remote'" v-model="current.defaultValue" :aria-label="m.paramDefault" :disabled="readonly" v-bind="controlAttrs('defaultValue')"><option value=""></option><option v-for="(option, index) in current.options" :key="index" :value="option.value">{{ option.label || option.value }}</option></select><input v-else :value="current.defaultValue" :aria-label="m.paramDefault" :type="inputType(current.type)" :min="current.type === 'year' ? 1 : undefined" :max="current.type === 'year' ? 9999 : undefined" :step="current.type === 'year' ? 1 : 'any'" :disabled="readonly" v-bind="controlAttrs('defaultValue')" @input="setValue('defaultValue', $event)"></label>
            <small v-if="editor.controlIssues('defaultValue').length" :id="`${id}-${selected}-defaultValue`" class="mr-param-editor__field-error mr-param-editor__errors" role="alert">{{ editor.controlIssues('defaultValue').join('；') }}</small>
          </div>
          <template v-if="['number', 'date', 'month', 'year', 'dateRange'].includes(current.type)">
            <label v-for="bound in ['min', 'max'] as const" :key="bound">{{ bound === 'min' ? m.paramMinimum : m.paramMaximum }}<input :value="current[bound]" :aria-label="bound === 'min' ? m.paramMinimum : m.paramMaximum" :type="inputType(current.type)" :min="current.type === 'year' ? 1 : undefined" :max="current.type === 'year' ? 9999 : undefined" :step="current.type === 'year' ? 1 : 'any'" :disabled="readonly" v-bind="controlAttrs(bound)" @input="setValue(bound, $event)"><small v-if="editor.controlIssues(bound).length" :id="`${id}-${selected}-${bound}`" class="mr-param-editor__field-error">{{ editor.controlIssues(bound).join('；') }}</small></label>
          </template>
          <template v-if="current.type === 'text'">
            <label v-for="bound in ['minLength', 'maxLength'] as const" :key="bound">{{ bound === 'minLength' ? m.paramMinLength : m.paramMaxLength }}<input :value="current[bound]" type="number" min="0" step="1" :aria-label="bound === 'minLength' ? m.paramMinLength : m.paramMaxLength" :disabled="readonly" v-bind="controlAttrs(bound)" @input="setValue(bound, $event)"><small v-if="editor.controlIssues(bound).length" :id="`${id}-${selected}-${bound}`" class="mr-param-editor__field-error">{{ editor.controlIssues(bound).join('；') }}</small></label>
          </template>
        </div>
        <p v-if="current.type === 'dateRange'" class="mr-param-editor__hint">{{ m.paramRangeHint }}</p>
        <fieldset v-if="current.type === 'select'" class="mr-param-editor__options"><legend>{{ m.paramOptionsMode }}</legend><label>{{ m.paramOptionsMode }}<select v-model="current.optionsMode" :aria-label="m.paramOptionsMode" :disabled="readonly"><option value="static">{{ m.paramOptionsStatic }}</option><option value="remote">{{ m.paramOptionsRemote }}</option></select></label><template v-if="current.optionsMode === 'remote'"><label>{{ m.paramOptionsSource }}<input v-model="current.optionsSource" :aria-label="m.paramOptionsSource" :disabled="readonly" v-bind="controlAttrs('optionsSource')" /></label><small v-if="editor.controlIssues('optionsSource').length" :id="`${id}-${selected}-optionsSource`" class="mr-param-editor__field-error">{{ editor.controlIssues('optionsSource').join('；') }}</small><fieldset class="mr-param-editor__dependencies" tabindex="-1" v-bind="controlAttrs('dependsOn')"><legend>{{ m.paramDependencies }}</legend><label v-for="(row, index) in dependencyChoices" :key="index"><input v-model="current.dependsOn" type="checkbox" :value="row.field" :disabled="readonly" />{{ row.label }}</label></fieldset><small v-if="editor.controlIssues('dependsOn').length" :id="`${id}-${selected}-dependsOn`" class="mr-param-editor__field-error">{{ editor.controlIssues('dependsOn').join('；') }}</small><p class="mr-param-editor__hint">{{ m.paramRemoteHint }}</p></template></fieldset>
        <fieldset v-if="current.type === 'select' && current.optionsMode === 'static'" class="mr-param-editor__options"><legend>{{ m.paramOptions }}</legend><div class="mr-param-editor__option-head"><span>{{ m.paramOptionValue }}</span><span>{{ m.paramOptionLabel }}</span></div><div v-for="(option, index) in current.options" :key="index" class="mr-param-editor__option"><input v-model="option.value" :aria-label="`${m.paramOptionValue} ${index + 1}`" :disabled="readonly" v-bind="controlAttrs('options')"><input v-model="option.label" :aria-label="`${m.paramOptionLabel} ${index + 1}`" :disabled="readonly"><button type="button" :aria-label="`${m.paramOptionRemove} ${index + 1}`" :disabled="readonly" @click="removeOption(index)">×</button></div><small v-if="editor.controlIssues('options').length" :id="`${id}-${selected}-options`" class="mr-param-editor__field-error">{{ editor.controlIssues('options').join('；') }}</small><button type="button" :disabled="readonly" @click="addOption">+ {{ m.paramOptionAdd }}</button></fieldset>
        <div class="mr-param-editor__row-actions"><button type="button" :disabled="readonly || selected === 0" @click="editor.move(-1)">↑ {{ m.paramMoveUp }}</button><button type="button" :disabled="readonly || selected === rows.length - 1" @click="editor.move(1)">↓ {{ m.paramMoveDown }}</button><button type="button" class="is-danger" :disabled="readonly" @click="editor.remove">{{ m.paramRemove }}</button></div>
        <details class="mr-param-editor__technical"><summary>{{ m.paramWire }}</summary><code>{{ PARAM_WIRE_FORMAT[current.type] }}</code></details>
      </template>
      <div v-else class="mr-param-editor__empty"><strong>{{ m.paramEmpty }}</strong><p>{{ m.paramEmptyHint }}</p><button type="button" :disabled="readonly" @click="editor.add">+ {{ m.paramAdd }}</button></div>
      <aside v-if="changes.added.length || changes.removed.length" class="mr-param-editor__impact"><strong>{{ m.paramChanges }}</strong><p v-if="changes.added.length">{{ m.paramAdded }}：<code>{{ changes.added.join(', ') }}</code></p><p v-if="changes.removed.length">{{ m.paramRemoved }}：<code>{{ changes.removed.join(', ') }}</code></p><small>{{ m.paramRenameHint }}</small></aside>
      <p v-if="conflicted || error" class="mr-param-editor__errors" role="alert">{{ conflicted ? m.paramConflict : error }}</p>
      <footer><button type="button" :disabled="!pending && !conflicted" @click="editor.reset">{{ m.paramRestore }}</button><button type="button" class="is-primary" :disabled="readonly || !pending || conflicted || !!issues.length" @click="editor.apply">{{ m.paramApply }}</button></footer>
    </div>
  </section>
</template>

<style scoped src="./param-editor.css"></style>
