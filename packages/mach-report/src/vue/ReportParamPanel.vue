<script setup lang="ts">
/**
 * 参数面板（值由面板本地字典为唯一真相，整体上抛）：
 * - 声明式文本、数字、日期/月/年、日期范围与静态下拉控件
 * - 连续填写多参数不丢值（本地聚合后整体 emit，避免基于 props 快照合成
 *   被并发事件覆盖——"先选仓库再填关键字丢仓库"的根源修复）
 * - 必填校验：仅查询触发后红框提示（避免首屏一片红）
 * 主题与文案全部走 --mrp-* 变量 / messages（无硬编码）。
 */
import { computed, ref, watch } from "vue";
import { validateReportParams, type ReportParamDef, type ReportParamIssue } from "@agile-team/mach-report";
import type { MachReportMessages } from "./config";
import { createParamPanelId, paramIssueMessage } from "./composables/useReportParams";

const props = withDefaults(defineProps<{
  defs: ReportParamDef[];
  modelValue: Record<string, string>;
  messages: MachReportMessages;
  /** 触发过查询后才开始必填提示（避免首屏一片红） */
  attempted: boolean;
  issues?: readonly ReportParamIssue[];
  /** Embedded batch forms reuse the same typed inputs without per-row query buttons. */
  showActions?: boolean;
  showTitle?: boolean;
  disabled?: boolean;
}>(), { showActions: true, showTitle: true, disabled: false, issues: undefined });

const emit = defineEmits<{
  (e: "update:modelValue", value: Record<string, string>): void;
  (e: "query"): void;
  (e: "reset"): void;
}>();

/** 本地值字典：外部整体替换（重置/初始化）时同步；控件输入只改本地并整体上抛 */
const local = ref<Record<string, string>>({ ...props.modelValue });
const root = ref<HTMLElement | null>(null);
const panelId = createParamPanelId();
watch(
  () => props.modelValue,
  (v) => {
    local.value = { ...v };
  }
);

const issues = computed(() => props.issues ?? validateReportParams(props.defs, local.value).issues);
const items = computed(() =>
  (Array.isArray(props.defs) ? props.defs : []).filter((def) => def && typeof def.field === "string").map((def, index) => ({
    def,
    id: `${panelId}-${index}`,
    label: def.label ?? def.field,
    value: local.value[def.field] ?? "",
    error: props.attempted ? issues.value.find((issue) => issue.field === def.field) : undefined
  }))
);

function setField(field: string, value: string): void {
  local.value = { ...local.value, [field]: value };
  emit("update:modelValue", { ...local.value });
}

function inputType(def: ReportParamDef): string {
  if (def.type === "number") return "number";
  if (def.type === "date" || def.type === "month") return def.type;
  return "text";
}
function rangePart(value: string, index: number): string { return value.split("/")[index] ?? ""; }
function rangeInvalid(value: string, index: number, error: ReportParamIssue | undefined): boolean | undefined {
  if (!error) return undefined;
  const partial = !!rangePart(value, 0) !== !!rangePart(value, 1);
  return partial ? !rangePart(value, index) || undefined : true;
}
function setRangeField(field: string, index: number, value: string): void {
  const parts = [rangePart(local.value[field] ?? "", 0), rangePart(local.value[field] ?? "", 1)];
  parts[index] = value;
  setField(field, parts.every(part => !part) ? "" : parts.join("/"));
}

function query(event: KeyboardEvent): void {
  if (!event.isComposing) emit("query");
}
function focusInvalid(): void { root.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(); }
defineExpose({ focusInvalid });
</script>

<template>
  <div ref="root" class="mrp-params">
    <span v-if="showTitle !== false" class="mrp-params-title">{{ messages.paramsTitle }}</span>
    <div class="mrp-params-grid">
      <label
        v-for="item in items"
        :key="item.id"
        class="mrp-param"
        :class="{ 'mrp-param-missing': !!item.error }"
      >
        <span :id="`${item.id}-label`" class="mrp-param-label">
          {{ item.label }}<i v-if="item.def.required" class="mrp-param-star">*</i>
        </span>
        <select
          v-if="(item.def.type ?? 'text') === 'select'"
          class="mrp-param-input"
          :value="item.value"
          :disabled="disabled"
          :aria-labelledby="`${item.id}-label`"
          :aria-invalid="item.error ? true : undefined"
          :aria-describedby="item.error ? `${item.id}-error` : undefined"
          :aria-required="item.def.required || undefined"
          @change="setField(item.def.field, ($event.target as HTMLSelectElement).value)"
          @keydown.enter="query"
        >
          <option value="" :disabled="item.def.required" :hidden="item.def.required">{{ item.def.placeholder ?? (messages.paramSelectPlaceholder ?? '请选择{label}').replace('{label}', item.label) }}</option>
          <option v-for="opt in item.def.options ?? []" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
        <div v-else-if="item.def.type === 'dateRange'" class="mrp-param-range" role="group" :aria-labelledby="`${item.id}-label`">
          <input
            v-for="(part, index) in [messages.paramRangeStart ?? '开始日期', messages.paramRangeEnd ?? '结束日期']"
            :key="index"
            class="mrp-param-input"
            type="date"
            :value="rangePart(item.value, index)"
            :disabled="disabled"
            :min="item.def.min"
            :max="item.def.max"
            :aria-label="`${item.label} · ${part}`"
            :aria-invalid="rangeInvalid(item.value, index, item.error)"
            :aria-describedby="item.error ? `${item.id}-error` : undefined"
            :aria-required="item.def.required || undefined"
            @input="setRangeField(item.def.field, index, ($event.target as HTMLInputElement).value)"
            @keydown.enter="query"
          >
        </div>
        <input
          v-else
          class="mrp-param-input"
          :type="inputType(item.def)"
          :inputmode="item.def.type === 'year' ? 'numeric' : undefined"
          :maxlength="item.def.type === 'year' ? 4 : undefined"
          :placeholder="item.def.placeholder ?? (messages.paramTextPlaceholder ?? '请输入{label}').replace('{label}', item.label)"
          :value="item.value"
          :disabled="disabled"
          :min="item.def.min"
          :max="item.def.max"
          :step="item.def.type === 'number' ? 'any' : undefined"
          :aria-labelledby="`${item.id}-label`"
          :aria-invalid="item.error ? true : undefined"
          :aria-describedby="item.error ? `${item.id}-error` : undefined"
          :aria-required="item.def.required || undefined"
          @input="setField(item.def.field, ($event.target as HTMLInputElement).value)"
          @keydown.enter="query"
        >
        <small v-if="item.error" :id="`${item.id}-error`" class="mrp-param-error" role="status">{{ paramIssueMessage(item.error, defs, messages) }}</small>
      </label>
    </div>
    <div v-if="showActions !== false" class="mrp-params-actions">
      <button class="mrp-nav mrp-param-query" type="button" :disabled="disabled" @click="$emit('query')">{{ messages.query }}</button>
      <button class="mrp-nav" type="button" :disabled="disabled" @click="$emit('reset')">{{ messages.reset }}</button>
    </div>
  </div>
</template>

<style scoped>
.mrp-params {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  padding: 6px 12px;
  background: var(--mrp-toolbar-bg, #323639);
  border-bottom: 1px solid var(--mrp-toolbar-border, #22252a);
  flex: none;
  flex-wrap: wrap;
}
.mrp-params-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--mrp-toolbar-fg, #e8e8e8);
  padding-bottom: 5px;
  white-space: nowrap;
}
.mrp-params-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  flex: 1;
}
.mrp-param {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mrp-param-label {
  font-size: 11px;
  color: var(--mrp-toolbar-fg, #e8e8e8);
  opacity: 0.85;
}
.mrp-param-star {
  color: #ff7b72;
  font-style: normal;
  margin-left: 2px;
}
.mrp-param-input {
  background: var(--mrp-toolbar-bg, #323639);
  color: var(--mrp-toolbar-fg, #e8e8e8);
  border: 1px solid var(--mrp-btn-border, #4a4d52);
  border-radius: 4px;
  padding: 3px 8px;
  font-size: 12px;
  min-width: 130px;
  outline: none;
}
.mrp-param-input:focus { border-color: var(--mrp-btn-active-bg, #2d5fb8); }
.mrp-param-range { display: flex; gap: 6px; }
.mrp-param-range .mrp-param-input { min-width: 120px; }
.mrp-param-missing .mrp-param-input { border-color: #ff7b72; }
select.mrp-param-input option { background: var(--mrp-toolbar-bg, #323639); color: var(--mrp-toolbar-fg, #e8e8e8); }
.mrp-param-error { max-width: 260px; color: var(--mrp-error-fg, #e35d59); font-size: 11px; }
.mrp-params-actions { display: flex; gap: 6px; padding-bottom: 1px; }
.mrp-nav {
  background: transparent;
  color: var(--mrp-btn-fg, #cfcfcf);
  border: 1px solid var(--mrp-btn-border, #4a4d52);
  border-radius: 4px;
  padding: 4px 14px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.mrp-nav:hover { background: var(--mrp-btn-hover-bg, #414549); color: var(--mrp-btn-hover-fg, #fff); }
.mrp-param-query {
  background: var(--mrp-btn-active-bg, #2d5fb8);
  border-color: var(--mrp-btn-active-bg, #2d5fb8);
  color: #fff;
}
</style>
