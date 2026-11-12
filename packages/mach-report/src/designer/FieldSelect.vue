<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, ref, watch } from "vue";
import type { DatasetContract } from "@agile-team/mach-report";
import { TEMPLATE_EDITOR_MESSAGES, type TemplateEditorMessages } from "./messages";
import { useFieldSelectPopup } from "./useFieldSelectPopup";

defineOptions({ inheritAttrs: false });
const props = defineProps<{ modelValue: string; fields?: readonly DatasetContract["fields"][number][]; label: string; disabled?: boolean; messages?: Partial<TemplateEditorMessages> }>();
const emit = defineEmits<{ (event: "change", value: string): void }>();
const m = computed(() => ({ ...TEMPLATE_EDITOR_MESSAGES, ...props.messages }));
const id = `mr-field-options-${getCurrentInstance()?.uid ?? 0}`;
const input = ref<HTMLInputElement>();
const options = ref<HTMLElement>();
const draft = ref(props.modelValue), query = ref(""), open = ref(false), composing = ref(false), cursor = ref(-1), start = ref(0);
const popup = useFieldSelectPopup(input, options, open);
const limit = 100;
const matches = computed(() => {
  const terms = query.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return (props.fields ?? []).filter(field => {
    const text = `${field.field} ${field.label ?? ""} ${field.type ?? ""} ${field.unit ?? ""}`.toLocaleLowerCase();
    return terms.every(term => text.includes(term));
  });
});
const visible = computed(() => matches.value.slice(start.value, start.value + limit));
const activeId = computed(() => open.value && cursor.value >= 0 ? `${id}-${cursor.value}` : undefined);
const range = computed(() => m.value.columnWindow.replace("{start}", String(matches.value.length ? start.value + 1 : 0)).replace("{end}", String(Math.min(start.value + limit, matches.value.length))).replace("{total}", String(matches.value.length)));
watch(() => props.modelValue, value => { draft.value = value; });
watch(() => props.disabled, disabled => { if (disabled) close(); });
watch(matches, () => { cursor.value = -1; start.value = 0; });
function close(): void { open.value = false; cursor.value = -1; }
function focus(): void {
  if (props.disabled) return;
  query.value = "";
  open.value = true;
  void nextTick(() => locate(matches.value.findIndex(field => field.field === props.modelValue)));
}
function edit(event: Event): void {
  draft.value = (event.target as HTMLInputElement).value;
  if (!composing.value) query.value = draft.value;
  open.value = true;
}
function compositionEnd(event: Event): void { composing.value = false; edit(event); }
async function locate(index: number): Promise<void> {
  cursor.value = index;
  start.value = index < 0 ? 0 : Math.floor(index / limit) * limit;
  await nextTick(); await popup.place();
  if (cursor.value === index) document.getElementById(`${id}-${index}`)?.scrollIntoView?.({ block: "nearest" });
}
function page(direction: -1 | 1): void {
  locate(Math.max(0, Math.min(matches.value.length - 1, start.value + direction * limit)));
  input.value?.focus({ preventScroll: true });
}
function commit(value = draft.value): void {
  if (props.disabled || composing.value) return;
  draft.value = value;
  close();
  if (value !== props.modelValue) emit("change", value);
  // A host can require confirmation before adopting a different field.
  void nextTick(() => { draft.value = props.modelValue; });
}
function choose(index: number): void { const field = matches.value[index]; if (field) commit(field.field); }
function keydown(event: KeyboardEvent): void {
  if (props.disabled || composing.value || event.isComposing) return;
  if (event.key === "Escape") { event.preventDefault(); draft.value = props.modelValue; close(); return; }
  if (event.key === "Enter") {
    if (!open.value) return;
    event.preventDefault();
    if (cursor.value >= 0) choose(cursor.value); else commit();
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"].includes(event.key)) return;
  // Home/End retain normal caret behavior while the popup is closed.
  if (!open.value && !event.key.startsWith("Arrow")) return;
  event.preventDefault(); open.value = true;
  const last = matches.value.length - 1;
  const next = event.key === "Home" ? 0 : event.key === "End" ? last : cursor.value + ({ ArrowDown: 1, ArrowUp: -1, PageDown: limit, PageUp: -limit }[event.key] ?? 0);
  locate(last < 0 ? -1 : Math.max(0, Math.min(last, next)));
}
</script>

<template>
  <span class="mr-field-select">
    <input ref="input" v-bind="$attrs" :placeholder="($attrs.placeholder as string | undefined) ?? m.fieldSearch" :value="draft" :disabled="disabled" :aria-label="label" role="combobox" aria-autocomplete="list" :aria-expanded="open" :aria-controls="open ? id : undefined" :aria-activedescendant="activeId" autocomplete="off" @focus="focus" @input="edit" @change="commit()" @blur="close" @keydown="keydown" @compositionstart="composing = true" @compositionend="compositionEnd" />
    <span v-if="open" class="mr-field-popup" :class="{ 'is-above': popup.above.value }" :style="popup.style.value">
      <span :id="id" ref="options" class="mr-field-options" role="listbox" :aria-label="label">
        <button v-for="(field, index) in visible" :id="`${id}-${start + index}`" :key="field.field" type="button" role="option" :aria-selected="cursor === start + index" :aria-posinset="start + index + 1" :aria-setsize="matches.length" tabindex="-1" @mousedown.prevent @click="choose(start + index)">
          <strong>{{ field.label || field.field }}</strong><small>{{ field.field }}<template v-if="field.type"> · {{ field.type }}</template><template v-if="field.unit"> · {{ field.unit }}</template></small>
        </button>
      </span>
      <span v-if="!matches.length" class="mr-field-empty" role="status">{{ m.fieldNoMatches }}</span>
      <span v-else class="mr-field-pagination">
        <button type="button" :aria-label="m.previousColumns" :disabled="start === 0" @mousedown.prevent @click="page(-1)">‹</button><span role="status">{{ range }}</span><button type="button" :aria-label="m.nextColumns" :disabled="start + limit >= matches.length" @mousedown.prevent @click="page(1)">›</button>
      </span>
    </span>
  </span>
</template>

<style scoped>
.mr-field-select{display:block;position:relative;min-width:0;width:100%}.mr-field-select>input{box-sizing:border-box;width:100%;min-width:0;padding:5px 7px;border:1px solid var(--mrp-toolbar-border,#dbe3ec);border-radius:5px;background:var(--mrp-toolbar-bg,#fff);color:var(--mrp-toolbar-fg,#334155);font:inherit;font-size:12px;line-height:1.5}.mr-field-select>input:focus-visible{outline:2px solid var(--mrp-btn-active-bg,#2563eb);outline-offset:1px}.mr-field-popup{position:absolute;inset:calc(100% + 4px) 0 auto;z-index:30;display:block;border:1px solid var(--mrp-toolbar-border,#dbe3ec);border-radius:7px;background:var(--mrp-toolbar-bg,#fff);color:var(--mrp-toolbar-fg,#334155);box-shadow:0 6px 18px var(--mrp-toolbar-border,#dbe3ec);overflow:hidden}.mr-field-popup.is-above{inset:auto 0 calc(100% + 4px)}.mr-field-options{display:block;max-height:var(--mr-field-options-height,230px);overflow:auto;overscroll-behavior:contain}.mr-field-options button{display:block;width:100%;padding:7px 9px;border:0;border-radius:0;text-align:left;background:var(--mrp-toolbar-bg,#fff);color:var(--mrp-toolbar-fg,#334155);font:inherit;cursor:pointer}.mr-field-options button:hover,.mr-field-options button[aria-selected=true]{background:var(--mrp-btn-hover-bg,#eff6ff);color:var(--mrp-btn-hover-fg,#1d4ed8)}.mr-field-options strong,.mr-field-options small{display:block;overflow-wrap:anywhere;font-size:11px;font-weight:500}.mr-field-options small{margin-top:2px;color:var(--mrp-btn-fg,#64748b);font-size:10px;font-weight:400}.mr-field-empty{display:block;padding:12px 9px;font-size:11px;color:var(--mrp-btn-fg,#64748b)}.mr-field-pagination{display:flex;align-items:center;justify-content:space-between;gap:5px;padding:4px 7px;border-top:1px solid var(--mrp-toolbar-border,#dbe3ec);font-size:10px;color:var(--mrp-btn-fg,#64748b)}.mr-field-pagination button{border:1px solid var(--mrp-toolbar-border,#dbe3ec);border-radius:4px;background:var(--mrp-toolbar-bg,#fff);color:var(--mrp-toolbar-fg,#334155);font:inherit;font-size:15px;cursor:pointer}.mr-field-pagination button:disabled,.mr-field-select>input:disabled{opacity:.45;cursor:default}
</style>
