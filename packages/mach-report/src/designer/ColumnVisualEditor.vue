<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { validColumnVisual, type ColumnVisual } from "../layout/column-visual";
import { COLUMN_VISUAL_MESSAGES, type ColumnVisualMessages } from "./column-visual-messages";
const props = defineProps<{ modelValue?: ColumnVisual; fields?: ReadonlyArray<{ field: string; label?: string }>; readonly?: boolean; messages?: Partial<ColumnVisualMessages> }>();
const emit = defineEmits<{ (event: "update:modelValue", visual: ColumnVisual | undefined): void }>();
const m = computed(() => ({ ...COLUMN_VISUAL_MESSAGES, ...props.messages }));
const enabled = ref(!!props.modelValue), kind = ref<ColumnVisual["kind"]>("colorScale"), field = ref(""), numeric = ref<"number" | "decimal">("number");
const min = ref(""), max = ref(""), color = ref("#bad8fa"), negativeColor = ref("#f3bcc3"), lowColor = ref("#f0f7ff"), highColor = ref("#8bbcf1");
let last = "";
function reset(): void {
  const visual = props.modelValue;
  enabled.value = !!visual; kind.value = visual?.kind ?? "colorScale"; field.value = visual?.field ?? ""; numeric.value = visual?.numeric ?? "number";
  min.value = visual?.min === undefined ? "" : String(visual.min); max.value = visual?.max === undefined ? "" : String(visual.max);
  if (visual?.kind === "colorScale") { lowColor.value = visual.lowColor ?? "#f0f7ff"; highColor.value = visual.highColor ?? "#8bbcf1"; }
  if (visual?.kind === "dataBar") { color.value = visual.color ?? "#bad8fa"; negativeColor.value = visual.negativeColor ?? "#f3bcc3"; }
}
reset();
const candidate = computed((): ColumnVisual => ({
  ...(field.value ? { field: field.value } : {}), numeric: numeric.value,
  ...(min.value === "" ? {} : { min: Number(min.value) }), ...(max.value === "" ? {} : { max: Number(max.value) }),
  ...(kind.value === "colorScale" ? { kind: "colorScale", lowColor: lowColor.value, highColor: highColor.value } : { kind: "dataBar", color: color.value, negativeColor: negativeColor.value }),
}));
const invalid = computed(() => enabled.value && !validColumnVisual(candidate.value));
watch(() => JSON.stringify(props.modelValue), value => { if (value !== last) reset(); });
watch([enabled, candidate], () => {
  if (props.readonly) return;
  const visual = enabled.value ? candidate.value : undefined;
  last = JSON.stringify(visual); emit("update:modelValue", visual);
}, { flush: "post" });
</script>
<template>
  <details class="mr-column-visual-disclosure">
    <summary>{{ m.title }}<span v-if="enabled" class="mr-column-visual-badge">{{ kind === 'colorScale' ? m.colorScale : m.dataBar }}</span></summary>
    <fieldset class="mr-column-visual">
    <legend>{{ m.title }}</legend>
    <label class="mr-column-visual__toggle"><input v-model="enabled" type="checkbox" :disabled="readonly">{{ m.enabled }}</label>
    <div v-if="enabled" class="mr-column-visual__grid">
      <label>{{ m.kind }}<select v-model="kind" :disabled="readonly"><option value="colorScale">{{ m.colorScale }}</option><option value="dataBar">{{ m.dataBar }}</option></select></label>
      <label>{{ m.measure }}<select v-model="field" :disabled="readonly"><option value="">{{ m.ownField }}</option><option v-for="item in fields ?? []" :key="item.field" :value="item.field">{{ item.label ?? item.field }}</option></select></label>
      <label>{{ m.numeric }}<select v-model="numeric" :disabled="readonly"><option value="number">{{ m.number }}</option><option value="decimal">{{ m.decimal }}</option></select></label>
      <label v-for="bound in ['min','max'] as const" :key="bound">{{ bound === 'min' ? m.minimum : m.maximum }}<input v-if="bound === 'min'" v-model="min" type="number" step="any" :placeholder="m.autoDomain" :disabled="readonly" :aria-invalid="invalid || undefined"><input v-else v-model="max" type="number" step="any" :placeholder="m.autoDomain" :disabled="readonly" :aria-invalid="invalid || undefined"></label>
      <template v-if="kind === 'colorScale'"><label>{{ m.lowColor }}<input v-model="lowColor" type="color" :disabled="readonly"></label><label>{{ m.highColor }}<input v-model="highColor" type="color" :disabled="readonly"></label></template>
      <template v-else><label>{{ m.color }}<input v-model="color" type="color" :disabled="readonly"></label><label>{{ m.negativeColor }}<input v-model="negativeColor" type="color" :disabled="readonly"></label></template>
    </div>
    <small v-if="invalid" role="status" class="is-error">{{ m.invalid }}</small><p v-else-if="enabled">{{ m.hint }}<span v-if="kind === 'dataBar'">{{ m.snapshot }}</span></p>
    </fieldset>
  </details>
</template>
<style scoped>
.mr-column-visual{margin:0;padding:12px;border:1px solid var(--mrp-toolbar-border,#dbe5f1);border-radius:9px;color:var(--mrp-toolbar-fg,#334155)}legend{padding:0 5px;font-weight:600;font-size:12px}.mr-column-visual__toggle{display:flex;align-items:center;gap:6px;font-size:12px}.mr-column-visual__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px}.mr-column-visual__grid label{display:grid;gap:5px;font-size:11px}select,input[type=number]{min-width:0;width:100%;box-sizing:border-box;padding:6px;border:1px solid var(--mrp-btn-border,#cbd5e1);border-radius:5px;color:inherit;background:var(--mrp-toolbar-bg,#fff)}input[type=color]{width:100%;height:30px;padding:2px;border:1px solid var(--mrp-btn-border,#cbd5e1);border-radius:5px}p,small{display:block;font-size:11px;line-height:1.6;margin:8px 0 0;opacity:.8}p span{display:block}.is-error{color:var(--mrp-error-fg,#b45353)}input:focus-visible,select:focus-visible{outline:2px solid var(--mrp-btn-active-bg,#2563eb);outline-offset:2px}
.mr-column-visual-disclosure{margin:4px 0;color:var(--mrp-toolbar-fg,#334155)}summary{display:flex;align-items:center;gap:7px;padding:6px 0;cursor:pointer;font-size:11px;font-weight:600}summary::before{content:'›';font-size:15px;line-height:1;transition:transform .15s}details[open]>summary::before{transform:rotate(90deg)}summary:focus-visible{outline:2px solid var(--mrp-btn-active-bg,#2563eb);outline-offset:2px}.mr-column-visual-badge{margin-left:auto;font-size:10px;font-weight:400;color:var(--mrp-btn-fg,#64748b)}
</style>
