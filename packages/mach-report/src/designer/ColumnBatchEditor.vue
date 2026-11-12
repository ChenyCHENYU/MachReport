<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import type { ListColumn, ListComponent } from "@agile-team/mach-report";
import { bodyAlignment } from "./column-appearance";
import { commonColumnValue, type ColumnBatchPatch } from "./column-batch";
import { TEMPLATE_EDITOR_MESSAGES, type TemplateEditorMessages } from "./messages";

const props = defineProps<{ list: ListComponent; indices: number[]; headerAlignments: string[]; flow?: boolean; disabled?: boolean; messages?: Partial<TemplateEditorMessages>; apply: (patch: ColumnBatchPatch) => boolean }>();
const m = computed(() => ({ ...TEMPLATE_EDITOR_MESSAGES, ...props.messages }));
const columns = computed(() => props.indices.flatMap(index => props.list.columns[index] ?? []));
const headerByColumn = computed(() => new Map(props.list.columns.map((column, index) => [column, props.headerAlignments[index] ?? "center"])));
const initial = () => ({ width: "", align: "", headerAlign: "", format: "", digits: "", thousands: "", bold: "", italic: "" });
const edits = reactive(initial());
watch(() => props.list, () => Object.assign(edits, initial()));
watch(() => props.indices.join(","), () => Object.assign(edits, initial()));
const states = computed(() => ({
  width: commonColumnValue(columns.value, column => column.widthMm),
  align: commonColumnValue(columns.value, column => bodyAlignment(column, props.list)),
  headerAlign: commonColumnValue(columns.value, column => headerByColumn.value.get(column) ?? "center"),
  format: commonColumnValue(columns.value, column => column.format?.kind ?? "natural"),
  digits: commonColumnValue(columns.value, column => column.format && column.format.kind !== "date" ? column.format.digits : undefined),
  thousands: commonColumnValue(columns.value, column => column.format?.kind === "number" && column.format.thousands === true),
  bold: commonColumnValue(columns.value, column => column.style?.bold === true),
  italic: commonColumnValue(columns.value, column => column.style?.italic === true),
}));
const alignments = computed(() => ({ auto: m.value.auto, left: m.value.left, center: m.value.center, right: m.value.right, justify: m.value.justify }));
const formats = computed(() => ({ natural: m.value.naturalFormat, number: m.value.numberFormat, percent: m.value.percentFormat, date: m.value.dateFormat }));
function current(key: keyof typeof states.value): string {
  const state = states.value[key];
  if (state.mixed) return m.value.batchMixed;
  if (typeof state.value === "boolean") return state.value ? m.value.batchEnabled : m.value.batchDisabled;
  if (key === "align" || key === "headerAlign") return alignments.value[state.value as keyof typeof alignments.value];
  if (key === "format") return formats.value[state.value as keyof typeof formats.value];
  return state.value === undefined ? m.value.batchKeep : String(state.value);
}
function keep(key: keyof typeof states.value): string { return `${m.value.batchKeep} · ${current(key)}`; }
const numericFormat = computed(() => edits.format === "number" || edits.format === "percent");
const invalid = computed(() => (edits.width !== "" && (!Number.isFinite(Number(edits.width)) || Number(edits.width) <= 0)) ||
  (numericFormat.value && edits.digits !== "" && (!Number.isInteger(Number(edits.digits)) || Number(edits.digits) < 0 || Number(edits.digits) > 100)));
const dirty = computed(() => edits.width !== "" || edits.align !== "" || edits.headerAlign !== "" || edits.format !== "" || edits.bold !== "" || edits.italic !== "");
function buildPatch(): ColumnBatchPatch {
  const patch: ColumnBatchPatch = {};
  if (edits.width !== "" && !props.flow) patch.widthMm = Number(edits.width);
  if (edits.align) patch.align = edits.align as ListColumn["align"];
  if (edits.headerAlign) patch.headerAlign = edits.headerAlign as ListColumn["headerAlign"];
  if (edits.format === "natural") patch.format = null;
  if (numericFormat.value) patch.format = { kind: edits.format as "number" | "percent", ...(edits.digits === "" ? {} : { digits: Number(edits.digits) }) };
  if (edits.format === "number" && edits.thousands !== "") patch.thousands = edits.thousands === "true";
  if (edits.bold !== "") patch.bold = edits.bold === "true";
  if (edits.italic !== "") patch.italic = edits.italic === "true";
  return patch;
}
function submit(): void { if (!props.disabled && !invalid.value && dirty.value && props.apply(buildPatch())) Object.assign(edits, initial()); }
</script>

<template>
  <fieldset class="mr-column-batch" :disabled="disabled">
    <div class="mr-column-batch-grid">
      <label>{{ m.batchBody }}<select v-model="edits.align" data-mr-control="batch-align" :aria-label="m.batchBody"><option value="">{{ keep('align') }}</option><option v-for="(label, value) in alignments" :key="value" :value="value">{{ label }}</option></select></label>
      <label>{{ m.batchHeader }}<select v-model="edits.headerAlign" data-mr-control="batch-header-align" :aria-label="m.batchHeader"><option value="">{{ keep('headerAlign') }}</option><template v-for="(label, value) in alignments" :key="value"><option v-if="value !== 'auto'" :value="value">{{ label }}</option></template></select></label>
      <label>{{ m.width }}<input v-model="edits.width" data-mr-control="batch-width" type="number" min="0.1" step="0.5" :aria-label="m.width" :placeholder="current('width')" :disabled="flow" :title="flow ? m.flowLayout : keep('width')" /></label>
      <label>{{ m.valueFormat }}<select v-model="edits.format" data-mr-control="batch-format" :aria-label="m.valueFormat"><option value="">{{ keep('format') }}</option><option value="natural">{{ m.naturalFormat }}</option><option value="number">{{ m.numberFormat }}</option><option value="percent">{{ m.percentFormat }}</option></select></label>
      <label v-if="numericFormat">{{ m.decimalPlaces }}<input v-model="edits.digits" data-mr-control="batch-digits" type="number" min="0" max="100" step="1" :aria-label="m.decimalPlaces" :placeholder="current('digits')" /></label>
      <label v-if="edits.format === 'number'">{{ m.thousands }}<select v-model="edits.thousands" data-mr-control="batch-thousands" :aria-label="m.thousands"><option value="">{{ keep('thousands') }}</option><option value="true">{{ m.batchEnabled }}</option><option value="false">{{ m.batchDisabled }}</option></select></label>
      <label>{{ m.fontBold }}<select v-model="edits.bold" data-mr-control="batch-bold" :aria-label="m.fontBold"><option value="">{{ keep('bold') }}</option><option value="true">{{ m.batchEnabled }}</option><option value="false">{{ m.batchDisabled }}</option></select></label>
      <label>{{ m.fontItalic }}<select v-model="edits.italic" data-mr-control="batch-italic" :aria-label="m.fontItalic"><option value="">{{ keep('italic') }}</option><option value="true">{{ m.batchEnabled }}</option><option value="false">{{ m.batchDisabled }}</option></select></label>
    </div>
    <small>{{ m.batchHint }}</small>
    <button type="button" data-mr-control="batch-apply" :disabled="disabled || invalid || !dirty" @click="submit">{{ m.batchApply }}</button>
  </fieldset>
</template>

<style scoped>
.mr-column-batch{min-width:0;margin:0;padding:0;border:0}.mr-column-batch-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px 10px}.mr-column-batch-grid label{display:flex;flex-direction:column;gap:4px;margin:0;min-width:0;font-size:10px;color:var(--mrp-btn-fg,#64748b)}.mr-column-batch input,.mr-column-batch select{box-sizing:border-box;min-height:28px;width:100%;min-width:0;padding:5px 6px;border:1px solid var(--mrp-toolbar-border,#dbe3ec);border-radius:5px;background:var(--mrp-toolbar-bg,#fff);color:var(--mrp-toolbar-fg,#334155);font:inherit;line-height:1.5}.mr-column-batch select{appearance:none;padding-right:22px;background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);background-size:4px 4px;background-position:calc(100% - 11px) center,calc(100% - 7px) center;background-repeat:no-repeat}.mr-column-batch small{display:block;margin:8px 0;color:var(--mrp-btn-fg,#64748b);font-size:10px;line-height:1.5}.mr-column-batch>button{width:100%;padding:6px 8px;border:1px solid var(--mrp-toolbar-border,#dbe3ec);border-radius:5px;background:var(--mrp-btn-hover-bg,#eff6ff);color:var(--mrp-btn-hover-fg,#1d4ed8);font:inherit;font-size:11px;cursor:pointer}.mr-column-batch :disabled{opacity:.45;cursor:default}.mr-column-batch :focus-visible{outline:2px solid var(--mrp-btn-active-bg,#2563eb);outline-offset:1px}
</style>
