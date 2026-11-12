<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ExcelImportResult } from "../xlsx/import-types";
import { EXCEL_BINDING_MESSAGES, type ExcelBindingMessages } from "./excel-binding-messages";
import { importDiagnosticTarget, type ImportDiagnosticTarget } from "./import-diagnostic-target";
import ReportIcon from "../vue/ReportIcon.vue";

const props = defineProps<{ source: ExcelImportResult; currentSheet: string; disabled?: boolean; messages?: Partial<ExcelBindingMessages> }>();
const emit = defineEmits<{ (event: "locate", target: ImportDiagnosticTarget): void }>();
const m = computed(() => ({ ...EXCEL_BINDING_MESSAGES, ...props.messages }));
const page = ref(0), size = 12;
const entries = computed(() => (props.source.diagnostics ?? []).slice(0, 200));
const pages = computed(() => Math.max(1, Math.ceil(entries.value.length / size)));
const total = computed(() => props.source.diagnosticSummary?.total ?? props.source.diagnostics?.length ?? 0);
const visible = computed(() => entries.value.slice(page.value * size, (page.value + 1) * size).map(diagnostic => ({ diagnostic, target: importDiagnosticTarget(diagnostic, props.source) })));
watch(() => props.source, () => { page.value = 0; });
watch(pages, count => { page.value = Math.min(page.value, count - 1); });
function available(target?: ImportDiagnosticTarget): target is ImportDiagnosticTarget { return !!target && (!props.disabled || target.sheet === props.currentSheet); }
function locate(target?: ImportDiagnosticTarget): void { if (available(target)) emit("locate", target); }
</script>

<template>
  <details v-if="total" class="mr-import-diagnostics">
    <summary>{{ m.inspectWarning }} · {{ total }}<small v-if="total > entries.length">{{ m.diagnosticDetails.replace('{shown}', String(entries.length)).replace('{total}', String(total)) }}</small></summary>
    <ul>
      <li v-for="({ diagnostic, target }, index) in visible" :key="`${page}:${index}`">
        <button v-if="available(target)" type="button" :aria-label="`${m.locateSource} · ${diagnostic.sheet} ${diagnostic.cell || diagnostic.range || ''}`" @click="locate(target)"><span><strong>{{ diagnostic.sheet }}<template v-if="diagnostic.cell || diagnostic.range"> · {{ diagnostic.cell || diagnostic.range }}</template></strong><span>{{ diagnostic.message }}</span></span><ReportIcon name="arrow-right" :size="12" /></button>
        <span v-else class="mr-import-diagnostic-text"><strong v-if="diagnostic.sheet || diagnostic.part">{{ diagnostic.sheet || diagnostic.part }}<template v-if="diagnostic.cell || diagnostic.range"> · {{ diagnostic.cell || diagnostic.range }}</template></strong><span>{{ diagnostic.message }}</span></span>
      </li>
    </ul>
    <nav v-if="pages > 1" :aria-label="m.inspectWarning"><button type="button" :disabled="page === 0" :aria-label="m.previousIssues" @click="page--"><ReportIcon name="chevron-left" :size="12" /></button><span>{{ page + 1 }}/{{ pages }}</span><button type="button" :disabled="page + 1 >= pages" :aria-label="m.nextIssues" @click="page++"><ReportIcon name="chevron-right" :size="12" /></button></nav>
  </details>
</template>

<style scoped>
.mr-import-diagnostics{flex-shrink:0;max-height:280px;max-height:min(35vh,280px);overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;margin:0 16px 12px;border:1px solid var(--mrp-toolbar-border,#dbe3ec);border-radius:7px;background:var(--mrp-toolbar-bg,#fff);color:var(--mrp-toolbar-fg,#334155);font-size:11px}.mr-import-diagnostics summary{padding:9px 11px;cursor:pointer;color:var(--mrp-warning-fg,#92400e)}.mr-import-diagnostics summary small{margin-left:8px;color:var(--mrp-btn-fg,#64748b);font-size:10px}.mr-import-diagnostics ul{margin:0;padding:0 10px;list-style:none}.mr-import-diagnostics li{border-top:1px solid var(--mrp-toolbar-border,#dbe3ec)}.mr-import-diagnostics li button,.mr-import-diagnostic-text{display:flex;align-items:center;justify-content:space-between;gap:10px;box-sizing:border-box;width:100%;padding:8px 2px;border:0;background:var(--mrp-toolbar-bg,#fff);color:var(--mrp-toolbar-fg,#334155);font:inherit;text-align:left}.mr-import-diagnostics li button{cursor:pointer}.mr-import-diagnostics li button:hover{color:var(--mrp-btn-hover-fg,#1d4ed8)}.mr-import-diagnostics strong,.mr-import-diagnostics li span span{display:block;overflow-wrap:anywhere}.mr-import-diagnostics strong{margin-bottom:3px;font-size:10px;color:var(--mrp-btn-fg,#64748b);font-weight:500}.mr-import-diagnostics nav{display:flex;justify-content:flex-end;align-items:center;gap:8px;padding:5px 10px;border-top:1px solid var(--mrp-toolbar-border,#dbe3ec)}.mr-import-diagnostics nav button{display:flex;padding:4px;border:1px solid var(--mrp-toolbar-border,#dbe3ec);border-radius:4px;background:var(--mrp-toolbar-bg,#fff);color:var(--mrp-toolbar-fg,#334155);cursor:pointer}.mr-import-diagnostics button:focus-visible{outline:2px solid var(--mrp-btn-active-bg,#2563eb);outline-offset:1px}.mr-import-diagnostics button:disabled{opacity:.45;cursor:default}
</style>
