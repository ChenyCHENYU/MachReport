<script setup lang="ts">
import type { ReportDrillAction } from "../source/drill";
import type { MachReportMessages } from "./config";
import ReportIcon from "./ReportIcon.vue";
defineProps<{ entries: readonly { action: ReportDrillAction; reason?: string }[]; pending: boolean; busy: boolean; error: string; messages: MachReportMessages }>();
const emit = defineEmits<{ (e: "open", id: string): void }>();
</script>
<template>
  <div v-if="entries.length" class="mrp-drill-actions" role="group" :aria-label="messages.drillActions">
    <span>{{ messages.drillActions }}</span>
    <button v-for="entry in entries" :key="entry.action.id" type="button" :disabled="busy || pending || !!entry.reason" :title="entry.reason" @click="emit('open', entry.action.id)">
      {{ entry.action.label }}<ReportIcon name="arrow-right" :size="13" />
    </button>
    <small v-if="pending" role="status">{{ messages.drillOpening }}</small>
    <small v-else-if="error" role="alert">{{ error }}</small>
    <small v-else-if="entries.every(entry => entry.reason)" role="status">{{ messages.drillMissingValue }}</small>
  </div>
</template>
<style scoped>
.mrp-drill-actions { display:flex; align-items:center; flex-wrap:wrap; gap:8px; padding:6px 14px; background:var(--mrp-toolbar-bg); border-bottom:1px solid var(--mrp-toolbar-border); color:var(--mrp-toolbar-fg); font-size:11px; }
.mrp-drill-actions>span,.mrp-drill-actions>small { opacity:.65; }
button { display:inline-flex; align-items:center; gap:6px; border:1px solid var(--mrp-btn-border); border-radius:6px; background:transparent; color:var(--mrp-btn-active-bg); padding:5px 8px; font:inherit; cursor:pointer; }
button:hover:not(:disabled) { background:var(--mrp-btn-hover-bg); }
button:disabled { opacity:.45; cursor:default; }
button:focus-visible { outline:2px solid var(--mrp-btn-active-bg); outline-offset:2px; }
</style>
