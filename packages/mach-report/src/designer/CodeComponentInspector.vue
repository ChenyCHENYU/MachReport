<script setup lang="ts">
import { computed } from "vue";
import type { PlanComponent } from "@agile-team/mach-report";
import { TEMPLATE_EDITOR_MESSAGES, type TemplateEditorMessages } from "./messages";
const props = defineProps<{ component: PlanComponent; disabled?: boolean; messages?: Partial<TemplateEditorMessages> }>();
const emit = defineEmits<{ (event: "change", code: PlanComponent["code"]): void }>();
const m = computed(() => ({ ...TEMPLATE_EDITOR_MESSAGES, ...props.messages }));
const quietMinimum = computed(() => props.component.kind === "qrcode" ? 4 : props.component.code?.symbology?.startsWith("ean") ? 11 : 10);
function input(event: Event): string { return (event.target as HTMLInputElement).value; }
function patch(value: Partial<NonNullable<PlanComponent["code"]>>): void { if (!props.disabled) emit("change", { ...props.component.code, ...value }); }
function symbology(event: Event): void {
  const value = input(event) as "code128" | "code39" | "ean13" | "ean8";
  patch({ symbology: value, quietZoneModules: value.startsWith("ean") ? 11 : 10 });
}
</script>
<template>
  <div class="mr-code-properties">
    <h3>{{ m.codeSettings }}</h3>
    <label v-if="!component.binding">{{ m.codeValue }}<textarea rows="2" :value="component.code?.value ?? component.fallbackText ?? component.text ?? ''" :disabled="disabled" @change="patch({ value: input($event) })" /></label>
    <label v-if="component.kind === 'barcode'">{{ m.codeSymbology }}<select :value="component.code?.symbology ?? 'code128'" :disabled="disabled" @change="symbology"><option value="code128">Code 128</option><option value="code39">Code 39</option><option value="ean13">EAN-13</option><option value="ean8">EAN-8</option></select></label>
    <p v-if="component.kind === 'barcode'">{{ component.code?.symbology?.startsWith('ean') ? m.eanContentHint : component.code?.symbology === 'code39' ? m.code39ContentHint : m.code128ContentHint }}</p>
    <div class="mr-code-grid"><label v-if="component.kind === 'qrcode'">{{ m.codeCorrection }}<select :value="component.code?.errorCorrection ?? 'M'" :disabled="disabled" @change="patch({ errorCorrection: input($event) as 'L' | 'M' | 'Q' | 'H' })"><option value="L">L · 7%</option><option value="M">M · 15%</option><option value="Q">Q · 25%</option><option value="H">H · 30%</option></select></label><label>{{ m.codeQuietZone }}<input type="number" :min="quietMinimum" max="64" step="1" :value="component.code?.quietZoneModules ?? quietMinimum" :disabled="disabled" @change="input($event).trim() && patch({ quietZoneModules: Number(input($event)) })" /></label></div>
    <label v-if="component.kind === 'barcode'" class="mr-code-checkbox"><input type="checkbox" :checked="component.code?.showText === true" :disabled="disabled" @change="patch({ showText: ($event.target as HTMLInputElement).checked })" />{{ m.codeShowText }}</label>
    <p>{{ m.codePreviewHint }}</p>
  </div>
</template>
<style scoped>
.mr-code-properties{margin-top:12px;border-top:1px solid #e2e8f0;padding-top:12px}.mr-code-properties h3{margin:0 0 8px;color:#64748b;font-size:11px}.mr-code-properties label{display:flex;flex-direction:column;gap:4px;margin:8px 0;color:#64748b;font-size:11px}.mr-code-properties textarea,.mr-code-properties input,.mr-code-properties select{box-sizing:border-box;width:100%;min-width:0;padding:5px 7px;border:1px solid #dbe3ec;border-radius:5px;background:#fff;color:#334155;font:inherit;font-size:12px;line-height:1.5}.mr-code-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0 10px}.mr-code-properties .mr-code-checkbox{flex-direction:row;align-items:center;gap:7px}.mr-code-checkbox input{width:14px;height:14px;accent-color:#2563eb}.mr-code-properties p{margin:8px 0 0;font-size:10px;color:#7890ad;line-height:1.6}.mr-code-properties :focus-visible{outline:2px solid #2563eb;outline-offset:2px}
</style>
