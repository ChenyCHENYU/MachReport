<script setup lang="ts">
import { computed, getCurrentInstance, ref, watch } from "vue";
import type { RenderPlan, ReportCellEdit, ReportEditConflict } from "@agile-team/mach-report";
import type { MachReportMessages } from "./config";
import { createColumnDirectory } from "./column-directory";
import { usePopover } from "./composables/usePopover";
import ReportIcon from "./ReportIcon.vue";

const props = defineProps<{
  differences: readonly ReportCellEdit[];
  conflicts: readonly ReportEditConflict[];
  messages: MachReportMessages;
  saving: boolean;
  canUndo: boolean;
  canRedo: boolean;
  busy?: boolean;
  persisted?: boolean;
  plan?: RenderPlan | null;
  historyLimited?: boolean;
}>();
defineEmits<{ (e: "undo"): void; (e: "redo"): void; (e: "restore"): void; (e: "locate", edit: ReportCellEdit): void }>();
const { opened, root, trigger, panel, onKeydown } = usePopover();
const id = `mrp-changes-${getCurrentInstance()?.uid ?? 0}`;
const query = ref("");
const dataset = ref("");
const page = ref(0);
const windowSize = 100;
const labels = computed(() => new Map(createColumnDirectory(props.plan).map(entry => [JSON.stringify([entry.tableId, entry.field]), entry.label])));

function fieldLabel(edit: ReportCellEdit): string {
  const field = edit.source?.field ?? edit.table?.columnKey;
  return labels.value.get(JSON.stringify([edit.table?.id, field])) ?? field ?? `${edit.address.columnIndex + 1}`;
}
function label(edit: ReportCellEdit): string {
  const row = edit.source?.rowKey ?? `${edit.address.pageIndex + 1} / ${edit.address.rowIndex + 1}`;
  return `${fieldLabel(edit)} · ${row}`;
}
const datasets = computed(() => opened.value ? [...new Set(props.differences.map(edit => edit.source?.datasetId).filter((value): value is string => !!value))] : []);
const matches = computed(() => {
  if (!opened.value) return [];
  const terms = query.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return props.differences.filter(edit => {
    if (dataset.value && edit.source?.datasetId !== dataset.value) return false;
    const text = `${label(edit)} ${edit.source?.field ?? ""} ${edit.source?.datasetId ?? ""}`.toLocaleLowerCase();
    return terms.every(term => text.includes(term));
  });
});
const visible = computed(() => matches.value.slice(page.value * windowSize, (page.value + 1) * windowSize));
const range = computed(() => props.messages.changesRange
  ?.replace("{start}", String(matches.value.length ? page.value * windowSize + 1 : 0))
  .replace("{end}", String(Math.min((page.value + 1) * windowSize, matches.value.length)))
  .replace("{total}", String(matches.value.length)));
watch([query, dataset], () => { page.value = 0; });
watch(() => matches.value.length, count => { page.value = Math.min(page.value, Math.max(0, Math.ceil(count / windowSize) - 1)); });
watch(datasets, values => { if (dataset.value && !values.includes(dataset.value)) dataset.value = ""; });
</script>
<template>
  <div class="mrp-edit-bar">
    <button type="button" :disabled="busy || saving || !canUndo" @click="$emit('undo')">{{ messages.undo }}</button>
    <button type="button" :disabled="busy || saving || !canRedo" @click="$emit('redo')">{{ messages.redo }}</button>
    <div ref="root" class="mrp-changes" @keydown="onKeydown">
      <button ref="trigger" type="button" class="mrp-changes-trigger" aria-haspopup="dialog" :aria-expanded="opened" :aria-controls="id" @click="opened = !opened">
        {{ messages.changes }}<span>{{ differences.length }}</span><ReportIcon name="chevron-down" :size="12" />
      </button>
      <section v-if="opened" :id="id" ref="panel" role="dialog" :aria-label="messages.changes">
        <header><strong>{{ messages.changes }}</strong><span>{{ messages.changesCount?.replace('{count}', String(differences.length)) }}</span></header>
        <div class="mrp-change-filters">
          <label><ReportIcon name="search" :size="14" /><input v-model="query" type="search" :aria-label="messages.changesSearch" :placeholder="messages.changesSearch" /></label>
          <select v-if="datasets.length > 1" v-model="dataset" :aria-label="messages.changesAllDatasets">
            <option value="">{{ messages.changesAllDatasets }}</option>
            <option v-for="value in datasets" :key="value" :value="value">{{ value }}</option>
          </select>
        </div>
        <p v-if="!differences.length" class="mrp-changes-empty">{{ messages.changesEmpty }}</p>
        <p v-else-if="!matches.length" class="mrp-changes-empty">{{ messages.changesNoMatches }}</p>
        <ol v-else :start="page * windowSize + 1">
          <li v-for="(edit, index) in visible" :key="page * windowSize + index">
            <button type="button" :disabled="busy || saving" @click="$emit('locate', edit)">{{ label(edit) }}</button>
            <span><s :title="messages.changesBefore">{{ edit.previousText || '∅' }}</s><i aria-hidden="true">→</i><strong :title="messages.changesAfter">{{ edit.text || '∅' }}</strong></span>
          </li>
        </ol>
        <footer>
          <span role="status">{{ range }}</span>
          <div v-if="matches.length > windowSize">
            <button type="button" :aria-label="messages.prevPage" :disabled="page === 0" @click="page--"><ReportIcon name="chevron-left" :size="14" /></button>
            <button type="button" :aria-label="messages.nextPage" :disabled="(page + 1) * windowSize >= matches.length" @click="page++"><ReportIcon name="chevron-right" :size="14" /></button>
          </div>
        </footer>
      </section>
    </div>
    <button type="button" :disabled="busy || saving || !differences.length" @click="$emit('restore')">{{ messages.restoreChanges }}</button>
    <span v-if="saving" role="status">{{ messages.saving }}</span>
    <span v-else-if="differences.length && !conflicts.length" role="status">{{ persisted ? messages.editSaved : messages.editingLocal }}</span>
    <span v-if="historyLimited" class="mrp-history-limited" role="status">{{ messages.editHistoryLimited }}</span>
    <details v-if="conflicts.length" class="mrp-conflicts" open><summary>{{ messages.conflicts }} · {{ conflicts.length }}</summary><ul><li v-for="(conflict, index) in conflicts" :key="index">{{ conflict.message }}</li></ul></details>
  </div>
</template>
<style scoped>
.mrp-edit-bar{position:relative;display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:6px 12px;border-bottom:1px solid var(--mrp-toolbar-border);font-size:12px;color:var(--mrp-toolbar-fg);background:var(--mrp-toolbar-bg)}
button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:28px;font:inherit;background:transparent;color:inherit;border:1px solid var(--mrp-btn-border);border-radius:6px;padding:3px 8px;cursor:pointer}
button:hover:not(:disabled){background:var(--mrp-btn-hover-bg);color:var(--mrp-btn-hover-fg)}
button:disabled{opacity:.45;cursor:default}
button:focus-visible,select:focus-visible,.mrp-change-filters label:focus-within{outline:2px solid var(--mrp-btn-active-bg);outline-offset:2px}
.mrp-change-filters input:focus-visible{outline:none}
.mrp-changes-trigger span{font-size:10px;padding:1px 4px;border-radius:4px;background:color-mix(in srgb,var(--mrp-btn-active-bg) 8%,transparent);color:var(--mrp-btn-active-bg)}
.mrp-changes section{position:absolute;z-index:15;top:calc(100% + 4px);left:12px;right:12px;display:flex;flex-direction:column;box-sizing:border-box;max-height:min(360px,calc(100vh - 120px));overflow:hidden;max-width:620px;border:1px solid var(--mrp-btn-border);background:var(--mrp-toolbar-bg);padding:12px;box-shadow:0 8px 28px #132c4a1a;border-radius:9px}
.mrp-changes header,.mrp-changes footer{display:flex;align-items:center;justify-content:space-between;gap:8px}
.mrp-changes header>span,.mrp-changes footer>span{font-size:11px;color:var(--mrp-btn-fg)}
.mrp-change-filters{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}
.mrp-change-filters label{display:flex;align-items:center;flex:1;gap:6px;min-width:150px;min-height:30px;padding:0 8px;border:1px solid var(--mrp-btn-border);border-radius:6px}
.mrp-change-filters input{box-sizing:border-box;min-width:0;width:100%;background:transparent;border:0;color:inherit;font:inherit;min-height:28px}
.mrp-change-filters select{min-width:0;max-width:100%;min-height:32px;border:1px solid var(--mrp-btn-border);border-radius:6px;padding:3px 6px;background:var(--mrp-toolbar-bg);color:inherit;font:inherit}
.mrp-changes ol{margin:0;padding-left:22px;min-height:0;overflow:auto}
.mrp-changes li{padding:7px 0;border-bottom:1px solid var(--mrp-toolbar-border)}
.mrp-changes li>button{max-width:100%;text-align:left;justify-content:flex-start;overflow-wrap:anywhere;border:0;padding:0;min-height:24px}
.mrp-changes li>span{display:flex;flex-wrap:wrap;gap:8px;margin-top:3px;overflow-wrap:anywhere}
.mrp-changes li i{font-style:normal;color:var(--mrp-btn-fg)}
.mrp-changes s{color:var(--mrp-btn-fg)}
.mrp-changes footer{margin-top:10px}
.mrp-changes footer>div{display:flex;gap:4px}
.mrp-changes-empty{padding:12px 0;color:var(--mrp-btn-fg)}
.mrp-history-limited{font-size:11px;color:var(--mrp-btn-fg)}
.mrp-conflicts{color:var(--mrp-error-fg,#b9382a);width:100%}
</style>
