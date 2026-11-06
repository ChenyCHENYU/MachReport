<script setup lang="ts">
import { computed, getCurrentInstance, ref, watch } from "vue";
import type { RenderPlan } from "@agile-team/mach-report";
import type { MachReportMessages } from "./config";
import type { ConflictChoice, ConflictReviewRow } from "./edit-conflict-review";
import { resolveConflictMessages } from "./conflict-messages";
import { createColumnDirectory } from "./column-directory";
import ReportIcon from "./ReportIcon.vue";
const props = defineProps<{ rows: readonly ConflictReviewRow[]; messages: MachReportMessages; reading: boolean; applying: boolean; ready: boolean; canQuery: boolean; error: string | null; plan?: RenderPlan | null }>();
defineEmits<{ refresh: []; submit: []; choose: [key: string, choice: ConflictChoice] }>();
const m = computed(() => resolveConflictMessages(props.messages));
const radioPrefix = `mrp-conflict-${getCurrentInstance()?.uid ?? 0}-`;
const labels = computed(() => new Map(createColumnDirectory(props.plan).map(entry => [JSON.stringify([entry.tableId, entry.field]), entry.label])));
function fieldLabel(row: ConflictReviewRow): string {
  const field = row.edit.source?.field ?? row.edit.table?.columnKey;
  return labels.value.get(JSON.stringify([row.edit.table?.id, field])) ?? field ?? "";
}
const query = ref(""), page = ref(0), size = 100;
const matches = computed(() => {
  const terms = query.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return props.rows.filter(row => terms.every(term => `${row.edit.source?.datasetId ?? ""} ${row.edit.source?.rowKey ?? ""} ${row.edit.source?.field ?? ""}`.toLocaleLowerCase().includes(term)));
});
const visible = computed(() => matches.value.slice(page.value * size, (page.value + 1) * size));
const count = computed(() => m.value.conflictReviewCount.replace("{count}", String(props.rows.length)).replace("{pending}", String(props.rows.filter(row => row.choice === null).length)));
function unavailable(row: ConflictReviewRow): string {
  const labels = { missing: m.value.conflictReviewMissing, ambiguous: m.value.conflictReviewAmbiguous, readonly: m.value.conflictReviewReadonly, available: "" };
  return labels[row.availability];
}
watch(query, () => { page.value = 0; });
watch(() => matches.value.length, length => { page.value = Math.min(page.value, Math.max(0, Math.ceil(length / size) - 1)); });
</script>
<template>
  <section class="mrp-conflict-review" :aria-busy="reading || applying">
    <p class="mrp-conflict-intro">{{ m.conflictReviewDescription }}</p>
    <div class="mrp-conflict-actions"><button type="button" :disabled="reading || applying || !canQuery" @click="$emit('refresh')"><ReportIcon name="search" :size="14" />{{ reading ? m.conflictReviewLoading : m.conflictReviewRefresh }}</button><span v-if="rows.length" role="status">{{ count }}</span></div>
    <p v-if="!canQuery" class="mrp-conflict-notice">{{ m.conflictReviewUnavailable }}</p>
    <p v-if="error" class="mrp-conflict-error" role="alert">{{ error }}<span>{{ m.conflictReviewRetained }}</span></p>
    <template v-if="rows.length">
      <label class="mrp-conflict-search"><ReportIcon name="search" :size="15" /><input v-model="query" type="search" :disabled="reading || applying" :aria-label="m.conflictReviewSearch" :placeholder="m.conflictReviewSearch" /></label>
      <ol class="mrp-conflict-rows" :start="page * size + 1">
        <li v-for="row in visible" :key="row.key">
          <header><strong>{{ fieldLabel(row) }}</strong><span>{{ row.edit.source?.datasetId }} · {{ row.edit.source?.rowKey }}</span></header>
          <div class="mrp-conflict-original"><span>{{ m.conflictReviewOriginal }}</span><s>{{ row.edit.previousText || '∅' }}</s></div>
          <fieldset :disabled="reading || applying">
            <legend>{{ m.conflictReviewChoose }}</legend>
            <label :class="{ selected: row.choice === 'local', unavailable: row.availability !== 'available' }"><input type="radio" :name="radioPrefix + encodeURIComponent(row.key)" value="local" :checked="row.choice === 'local'" :disabled="row.availability !== 'available'" @change="$emit('choose', row.key, 'local')" /><span>{{ m.conflictReviewLocal }}<strong>{{ row.edit.text || '∅' }}</strong></span></label>
            <label :class="{ selected: row.choice === 'server' }"><input type="radio" :name="radioPrefix + encodeURIComponent(row.key)" value="server" :checked="row.choice === 'server'" @change="$emit('choose', row.key, 'server')" /><span>{{ m.conflictReviewServer }}<strong>{{ row.latestText || '∅' }}</strong></span></label>
          </fieldset>
          <p v-if="unavailable(row)" class="mrp-conflict-notice">{{ unavailable(row) }}</p>
        </li>
      </ol>
      <p v-if="!matches.length" role="status">{{ m.conflictReviewEmpty }}</p>
      <nav v-if="matches.length > size" :aria-label="messages.pagination"><span>{{ page + 1 }} / {{ Math.ceil(matches.length / size) }}</span><button type="button" :disabled="page === 0 || reading || applying" :aria-label="messages.prevPage" @click="page--"><ReportIcon name="chevron-left" :size="14" /></button><button type="button" :disabled="(page + 1) * size >= matches.length || reading || applying" :aria-label="messages.nextPage" @click="page++"><ReportIcon name="chevron-right" :size="14" /></button></nav>
      <div class="mrp-conflict-footer"><button class="mrp-conflict-submit" type="button" :disabled="!ready || reading || applying" @click="$emit('submit')">{{ applying ? messages.saving : m.conflictReviewApply }}</button></div>
    </template>
  </section>
</template>
<style scoped>
.mrp-conflict-review{font-size:12px;color:var(--mrp-toolbar-fg)}.mrp-conflict-intro{margin:0 0 12px;line-height:1.65;color:var(--mrp-btn-fg)}.mrp-conflict-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.mrp-conflict-actions>span{color:var(--mrp-btn-fg);font-size:11px}
button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:5px 10px;border:1px solid var(--mrp-btn-border);border-radius:7px;background:var(--mrp-toolbar-bg);color:var(--mrp-btn-fg);font:inherit;cursor:pointer}button:hover:not(:disabled){background:var(--mrp-btn-hover-bg);color:var(--mrp-btn-hover-fg)}button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible{outline:2px solid var(--mrp-btn-active-bg);outline-offset:2px}.mrp-conflict-notice{font-size:11px;color:var(--mrp-btn-fg);line-height:1.6;margin:8px 0 0}.mrp-conflict-error{padding:10px 12px;border:1px solid color-mix(in srgb,var(--mrp-error-fg) 25%,var(--mrp-toolbar-border));border-radius:7px;background:var(--mrp-toolbar-bg);background:color-mix(in srgb,var(--mrp-error-fg) 8%,var(--mrp-toolbar-bg));color:var(--mrp-error-fg);overflow-wrap:anywhere;line-height:1.6}.mrp-conflict-error span{display:block;font-size:11px}
.mrp-conflict-search{display:flex;gap:8px;align-items:center;border:1px solid var(--mrp-btn-border);border-radius:7px;padding:0 9px;margin:14px 0;color:var(--mrp-btn-fg)}.mrp-conflict-search:focus-within{outline:2px solid var(--mrp-btn-active-bg);outline-offset:1px}.mrp-conflict-search input{min-width:0;width:100%;min-height:32px;border:0;font:inherit;background:transparent;color:inherit;outline:none}.mrp-conflict-rows{list-style:none;margin:0;padding:0;display:grid;gap:12px}.mrp-conflict-rows li{padding:12px;border:1px solid var(--mrp-toolbar-border);border-radius:9px}.mrp-conflict-rows header{display:flex;align-items:baseline;justify-content:space-between;gap:10px;overflow-wrap:anywhere}.mrp-conflict-rows header>span{color:var(--mrp-btn-fg);font-size:11px}.mrp-conflict-original{display:flex;gap:10px;align-items:baseline;margin:8px 0;color:var(--mrp-btn-fg);overflow-wrap:anywhere}.mrp-conflict-original s{text-decoration:none}
fieldset{border:0;margin:10px 0 0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}legend{font-size:11px;color:var(--mrp-btn-fg);padding:0;margin-bottom:6px}fieldset label{display:flex;gap:8px;align-items:flex-start;padding:10px;border:1px solid var(--mrp-btn-border);border-radius:7px;cursor:pointer;min-width:0}fieldset label.selected{border-color:var(--mrp-btn-active-bg);background:color-mix(in srgb,var(--mrp-btn-active-bg) 6%,var(--mrp-toolbar-bg))}fieldset label.unavailable{opacity:.5;cursor:default}fieldset input{accent-color:var(--mrp-btn-active-bg);margin:2px 0 0}fieldset label span{font-size:11px;color:var(--mrp-btn-fg);overflow-wrap:anywhere}fieldset strong{display:block;font-size:13px;color:var(--mrp-toolbar-fg);font-weight:500;margin-top:5px;white-space:pre-wrap}nav{display:flex;align-items:center;justify-content:flex-end;gap:6px;margin-top:14px}nav>span{margin-right:6px;color:var(--mrp-btn-fg)}.mrp-conflict-footer{position:sticky;bottom:0;display:flex;justify-content:flex-end;background:var(--mrp-toolbar-bg);padding-top:12px;margin-top:8px;border-top:1px solid var(--mrp-toolbar-border)}button.mrp-conflict-submit{color:var(--mrp-btn-active-fg);background:var(--mrp-btn-active-bg);border-color:var(--mrp-btn-active-bg)}@media(max-width:480px){fieldset{grid-template-columns:1fr}.mrp-conflict-rows header{flex-wrap:wrap}}
</style>
