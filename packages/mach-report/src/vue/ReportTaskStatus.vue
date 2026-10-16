<script setup lang="ts">
import { computed } from "vue";
import type { MachReportMessages } from "./config";
import type { ReportPreviewTask } from "./guards";
const props = defineProps<{ task: Readonly<ReportPreviewTask> | null; messages: MachReportMessages }>();
defineEmits<{ (e: "cancel"): void }>();
const stages = computed(() => ({ query: props.messages.taskQuery, validate: props.messages.taskValidate, layout: props.messages.taskLayout, assets: props.messages.taskAssets, import: props.messages.importing, encode: props.messages.taskEncode, download: props.messages.taskDownload, print: props.messages.taskPrint }));
const count = computed(() => props.task?.total === undefined ? "" : `${props.task.completed ?? 0} / ${props.task.total}`);
</script>
<template>
  <div v-if="task && (task.status === 'running' || task.status === 'cancelled')" class="mrp-task-status" role="status" aria-live="polite">
    <span>{{ task.status === 'cancelled' ? messages.taskCancelled : stages[task.stage] }} <small v-if="task.status === 'running'">{{ count }}</small></span>
    <progress v-if="task.status === 'running' && task.total !== undefined" :value="task.completed ?? 0" :max="task.total" :aria-label="stages[task.stage]" />
    <button v-if="task.status === 'running' && task.cancellable" type="button" @click="$emit('cancel')">{{ messages.taskCancel }}</button>
  </div>
</template>
<style scoped>
.mrp-task-status{display:flex;align-items:center;gap:12px;padding:9px 12px;background:var(--mrp-toolbar-bg);color:var(--mrp-toolbar-fg);font-size:12px;border-bottom:1px solid var(--mrp-toolbar-border)}small{opacity:.7;margin-left:6px}progress{width:120px;height:7px;accent-color:var(--mrp-btn-active-bg)}button{margin-left:auto;color:inherit;background:transparent;border:1px solid var(--mrp-btn-border);border-radius:4px;padding:4px 9px;cursor:pointer}
</style>
