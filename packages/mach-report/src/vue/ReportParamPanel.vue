<script setup lang="ts">
/**
 * 参数面板（值由面板本地字典为唯一真相，整体上抛）：
 * - 四类控件：text / number / date / select（options 声明式）
 * - 连续填写多参数不丢值（本地聚合后整体 emit，避免基于 props 快照合成
 *   被并发事件覆盖——"先选仓库再填关键字丢仓库"的根源修复）
 * - 必填校验：仅查询触发后红框提示（避免首屏一片红）
 * 主题与文案全部走 --mrp-* 变量 / messages（无硬编码）。
 */
import { computed, ref, watch } from "vue";
import type { ReportParamDef } from "@agile-team/mach-report";
import type { MachReportMessages } from "./config";

const props = defineProps<{
  defs: ReportParamDef[];
  modelValue: Record<string, string>;
  messages: MachReportMessages;
  /** 触发过查询后才开始必填提示（避免首屏一片红） */
  attempted: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: Record<string, string>): void;
  (e: "query"): void;
  (e: "reset"): void;
}>();

/** 本地值字典：外部整体替换（重置/初始化）时同步；控件输入只改本地并整体上抛 */
const local = ref<Record<string, string>>({ ...props.modelValue });
watch(
  () => props.modelValue,
  (v) => {
    local.value = { ...v };
  }
);

const items = computed(() =>
  props.defs.map((def) => ({
    def,
    label: def.label ?? def.field,
    value: local.value[def.field] ?? ""
  }))
);

function setField(field: string, value: string): void {
  local.value = { ...local.value, [field]: value };
  emit("update:modelValue", { ...local.value });
}

function missing(field: string): boolean {
  const def = props.defs.find((d) => d.field === field);
  return props.attempted && def?.required === true && !(local.value[field] ?? "").trim();
}
</script>

<template>
  <div class="mrp-params">
    <span class="mrp-params-title">{{ messages.paramsTitle }}</span>
    <div class="mrp-params-grid">
      <label
        v-for="item in items"
        :key="item.def.field"
        class="mrp-param"
        :class="{ 'mrp-param-missing': missing(item.def.field) }"
      >
        <span class="mrp-param-label">
          {{ item.label }}<i v-if="item.def.required" class="mrp-param-star">*</i>
        </span>
        <select
          v-if="(item.def.type ?? 'text') === 'select'"
          class="mrp-param-input"
          :value="item.value"
          @change="setField(item.def.field, ($event.target as HTMLSelectElement).value)"
          @keydown.enter="$emit('query')"
        >
          <option value="" disabled hidden>{{ item.def.placeholder ?? `请选择${item.label}` }}</option>
          <option v-for="opt in item.def.options ?? []" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
        <input
          v-else
          class="mrp-param-input"
          :type="item.def.type === 'number' ? 'number' : item.def.type === 'date' ? 'date' : 'text'"
          :placeholder="item.def.placeholder ?? `请输入${item.label}`"
          :value="item.value"
          @input="setField(item.def.field, ($event.target as HTMLInputElement).value)"
          @keydown.enter="$emit('query')"
        >
      </label>
    </div>
    <div class="mrp-params-actions">
      <button class="mrp-nav mrp-param-query" type="button" @click="$emit('query')">{{ messages.query }}</button>
      <button class="mrp-nav" type="button" @click="$emit('reset')">{{ messages.reset }}</button>
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
  background: #22252a;
  color: #e8e8e8;
  border: 1px solid var(--mrp-btn-border, #4a4d52);
  border-radius: 4px;
  padding: 3px 8px;
  font-size: 12px;
  min-width: 130px;
  outline: none;
}
.mrp-param-input:focus { border-color: var(--mrp-btn-active-bg, #2d5fb8); }
.mrp-param-missing .mrp-param-input { border-color: #ff7b72; }
select.mrp-param-input option { background: #22252a; }
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
