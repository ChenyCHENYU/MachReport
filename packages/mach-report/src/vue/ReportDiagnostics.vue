<script setup lang="ts">
import { computed, ref } from "vue";
import type { MachReportMessages } from "./config";
import type { ReportPreviewDiagnostic } from "./guards";
const props = defineProps<{ entries: readonly Readonly<ReportPreviewDiagnostic>[]; messages: MachReportMessages }>();
defineEmits<{ (e: "locate", entry: Readonly<ReportPreviewDiagnostic>): void }>();
const query = ref("");
const descriptions = computed<Record<string, string | undefined>>(() => ({
  "unsupported-style": props.messages.diagnosticUnsupportedStyle,
  "missing-image": props.messages.diagnosticMissingImage, "unsupported-component": props.messages.diagnosticUnsupported,
  "unsupported-image-format": props.messages.diagnosticImageFormat, "rich-text-flattened": props.messages.diagnosticRichText,
  "nested-components-omitted": props.messages.diagnosticNested, "async-image-required": props.messages.diagnosticImageAsync,
  "image-decode-failed": props.messages.diagnosticImageDecode, "asset-render-failed": props.messages.diagnosticAssetFailed,
  "asset-budget-exceeded": props.messages.diagnosticAssetBudget
}));
const filtered = computed(() => {
  const term = query.value.trim().toLocaleLowerCase();
  return term ? props.entries.filter((item) => `${item.code} ${item.message} ${descriptions.value[item.code] ?? ""} ${item.path ?? ""} ${location(item)} ${item.format ?? ""}`.toLocaleLowerCase().includes(term)) : props.entries;
});
const visible = computed(() => filtered.value.slice(0, 100));
function location(item: Readonly<ReportPreviewDiagnostic>): string {
  if (item.pageIndex === undefined) return item.path ?? "";
  return (props.messages.diagnosticsLocation ?? "").replace("{page}", String(item.pageIndex + 1)).replace("{component}", String((item.componentIndex ?? 0) + 1));
}
</script>
<template>
  <details v-if="entries.length" class="mrp-diagnostics">
    <summary>{{ messages.diagnosticsTitle }} <span>{{ entries.length }}</span></summary>
    <input v-model="query" type="search" :aria-label="messages.diagnosticsSearch" :placeholder="messages.diagnosticsSearch" />
    <ol><li v-for="(entry, index) in visible" :key="index"><div><b>{{ entry.format?.toUpperCase() ?? entry.severity }} · {{ entry.code }}</b><p>{{ descriptions[entry.code] ?? entry.message }}</p><details v-if="descriptions[entry.code]"><summary>{{ messages.diagnosticsDetails }}</summary>{{ entry.message }}</details><small>{{ location(entry) }}</small></div><button v-if="entry.pageIndex !== undefined" type="button" @click="$emit('locate', entry)">{{ messages.diagnosticsLocate }}</button></li></ol>
    <small v-if="filtered.length > visible.length">{{ (messages.diagnosticsMore ?? '').replace('{count}', String(filtered.length)) }}</small>
  </details>
</template>
<style scoped>
.mrp-diagnostics{background:var(--mrp-toolbar-bg);color:var(--mrp-toolbar-fg);border-bottom:1px solid var(--mrp-toolbar-border);padding:9px 12px;font-size:12px}summary{cursor:pointer;font-weight:600}summary span{margin-left:5px;opacity:.7}input{box-sizing:border-box;margin-top:10px;width:100%;font:inherit;border:1px solid var(--mrp-btn-border);border-radius:4px;padding:6px;color:inherit;background:transparent}ol{list-style:none;margin:8px 0 0;padding:0;max-height:220px;overflow:auto}li{display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--mrp-toolbar-border)}li div{min-width:0;flex:1}p{margin:4px 0;overflow-wrap:anywhere;line-height:1.5}small{opacity:.7}button{color:inherit;background:transparent;border:1px solid var(--mrp-btn-border);border-radius:4px;padding:4px 9px;cursor:pointer}
</style>
