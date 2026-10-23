<script setup lang="ts">
import { computed } from "vue";
import type { RenderPlan } from "../schema/render-plan";
import type { MachReportMessages } from "./config";
import { indexRecordNavigation } from "./record-navigation";
import ReportIcon from "./ReportIcon.vue";

const props = defineProps<{ plan: RenderPlan | null; currentPage: number; messages: MachReportMessages; busy: boolean }>();
const emit = defineEmits<{ (e: "goto", page: number): void }>();
const index = computed(() => indexRecordNavigation(props.plan));
const current = computed(() => index.value.pageRecords[props.currentPage - 1] ?? -1);
const entry = computed(() => current.value >= 0 ? index.value.entries[current.value] : undefined);
const info = computed(() => (props.messages.recordInfo ?? "记录 {cur} / {total}").replace("{cur}", String(current.value + 1)).replace("{total}", String(index.value.entries.length)));
const pageTitle = computed(() => {
  const value = props.plan?.pages[props.currentPage - 1]?.meta?.title;
  return typeof value === "string" ? value : "";
});
function move(direction: number): void {
  const next = index.value.entries[current.value + direction];
  if (!props.busy && current.value >= 0 && next) emit("goto", next.page);
}
</script>
<template>
  <nav v-if="entry" class="mrp-record-navigation" :aria-label="messages.recordNavigation ?? '标签记录'">
    <div v-if="index.entries.length > 1" class="mrp-record-arrows">
      <button type="button" :aria-label="messages.prevRecord ?? '上一条记录'" :title="messages.prevRecord ?? '上一条记录'" :disabled="busy || current <= 0" @click="move(-1)"><ReportIcon name="chevron-left" :size="13" /></button>
      <button type="button" :aria-label="messages.nextRecord ?? '下一条记录'" :title="messages.nextRecord ?? '下一条记录'" :disabled="busy || current >= index.entries.length - 1" @click="move(1)"><ReportIcon name="chevron-right" :size="13" /></button>
    </div>
    <span class="mrp-record-info" aria-live="polite">{{ info }}</span>
    <code v-if="entry.rowKey !== undefined" :title="String(entry.rowKey)">{{ entry.rowKey }}</code>
    <span v-if="pageTitle" class="mrp-record-face" :title="pageTitle">{{ pageTitle }}</span>
  </nav>
</template>
<style scoped>
.mrp-record-navigation{display:flex;align-items:center;gap:9px;min-width:0;font-size:11px;line-height:18px;max-width:100%;padding:8px 0}
.mrp-record-arrows{display:flex;gap:2px;flex:none}
button{display:flex;align-items:center;justify-content:center;width:25px;height:27px;padding:0;border:1px solid transparent;border-radius:5px;background:transparent;color:var(--mrp-btn-fg);cursor:pointer}
button:hover:not(:disabled){background:var(--mrp-btn-hover-bg);color:var(--mrp-btn-hover-fg)}
button:disabled{opacity:.3;cursor:not-allowed}button:focus-visible{outline:2px solid var(--mrp-btn-active-bg);outline-offset:2px}
.mrp-record-info{white-space:nowrap;opacity:.65;font-variant-numeric:tabular-nums}
code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:160px}
.mrp-record-face{opacity:.65;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px;padding-left:9px;border-left:1px solid var(--mrp-toolbar-border)}
@container(max-width:680px){.mrp-record-face{display:none}code{max-width:110px}}
</style>
