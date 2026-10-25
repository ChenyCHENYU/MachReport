<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { parseReportParamSelection, formatReportParamSelection, type ReportParamDef } from "@agile-team/mach-report";
import type { MachReportMessages } from "./config";
import { PARAM_OPTIONS_MESSAGES, type ReportParamOption, type ReportParamOptionsLoader, type ReportParamOptionsMessages } from "./param-options";
import { usePopover } from "./composables/usePopover";
import { useParamOptions } from "./composables/useParamOptions";
import ReportIcon from "./ReportIcon.vue";
const props = defineProps<{ def: ReportParamDef; value: string; values: Readonly<Record<string, string>>; loadOptions?: ReportParamOptionsLoader; messages: MachReportMessages & ReportParamOptionsMessages; disabled?: boolean; id: string; invalid?: boolean }>();
const emit = defineEmits<{ (event: "change", value: string): void }>();
const popup = usePopover({ focusOnOpen: false }), { root, panel, opened } = popup;
const state = useParamOptions({ def: () => props.def, values: () => props.values, loader: () => props.loadOptions, opened: () => opened.value, disabled: () => props.disabled === true });
const { query, options, loading, failed, waiting, missingLoader } = state;
const m = computed(() => ({ ...PARAM_OPTIONS_MESSAGES, ...props.messages }));
const multiple = computed(() => props.def.type === "multiSelect");
const selected = computed(() => multiple.value ? parseReportParamSelection(props.value) ?? [] : [props.value]);
const shownOptions = computed(() => props.def.optionsSource ? options.value : (props.def.options ?? []).filter(option => `${option.label} ${option.value}`.toLocaleLowerCase().includes(query.value.toLocaleLowerCase())).slice(0, 100));
const selectedLabels = new Map<string, string>();
const display = computed(() => multiple.value ? selected.value.map(value => selectedLabels.get(value) ?? props.def.options?.find(option => option.value === value)?.label ?? value).join("、") : selectionLabel.value || props.value);
const active = ref(0), selectionLabel = ref("");
const input = ref<HTMLInputElement>();
const listId = computed(() => `${props.id}-options`);
const status = computed(() => waiting.value ? m.value.paramOptionsDependencies : props.def.optionsSource && missingLoader.value ? m.value.paramOptionsMissingLoader : failed.value ? m.value.paramOptionsFailed : loading.value ? m.value.paramOptionsLoading : shownOptions.value.length ? "" : m.value.paramOptionsEmpty);
watch(() => props.value, () => { selectionLabel.value = ""; });
watch(shownOptions, () => { active.value = 0; });
watch(() => [props.def.field, props.def.optionsSource, JSON.stringify(props.def.options)], () => { selectedLabels.clear(); selectionLabel.value = ""; });
watch(opened, value => { if (value) void nextTick(() => input.value?.focus()); });
function choose(option: ReportParamOption): void {
  if (props.disabled || waiting.value || loading.value || failed.value) return;
  selectedLabels.set(option.value, option.label);
  for (const key of selectedLabels.keys()) if (key !== option.value && !selected.value.includes(key)) selectedLabels.delete(key);
  if (multiple.value) {
    const next = selected.value.includes(option.value) ? selected.value.filter(value => value !== option.value) : [...selected.value, option.value];
    if (next.length > Math.min(props.def.maxItems ?? 100, 100)) return;
    emit("change", next.length ? formatReportParamSelection(next) : "");
  } else { emit("change", option.value); popup.close(); }
  void nextTick(() => { selectionLabel.value = option.label; input.value?.focus(); });
}
function search(event: Event): void {
  if ((event as InputEvent).isComposing) return;
  opened.value = true; query.value = (event.target as HTMLInputElement).value;
}
function open(): void { if (!props.disabled && !waiting.value && (!props.def.optionsSource || !missingLoader.value)) { query.value = ""; opened.value = true; } }
function keyboard(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === "Escape") { if (opened.value) { event.preventDefault(); event.stopPropagation(); popup.close(); } return; }
  if (!["ArrowUp", "ArrowDown", "Enter"].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation();
  if (!opened.value) { open(); return; }
  if (event.key === "Enter") { const option = shownOptions.value[active.value]; if (option) choose(option); return; }
  if (!shownOptions.value.length) return;
  active.value = (active.value + (event.key === "ArrowDown" ? 1 : -1) + shownOptions.value.length) % shownOptions.value.length;
  void nextTick(() => panel.value?.querySelector<HTMLElement>(`[id="${listId.value}-${active.value}"]`)?.scrollIntoView?.({ block: "nearest" }));
}
function clear(): void { if (!props.disabled) { emit("change", ""); selectionLabel.value = ""; popup.close(); } }
</script>
<template>
  <div ref="root" class="mrp-remote-param">
    <div class="mrp-remote-control" :class="{ 'is-invalid': invalid }">
      <ReportIcon name="search" :size="14" />
      <input :id="id" ref="input" type="text" role="combobox" autocomplete="off" :value="opened ? query : display" :maxlength="256" :aria-labelledby="`${id}-label`" :aria-invalid="invalid || undefined" :aria-required="def.required || undefined" :aria-describedby="invalid ? `${id}-error` : waiting || def.optionsSource && missingLoader ? `${id}-remote-status` : undefined" aria-autocomplete="list" :aria-expanded="opened" :aria-controls="opened ? listId : undefined" :aria-activedescendant="opened && shownOptions.length ? `${listId}-${active}` : undefined" :disabled="disabled || waiting || !!def.optionsSource && missingLoader" :placeholder="def.placeholder ?? (messages.paramSelectPlaceholder ?? '请选择{label}').replace('{label}', def.label ?? def.field)" @click="open" @input="search" @compositionend="search" @keydown="keyboard" />
      <button v-if="value" type="button" :aria-label="m.paramOptionsClear" :disabled="disabled" @click="clear"><ReportIcon name="close" :size="12" /></button>
      <button v-else type="button" :aria-label="def.label ?? def.field" :disabled="disabled || waiting || !!def.optionsSource && missingLoader" @click="opened ? popup.close() : open()"><ReportIcon name="chevron-down" :size="12" /></button>
    </div>
    <small v-if="waiting || def.optionsSource && missingLoader" :id="`${id}-remote-status`" role="status">{{ status }}</small>
    <div v-if="opened" ref="panel" class="mrp-remote-options">
      <div :id="listId" role="listbox" :aria-label="def.label ?? def.field" :aria-busy="loading" :aria-multiselectable="multiple || undefined">
        <button v-for="(option, index) in shownOptions" :id="`${listId}-${index}`" :key="option.value" type="button" role="option" tabindex="-1" :aria-selected="selected.includes(option.value)" :class="{ active: index === active }" :disabled="loading" @pointermove="active = index" @mousedown.prevent @click="choose(option)"><span><span v-if="multiple" aria-hidden="true" class="mrp-option-check">{{ selected.includes(option.value) ? "✓" : "" }}</span>{{ option.label }}</span><small v-if="option.label !== option.value">{{ option.value }}</small></button>
      </div>
      <p v-if="status" role="status">{{ status }}<button v-if="failed" type="button" @click="state.request">{{ messages.retry }}</button></p>
    </div>
  </div>
</template>
<style scoped>
.mrp-option-check{display:inline-block;width:16px;color:var(--mrp-btn-active-bg,#2563eb)}
[role=option][aria-selected=true]{background:var(--mrp-btn-hover-bg,#eff6ff)}
.mrp-remote-param{position:relative;min-width:180px;max-width:300px;color:var(--mrp-toolbar-fg,#334155);font-size:12px}
.mrp-remote-control{display:flex;align-items:center;gap:6px;border:1px solid var(--mrp-btn-border,#cbd5e1);border-radius:6px;padding:2px 7px;background:var(--mrp-toolbar-bg,#fff)}
.mrp-remote-control:focus-within{outline:2px solid color-mix(in srgb,var(--mrp-btn-active-bg,#2563eb) 30%,transparent);border-color:var(--mrp-btn-active-bg,#2563eb)}
.mrp-remote-control.is-invalid{border-color:var(--mrp-error-fg,#c05050)}
input{min-width:0;width:100%;padding:3px 0;border:0;outline:0;background:transparent;color:inherit;font:inherit}
button{font:inherit;color:inherit;cursor:pointer}button:disabled,input:disabled{opacity:.5;cursor:default}
.mrp-remote-control>button{display:flex;align-items:center;justify-content:center;flex:none;padding:3px;border:0;background:transparent}
.mrp-remote-control>svg{opacity:.55;flex:none}.mrp-remote-param>small{display:block;margin-top:3px;opacity:.7;font-size:10px}
.mrp-remote-options{position:absolute;z-index:35;top:calc(100% + 5px);left:0;width:max(100%,230px);max-width:min(360px,80vw);border:1px solid var(--mrp-toolbar-border,#e2e8f0);border-radius:8px;background:var(--mrp-toolbar-bg,#fff);box-shadow:0 8px 28px #12345620;padding:5px}
[role=listbox]{max-height:240px;overflow:auto;overscroll-behavior:contain}[role=option]{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;text-align:left;padding:7px 9px;border:0;border-radius:5px;background:transparent;overflow-wrap:anywhere}[role=option].active{background:var(--mrp-btn-hover-bg,#eff6ff);color:var(--mrp-btn-hover-fg,#1d4ed8)}[role=option] small{color:var(--mrp-btn-fg,#526078);font-size:10px}
p{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0;padding:10px;font-size:11px;opacity:.8}p button{border:0;background:transparent;color:var(--mrp-btn-hover-fg,#1d4ed8)}button:focus-visible{outline:2px solid var(--mrp-btn-active-bg,#2563eb);outline-offset:2px}
</style>
