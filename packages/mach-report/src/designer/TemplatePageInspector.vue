<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ReportTemplateDocument } from "@agile-team/mach-report";
import { PAGE_PRESETS, pageName, pageOverflow, type PageCommand, type PagePatch } from "./page-commands";
import { TEMPLATE_EDITOR_MESSAGES, type TemplateEditorMessages } from "./messages";
const props = defineProps<{ document: ReportTemplateDocument; pageIndex: number; disabled?: boolean; messages?: Partial<TemplateEditorMessages> }>();
const emit = defineEmits<{ (event: "select", index: number): void; (event: "command", command: PageCommand): void; (event: "locate", index: number): void }>();
const m = computed(() => ({ ...TEMPLATE_EDITOR_MESSAGES, ...props.messages }));
const page = computed(() => props.document.template.pages[props.pageIndex]!);
const preset = computed(() => PAGE_PRESETS.find(item => item.widthMm === page.value.widthMm && item.heightMm === page.value.heightMm)?.id ?? "custom");
const overflow = computed(() => pageOverflow(page.value));
const confirmRemove = ref(false);
watch(() => [props.pageIndex, props.document], () => { confirmRemove.value = false; });
const margins = ["marginTopMm", "marginRightMm", "marginBottomMm", "marginLeftMm"] as const;
const marginLabels = computed(() => [m.value.marginTop, m.value.marginRight, m.value.marginBottom, m.value.marginLeft]);
function input(event: Event): string { return (event.target as HTMLInputElement).value; }
function patch(value: PagePatch): void { if (!props.disabled) emit("command", { type: "patch", patch: value }); }
function size(event: Event): void {
  const next = PAGE_PRESETS.find(item => item.id === input(event));
  if (next) patch({ widthMm: next.widthMm, heightMm: next.heightMm, layout: "page" });
}
function number(key: keyof PagePatch, event: Event): void {
  const value = input(event);
  if (value.trim() && Number.isFinite(Number(value))) patch({ [key]: Number(value) });
}
function remove(): void {
  if (props.disabled || props.document.template.pages.length <= 1) return;
  if (page.value.components.length && !confirmRemove.value) { confirmRemove.value = true; return; }
  emit("command", { type: "remove" }); confirmRemove.value = false;
}
</script>
<template>
  <fieldset class="mr-page-properties" :disabled="disabled">
    <div class="mr-page-section-heading"><h3>{{ m.paperAndPages }}</h3><span>{{ page.widthMm }} × {{ page.heightMm }} mm</span></div>
    <div class="mr-page-list" :aria-label="m.pageDirectory">
      <button v-for="(item, index) in document.template.pages" :key="index" type="button" :aria-pressed="pageIndex === index" @click="emit('select', index)"><span>{{ index + 1 }}</span><strong>{{ pageName(item, index, m.page) }}</strong><small>{{ item.widthMm }} × {{ item.heightMm }}</small></button>
    </div>
    <div class="mr-page-actions"><button type="button" @click="emit('command', { type: 'add' })">＋ {{ m.addPage }}</button><button type="button" @click="emit('command', { type: 'duplicate' })">{{ m.duplicatePage }}</button><button type="button" :disabled="disabled || document.template.pages.length <= 1" @click="remove">{{ m.removePage }}</button></div>
    <div v-if="confirmRemove" class="mr-page-confirm" role="alert"><span>{{ m.removePageConfirm }}</span><button type="button" @click="confirmRemove = false">{{ m.keepEditing }}</button><button type="button" @click="remove">{{ m.confirmRemovePage }}</button></div>
    <label>{{ m.pageName }}<input :value="page.meta?.title ?? ''" :placeholder="`${m.page} ${pageIndex + 1}`" maxlength="120" @change="patch({ meta: { ...page.meta, title: input($event) } })" /></label>
    <label>{{ m.paperPreset }}<select :value="preset" @change="size"><option v-for="item in PAGE_PRESETS" :key="item.id" :value="item.id">{{ item.id.startsWith('label') ? m.labelPaper : item.id.toUpperCase() }} · {{ item.widthMm }} × {{ item.heightMm }} mm</option><option value="custom">{{ m.customPaper }}</option></select></label>
    <div class="mr-page-grid"><label>{{ m.paperWidth }}<input type="number" min="1" step="0.5" :value="page.widthMm" @change="number('widthMm', $event)" /></label><label>{{ m.paperHeight }}<input type="number" min="1" max="4999" step="0.5" :value="page.heightMm" @change="number('heightMm', $event)" /></label></div>
    <label>{{ m.pageLayout }}<select :value="page.layout ?? 'page'" @change="patch({ layout: input($event) as 'page' | 'wide' })"><option value="page">{{ m.fixedPaper }}</option><option value="wide" :disabled="!!document.template.repeat">{{ m.completeWide }}</option></select></label>
    <details><summary>{{ m.pageMargins }}</summary><div class="mr-page-grid"><label v-for="(key, index) in margins" :key="key">{{ marginLabels[index] }}<input type="number" min="0" step="0.5" :value="page[key] ?? 0" @change="number(key, $event)" /></label></div></details>
    <div v-if="overflow.length" class="mr-page-overflow" role="status"><strong>{{ m.pageOverflow.replace('{count}', String(overflow.length)) }}</strong><p>{{ m.pageOverflowHint }}</p><button type="button" @click="emit('locate', overflow[0]!)">{{ m.locateOverflow }}</button></div>
  </fieldset>
</template>
<style scoped>
.mr-page-properties{border:0;margin:14px 0 0;padding:14px 0 0;border-top:1px solid #e2e8f0;min-width:0}.mr-page-section-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px}.mr-page-section-heading h3{margin:0;font-size:12px;font-weight:650;color:#334155}.mr-page-section-heading>span{font:10px/1.5 ui-monospace,monospace;color:#64748b;white-space:nowrap}.mr-page-properties label{display:flex;flex-direction:column;gap:5px;margin:10px 0;color:#64748b;font-size:11px}.mr-page-properties input,.mr-page-properties select{min-width:0;width:100%;padding:5px 7px;border:1px solid #dbe3ec;border-radius:5px;background:#fff;color:#334155;font:inherit;font-size:12px;line-height:1.5;box-sizing:border-box}.mr-page-list{display:grid;gap:5px;max-height:160px;overflow:auto}.mr-page-list button{display:flex;align-items:center;gap:7px;min-width:0;padding:7px;border:1px solid #e2e8f0;border-radius:6px;background:#fafcff;color:#64748b;text-align:left;cursor:pointer;font:inherit}.mr-page-list button[aria-pressed=true]{border-color:#bad3f5;background:#eff6ff;color:#1d4ed8}.mr-page-list button>span{display:grid;place-items:center;width:19px;height:22px;border:1px solid #dbe6f3;border-radius:3px;background:white;font-size:10px}.mr-page-list strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:550}.mr-page-list small{font-size:9px;white-space:nowrap}.mr-page-actions{display:flex;flex-wrap:wrap;gap:5px;margin:8px 0 12px}.mr-page-actions button,.mr-page-confirm button,.mr-page-overflow button{padding:4px 7px;border:1px solid #dbe3ec;border-radius:5px;background:white;color:#47698f;font:inherit;font-size:11px;line-height:1.5;cursor:pointer}.mr-page-actions button:last-child{margin-left:auto}.mr-page-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0 10px}.mr-page-grid label{margin:6px 0}.mr-page-properties details{margin-top:10px;color:#64748b;font-size:11px}.mr-page-properties summary{cursor:pointer}.mr-page-confirm,.mr-page-overflow{display:flex;flex-wrap:wrap;gap:6px;padding:9px;border:1px solid #f1dbb1;border-radius:6px;background:#fffbf3;color:#8d672c;font-size:11px}.mr-page-confirm>span{width:100%}.mr-page-overflow{display:block;margin-top:12px}.mr-page-overflow strong{font-weight:600}.mr-page-overflow p{margin:4px 0 7px}.mr-page-properties :disabled{opacity:.45;cursor:default}.mr-page-properties :focus-visible{outline:2px solid #2563eb;outline-offset:2px}
</style>
