<script setup lang="ts">
import { computed } from "vue";
import { parseReportCascaderPath, formatReportCascaderPath, type ReportParamDef } from "@agile-team/mach-report";
import type { MachReportMessages } from "./config";
import { PARAM_OPTIONS_MESSAGES, type ReportParamOption, type ReportParamOptionsLoader } from "./param-options";
import { useParamOptions } from "./composables/useParamOptions";
const props = defineProps<{ def: ReportParamDef; value: string; values: Readonly<Record<string, string>>; loadOptions?: ReportParamOptionsLoader; messages: MachReportMessages; disabled?: boolean; id: string; invalid?: boolean }>();
const emit = defineEmits<{ (event: "change", value: string): void }>();
const state = useParamOptions({ def: () => props.def, values: () => props.values, loader: () => props.loadOptions, opened: () => true, disabled: () => props.disabled === true });
const path = computed(() => {
  const complete = parseReportCascaderPath(props.value); if (complete) return complete;
  // An incomplete selection uses a null tail, just like a half-filled number range.
  // Shared validation rejects it on both browser and server before any query.
  try { const draft: unknown = JSON.parse(props.value); return Array.isArray(draft) && draft.length <= 16 && draft[draft.length - 1] === null && draft.slice(0, -1).every(part => typeof part === "string") ? draft.slice(0, -1) as string[] : []; } catch { return []; }
});
const m = computed(() => ({ ...PARAM_OPTIONS_MESSAGES, ...props.messages }));
const levels = computed(() => {
  const result: Array<readonly ReportParamOption[]> = [];
  let options: readonly ReportParamOption[] = props.def.optionsSource ? state.options.value : props.def.options ?? [];
  for (let level = 0; level < 16 && options.length; level++) {
    result.push(options);
    options = options.find(option => option.value === path.value[level])?.children ?? [];
  }
  return result;
});
const status = computed(() => !props.def.optionsSource ? "" : state.waiting.value ? m.value.paramOptionsDependencies : state.missingLoader.value ? m.value.paramOptionsMissingLoader : state.failed.value ? m.value.paramOptionsFailed : state.loading.value ? m.value.paramOptionsLoading : !levels.value.length ? m.value.paramOptionsEmpty : "");
function change(level: number, value: string): void {
  if (props.disabled) return;
  const next = path.value.slice(0, level); if (value) next.push(value);
  const child = value ? levels.value[level]?.find(option => option.value === value)?.children : levels.value[level];
  emit("change", !next.length ? "" : child?.length ? JSON.stringify([...next, null]) : formatReportCascaderPath(next));
}
</script>
<template>
  <div class="mrp-cascader" role="group" :aria-labelledby="`${id}-label`">
    <select v-for="(options, level) in levels" :key="level" class="mrp-param-input" :value="path[level] ?? ''" :disabled="disabled || state.loading.value" :aria-label="`${def.label ?? def.field} · ${level + 1}`" :aria-invalid="invalid || undefined" :aria-describedby="invalid ? `${id}-error` : status ? `${id}-status` : undefined" :aria-required="def.required || undefined" @change="change(level, ($event.target as HTMLSelectElement).value)">
      <option value="">{{ def.placeholder ?? (messages.paramSelectPlaceholder ?? '请选择{label}').replace('{label}', def.label ?? def.field) }}</option>
      <option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option>
    </select>
    <small v-if="status" :id="`${id}-status`" role="status">{{ status }}<button v-if="state.failed.value" type="button" @click="state.request">{{ messages.retry }}</button></small>
  </div>
</template>
<style scoped>
.mrp-cascader{display:flex;align-items:center;gap:6px;flex-wrap:wrap;max-width:540px}
select{min-width:110px;max-width:190px;padding:4px 8px;border:1px solid var(--mrp-btn-border,#cbd5e1);border-radius:6px;background:var(--mrp-toolbar-bg,#fff);color:var(--mrp-toolbar-fg,#334155);font-size:12px}
select:focus-visible{outline:2px solid var(--mrp-btn-active-bg,#2563eb);outline-offset:2px}select[aria-invalid=true]{border-color:var(--mrp-error-fg,#c05050)}
small{font-size:11px;opacity:.75}small button{border:0;background:transparent;color:var(--mrp-btn-active-bg,#2563eb);cursor:pointer}
</style>
