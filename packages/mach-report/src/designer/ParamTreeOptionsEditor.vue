<script setup lang="ts">
import { computed } from "vue";
import type { ReportParamTreeOption } from "@agile-team/mach-report";
import type { ParamEditorMessages } from "./param-messages";
const props = defineProps<{ modelValue: ReportParamTreeOption[]; messages: ParamEditorMessages; readonly?: boolean }>();
const emit = defineEmits<{ (event: "update:modelValue", value: ReportParamTreeOption[]): void }>();
const rows = computed(() => {
  const output: Array<{ item: ReportParamTreeOption; path: number[] }> = [];
  const queue = props.modelValue.map((item, index) => ({ item, path: [index] }));
  for (let cursor = 0; cursor < queue.length && output.length < 1000; cursor++) {
    const row = queue[cursor]!; output.push(row);
    if (row.path.length < 16) queue.splice(cursor + 1, 0, ...(row.item.children ?? []).map((item, index) => ({ item, path: [...row.path, index] })));
  }
  return output;
});
function edit(path: readonly number[], operation: "value" | "label" | "add" | "remove", value = ""): void {
  if (props.readonly) return;
  const result = JSON.parse(JSON.stringify(props.modelValue)) as ReportParamTreeOption[];
  let siblings = result;
  for (const index of path.slice(0, -1)) siblings = siblings[index]!.children!;
  const index = path[path.length - 1]!, item = siblings[index];
  if (operation === "remove") siblings.splice(index, 1);
  else if (operation === "add") {
    if (rows.value.length >= 1000 || path.length >= 16) return;
    if (item) (item.children ??= []).push({ label: "", value: "" }); else result.push({ label: "", value: "" });
  } else if (item) item[operation] = value;
  emit("update:modelValue", result);
}
</script>
<template>
  <div class="mr-param-tree">
    <div v-for="(row, index) in rows" :key="row.path.join('.')" class="mr-param-tree__row" :style="{ paddingLeft: `${(row.path.length - 1) * 14}px` }">
      <span aria-hidden="true">{{ row.path.length > 1 ? '↳' : '•' }}</span>
      <input :value="row.item.value" :aria-label="`${messages.paramOptionValue} ${index + 1}`" :disabled="readonly" @input="edit(row.path, 'value', ($event.target as HTMLInputElement).value)">
      <input :value="row.item.label" :aria-label="`${messages.paramOptionLabel} ${index + 1}`" :disabled="readonly" @input="edit(row.path, 'label', ($event.target as HTMLInputElement).value)">
      <button type="button" :aria-label="`${messages.paramChildAdd} ${index + 1}`" :disabled="readonly || row.path.length >= 16 || rows.length >= 1000" @click="edit(row.path, 'add')">+↳</button>
      <button type="button" :aria-label="`${messages.paramOptionRemove} ${index + 1}`" :disabled="readonly" @click="edit(row.path, 'remove')">×</button>
    </div>
    <button type="button" :disabled="readonly || rows.length >= 1000" @click="edit([modelValue.length], 'add')">+ {{ messages.paramOptionAdd }}</button>
  </div>
</template>
<style scoped>
.mr-param-tree{display:grid;gap:7px}.mr-param-tree__row{display:flex;align-items:center;gap:5px;min-width:0}.mr-param-tree__row input{min-width:0;flex:1;padding:6px 8px;border:1px solid #d8e1ed;border-radius:5px;color:var(--mrp-toolbar-fg,#334155);background:var(--mrp-toolbar-bg,#fff)}button{padding:5px 8px;background:var(--mrp-toolbar-bg,#fff);border:1px solid var(--mrp-btn-border,#d8e1ed);border-radius:5px;cursor:pointer;color:var(--mrp-toolbar-fg,#334155)}button:disabled{opacity:.5;cursor:default}input:focus-visible,button:focus-visible{outline:2px solid var(--mrp-btn-active-bg,#2563eb);outline-offset:2px}
</style>
