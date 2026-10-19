<script setup lang="ts">
import { computed, nextTick, watch } from "vue";
import type { MachReportMessages } from "./config";
import type { ReportExportFormat } from "./tools";
import ReportIcon from "./ReportIcon.vue";
import { usePopover } from "./composables/usePopover";

const props = defineProps<{ messages: MachReportMessages; formats?: readonly ReportExportFormat[]; busy?: boolean }>();
const emit = defineEmits<{ (e: "export", format: ReportExportFormat): void }>();
const { opened, root, trigger, panel, close, onKeydown } = usePopover();
const choices = computed(() => [
  { format: "xlsx" as const, label: props.messages.exportExcel, extension: ".xlsx" },
  { format: "pdf" as const, label: props.messages.exportPdf, extension: ".pdf" },
  { format: "png" as const, label: props.messages.exportImage, extension: ".png" },
  { format: "word" as const, label: props.messages.exportWord, extension: ".doc" },
  { format: "html" as const, label: props.messages.exportHtml, extension: ".html" }
].filter((item) => !props.formats || props.formats.includes(item.format)));
watch(() => props.busy, (busy) => { if (busy) close(); });
function choose(format: ReportExportFormat): void {
  if (props.busy) return;
  emit("export", format); close(true);
}
function openWithKeyboard(event: KeyboardEvent): void {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault(); opened.value = true;
  if (event.key === "ArrowUp") void nextTick(() => panel.value?.querySelector<HTMLElement>("button:last-child")?.focus());
}
function navigate(event: KeyboardEvent): void {
  if (event.key === "Tab") { close(); return; }
  const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
  if (!keys.includes(event.key)) return;
  event.preventDefault(); event.stopPropagation();
  const items = [...(panel.value?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
}
</script>
<template>
  <div v-if="choices.length" ref="root" class="mrp-export-menu" @keydown="onKeydown">
    <button ref="trigger" type="button" class="mrp-nav mrp-export-trigger" :disabled="busy" aria-haspopup="menu" :aria-expanded="opened" @click="opened = !opened" @keydown="openWithKeyboard">
      <ReportIcon name="download" />{{ messages.exportMenu ?? "导出" }}<ReportIcon name="chevron-down" :size="12" />
    </button>
    <div v-if="opened" ref="panel" class="mrp-export-panel" role="menu" :aria-label="messages.exportMenu ?? '导出'" @keydown="navigate">
      <p>{{ messages.exportMenuDescription ?? "选择文件格式" }}</p>
      <button v-for="item in choices" :key="item.format" type="button" role="menuitem" tabindex="-1" :aria-label="item.label" :disabled="busy" @click="choose(item.format)"><ReportIcon name="file" /><span>{{ item.label }}</span><small aria-hidden="true">{{ item.extension }}</small></button>
    </div>
  </div>
</template>
<style scoped>
.mrp-export-menu {
  position: relative;
}
.mrp-export-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--mrp-btn-border);
  border-radius: 7px;
  background: var(--mrp-toolbar-bg);
  color: var(--mrp-btn-fg);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.mrp-export-trigger:hover:not(:disabled) {
  background: var(--mrp-btn-hover-bg);
  color: var(--mrp-btn-hover-fg);
}
.mrp-export-trigger[aria-expanded=true] {
  border-color: var(--mrp-btn-active-bg);
  color: var(--mrp-btn-active-bg);
}
.mrp-export-panel {
  position: absolute;
  z-index: 30;
  right: 0;
  top: calc(100% + 7px);
  min-width: 205px;
  padding: 6px;
  background: var(--mrp-toolbar-bg);
  color: var(--mrp-toolbar-fg);
  border: 1px solid var(--mrp-toolbar-border);
  border-radius: 11px;
  box-shadow: 0 12px 36px #122a4f24;
}
.mrp-export-panel p {
  margin: 4px 8px 7px;
  font-size: 11px;
  opacity: .72;
}
.mrp-export-panel button {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  height: 36px;
  padding: 0 9px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.mrp-export-panel button small {
  margin-left: auto;
  opacity: .65;
  font-size: 11px;
}
.mrp-export-panel button:hover,.mrp-export-panel button:focus-visible {
  background: var(--mrp-btn-hover-bg);
  color: var(--mrp-btn-hover-fg);
}
button:focus-visible {
  outline: 2px solid var(--mrp-btn-active-bg);
  outline-offset: 2px;
}
button:disabled {
  opacity: .45;
  cursor: not-allowed;
}
</style>
