<script setup lang="ts">
import { computed, nextTick, watch } from "vue";
import type { MachReportMessages } from "./config";
import type { ReportDataReviewMessages, ReportDataReviewTool } from "./data-review";
import ReportIcon from "./ReportIcon.vue";
import { usePopover } from "./composables/usePopover";
const props = defineProps<{ prefill: boolean; comparison: boolean; issueCount: number; busy?: boolean; messages: MachReportMessages & ReportDataReviewMessages }>();
const emit = defineEmits<{ open: [tool: ReportDataReviewTool] }>();
const { opened, root, trigger, panel, close, onKeydown } = usePopover();
const choices = computed(() => [
  { key: "prefill" as const, label: props.messages.prefillTitle, visible: props.prefill },
  { key: "comparison" as const, label: props.messages.comparisonTitle, visible: props.comparison },
  { key: "validation" as const, label: `${props.messages.validationTitle} · ${props.issueCount}`, visible: props.issueCount > 0 }
].filter(item => item.visible));
watch(() => props.busy, busy => { if (busy) close(); });
function choose(tool: ReportDataReviewTool): void { if (!props.busy) { trigger.value?.focus(); close(); emit("open", tool); } }
function openKeyboard(event: KeyboardEvent): void { if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return; event.preventDefault(); opened.value = true; if (event.key === "ArrowUp") void nextTick(() => panel.value?.querySelector<HTMLElement>("button:last-child")?.focus()); }
function navigate(event: KeyboardEvent): void {
  if (event.key === "Tab") { close(); return; }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation();
  const items = [...(panel.value?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])], current = items.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
}
</script>
<template>
  <div v-if="choices.length" ref="root" class="mrp-data-tools" @keydown="onKeydown"><button ref="trigger" class="mrp-data-tools-trigger" type="button" :disabled="busy" :aria-label="messages.reviewTools" aria-haspopup="menu" :aria-expanded="opened" @click="opened = !opened" @keydown="openKeyboard"><ReportIcon name="columns" />{{ messages.reviewTools }}<b v-if="issueCount">{{ issueCount }}</b><ReportIcon name="chevron-down" :size="12" /></button><div v-if="opened" ref="panel" class="mrp-data-tools-panel" role="menu" :aria-label="messages.reviewTools" @keydown="navigate"><button v-for="item in choices" :key="item.key" type="button" role="menuitem" tabindex="-1" :data-review-tool="item.key" @click="choose(item.key)">{{ item.label }}<ReportIcon name="arrow-right" :size="14" /></button></div></div>
</template>
<style scoped>
.mrp-data-tools{position:relative}.mrp-data-tools-trigger{display:inline-flex;align-items:center;gap:6px;min-height:32px;padding:0 10px;border:1px solid var(--mrp-btn-border);border-radius:7px;background:var(--mrp-toolbar-bg);color:var(--mrp-btn-fg);font:inherit;font-size:12px;white-space:nowrap;cursor:pointer}.mrp-data-tools-trigger b{font-size:10px;min-width:14px;border-radius:5px;padding:1px 3px;background:color-mix(in srgb,var(--mrp-error-fg,#b42318) 9%,transparent);color:var(--mrp-error-fg,#b42318)}.mrp-data-tools-panel{position:absolute;z-index:30;right:0;top:calc(100% + 7px);min-width:190px;padding:6px;background:var(--mrp-toolbar-bg);color:var(--mrp-toolbar-fg);border:1px solid var(--mrp-toolbar-border);border-radius:10px;box-shadow:0 12px 36px #122a4f24}.mrp-data-tools-panel button{display:flex;align-items:center;justify-content:space-between;gap:14px;width:100%;min-height:36px;padding:0 9px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:12px;text-align:left;cursor:pointer}.mrp-data-tools button:hover{background:var(--mrp-btn-hover-bg);color:var(--mrp-btn-hover-fg)}.mrp-data-tools button:focus-visible{outline:2px solid var(--mrp-btn-active-bg);outline-offset:2px}.mrp-data-tools button:disabled{opacity:.5;cursor:not-allowed}
</style>
