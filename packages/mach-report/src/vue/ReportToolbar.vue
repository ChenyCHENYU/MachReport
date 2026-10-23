<script setup lang="ts">
/** Presentation controls stay thin: search, layout and output work remain in the preview composables. */
import type { MachReportMessages } from "./config";
import type { ReportExportFormat } from "./tools";
import { useSearchInput } from "./composables/useSearchInput";
import ReportExportMenu from "./ReportExportMenu.vue";
import ReportIcon from "./ReportIcon.vue";
import ReportPagination from "./ReportPagination.vue";

const props = withDefaults(defineProps<{
  pageCount: number;
  currentPage: number;
  zoomMode: "fit" | "raw";
  zoom: number;
  showExport: boolean;
  showPrint: boolean;
  showPdfWindow: boolean;
  messages: MachReportMessages;
  search: { visible: boolean; query: string; matchIndex: number; matchCount: number; searching?: boolean };
  thumbsVisible: boolean;
  showImport?: boolean;
  showSearch?: boolean;
  showThumbnails?: boolean;
  showZoom?: boolean;
  exportFormats?: readonly ReportExportFormat[];
  showSettings?: boolean;
  settingsOpen?: boolean;
  busy?: boolean;
  /** Standalone toolbar escape hatch; ReportPreview renders pagination in its footer. */
  showPagination?: boolean;
}>(), { showSearch: true, showThumbnails: true, showZoom: true, exportFormats: undefined });
const emit = defineEmits<{
  (e: "goto", page: number): void;
  (e: "zoom", mode: "fit" | number): void;
  (e: "export", format: ReportExportFormat): void;
  (e: "print"): void;
  (e: "pdf-window"): void;
  (e: "search-input", query: string): void;
  (e: "search-nav", dir: 1 | -1): void;
  (e: "search-toggle"): void;
  (e: "thumbs-toggle"): void;
  (e: "import-excel"): void;
  (e: "settings-toggle"): void;
}>();
const searchControls = useSearchInput({
  visible: () => props.search.visible,
  navigate: (direction) => { if (!props.search.searching && props.search.matchCount > 0) emit("search-nav", direction); },
  close: () => { if (props.search.visible) emit("search-toggle"); }
});
const { input: searchInputRef, toggle: searchToggleRef } = searchControls;
defineExpose({ focusSearch: searchControls.focus });
function matchInfo(): string {
  const current = props.search.matchCount > 0 ? props.search.matchIndex + 1 : 0;
  return props.messages.matchInfo.replace("{cur}", String(current)).replace("{total}", String(props.search.matchCount));
}
function clearSearch(): void { emit("search-input", ""); searchControls.focus(); }
</script>
<template>
  <div class="mrp-toolbar" role="toolbar" :aria-label="messages.title">
    <span class="mrp-title"><ReportIcon name="file" />{{ messages.title }}</span>
    <ReportPagination v-if="showPagination" :page-count="pageCount" :current-page="currentPage" :messages="messages" :busy="busy" @goto="emit('goto', $event)" />
    <span class="mrp-spacer" />
    <div v-if="showSearch !== false" class="mrp-read-tools" role="group" :aria-label="messages.search ?? '内容搜索'">
      <button ref="searchToggleRef" class="mrp-nav mrp-search-toggle mrp-icon-button" :class="{ 'mrp-active': search.visible }" type="button" title="Ctrl+F" :aria-label="messages.search ?? messages.searchPlaceholder" :aria-pressed="search.visible" @click="emit('search-toggle')"><ReportIcon name="search" /></button>
      <button v-if="showThumbnails !== false" class="mrp-nav" :class="{ 'mrp-active': thumbsVisible }" type="button" :aria-pressed="thumbsVisible" @click="emit('thumbs-toggle')"><ReportIcon name="grid" />{{ messages.thumbnails }}</button>
    </div>
    <button v-else-if="showThumbnails !== false" class="mrp-nav" :class="{ 'mrp-active': thumbsVisible }" type="button" :aria-pressed="thumbsVisible" @click="emit('thumbs-toggle')"><ReportIcon name="grid" />{{ messages.thumbnails }}</button>
    <slot name="navigation" />
    <div v-if="showZoom !== false" class="mrp-zoom-tools" role="group" :aria-label="messages.zoom ?? '缩放工具'">
      <button class="mrp-nav" :class="{ 'mrp-active': zoomMode === 'fit' }" :aria-pressed="zoomMode === 'fit'" type="button" @click="emit('zoom', 'fit')"><ReportIcon name="fit" />{{ messages.fitWidth }}</button>
      <button v-for="value in [100, 150]" :key="value" class="mrp-nav" :class="{ 'mrp-active': zoomMode === 'raw' && Math.round(zoom * 100) === value }" :aria-pressed="zoomMode === 'raw' && Math.round(zoom * 100) === value" type="button" @click="emit('zoom', value)">{{ value }}%</button>
    </div>
    <div v-if="showImport || showExport || showPrint || showPdfWindow" class="mrp-output-tools" role="group" :aria-label="messages.settingsExport ?? '导出与打印'">
      <button v-if="showImport" class="mrp-nav mrp-import-excel" type="button" :disabled="busy" @click="emit('import-excel')"><ReportIcon name="upload" />{{ messages.importExcel ?? '导入 Excel 模板' }}</button>
      <ReportExportMenu v-if="showExport" :messages="messages" :formats="exportFormats" :busy="busy" @export="emit('export', $event)" />
      <button v-if="showPrint" class="mrp-nav" type="button" :disabled="busy" @click="emit('print')"><ReportIcon name="print" />{{ messages.print }}</button>
      <button v-if="showPdfWindow" class="mrp-nav" type="button" :disabled="busy" @click="emit('pdf-window')"><ReportIcon name="external" />{{ messages.pdfWindow }}</button>
    </div>
    <button v-if="showSettings" class="mrp-nav mrp-settings-toggle" type="button" :class="{ 'mrp-active': settingsOpen }" :aria-label="messages.settings ?? '设置'" aria-haspopup="dialog" :aria-expanded="!!settingsOpen" @click="emit('settings-toggle')"><ReportIcon name="settings" />{{ messages.settings ?? '设置' }}</button>
    <div v-if="showSearch !== false && search.visible" class="mrp-search-panel" role="search" :aria-label="messages.search ?? '内容搜索'">
      <div class="mrp-search" :class="{ 'mrp-search-no-results': search.query && !search.searching && !search.matchCount }">
        <ReportIcon name="search" />
        <input ref="searchInputRef" class="mrp-search-input" type="text" autocomplete="off" spellcheck="false" :placeholder="messages.searchPlaceholder" :aria-label="messages.search ?? messages.searchPlaceholder" :value="search.query" @input="emit('search-input', ($event.target as HTMLInputElement).value)" @keydown="searchControls.onKeydown" />
        <button v-if="search.query" class="mrp-nav mrp-search-clear mrp-icon-button" type="button" :aria-label="messages.clearSearch ?? '清除搜索'" @click="clearSearch"><ReportIcon name="close" :size="13" /></button>
        <span v-if="search.query" class="mrp-search-count" role="status" aria-live="polite">{{ search.searching ? messages.searching ?? '搜索中…' : matchInfo() }}</span>
        <button class="mrp-nav mrp-icon-button" type="button" :disabled="search.matchCount === 0 || search.searching" :aria-label="messages.prevSearchMatch ?? '上一个匹配'" @click="emit('search-nav', -1)"><ReportIcon name="chevron-up" :size="14" /></button>
        <button class="mrp-nav mrp-icon-button" type="button" :disabled="search.matchCount === 0 || search.searching" :aria-label="messages.nextSearchMatch ?? '下一个匹配'" @click="emit('search-nav', 1)"><ReportIcon name="chevron-down" :size="14" /></button>
        <button class="mrp-nav mrp-search-close mrp-icon-button" type="button" :aria-label="messages.closeSearch ?? '关闭搜索'" @click="searchControls.close"><ReportIcon name="close" :size="14" /></button>
      </div>
      <span class="mrp-search-hint" role="status">{{ search.query && !search.searching && !search.matchCount ? messages.searchNoMatches ?? '没有匹配内容' : messages.searchHint ?? 'Enter 下一个 · Shift+Enter 上一个' }}</span>
    </div>
  </div>
</template>
<style scoped>
.mrp-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 14px;
  background: var(--mrp-toolbar-bg);
  border-bottom: 1px solid var(--mrp-toolbar-border);
  flex: none;
  color: var(--mrp-toolbar-fg);
}
.mrp-title {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}
.mrp-title svg {
  opacity: .65;
}
.mrp-spacer {
  flex: 1;
  min-width: 8px;
}
.mrp-nav {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 10px;
  background: transparent;
  color: var(--mrp-btn-fg);
  border: 1px solid transparent;
  border-radius: 7px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: background .12s,color .12s;
}
.mrp-nav:hover:not(:disabled) {
  background: var(--mrp-btn-hover-bg);
  color: var(--mrp-btn-hover-fg);
}
.mrp-nav:disabled {
  opacity: .4;
  cursor: not-allowed;
}
.mrp-nav:focus-visible,.mrp-search:focus-within {
  outline: 2px solid var(--mrp-btn-active-bg);
  outline-offset: 2px;
}
.mrp-active {
  background: color-mix(in srgb,var(--mrp-btn-active-bg) 12%,transparent);
  color: var(--mrp-btn-active-bg);
  border-color: color-mix(in srgb,var(--mrp-btn-active-bg) 24%,transparent);
}
.mrp-icon-button {
  width: 32px;
  padding: 0;
}
.mrp-read-tools,.mrp-output-tools,.mrp-zoom-tools {
  display: flex;
  align-items: center;
  gap: 3px;
}
.mrp-output-tools {
  padding-left: 8px;
  border-left: 1px solid var(--mrp-toolbar-border);
}
.mrp-zoom-tools {
  gap: 1px;
  padding: 2px;
  border: 1px solid var(--mrp-btn-border);
  border-radius: 8px;
}
.mrp-zoom-tools .mrp-nav {
  min-height: 27px;
  padding: 0 8px;
  border-radius: 5px;
}
.mrp-settings-toggle {
  border-color: var(--mrp-btn-border);
}
.mrp-search-panel {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  flex-basis: 100%;
  padding-top: 8px;
  border-top: 1px solid var(--mrp-toolbar-border);
}
.mrp-search {
  display: flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
  width: min(500px,100%);
  padding: 3px 5px 3px 11px;
  border: 1px solid var(--mrp-btn-border);
  border-radius: 9px;
  color: var(--mrp-toolbar-fg);
  background: var(--mrp-toolbar-bg);
  box-shadow: 0 2px 6px #142b4d06;
}
.mrp-search>svg {
  flex: none;
  opacity: .6;
}
.mrp-search-input {
  min-width: 70px;
  flex: 1;
  padding: 5px 6px;
  border: 0;
  outline: 0;
  font: inherit;
  font-size: 12px;
  background: transparent;
  color: inherit;
}
.mrp-search-input::placeholder {
  color: inherit;
  opacity: .5;
}
.mrp-search .mrp-nav {
  min-height: 27px;
  width: 27px;
  flex: none;
  border-radius: 6px;
}
.mrp-search-count {
  flex: none;
  min-width: 38px;
  padding: 0 6px;
  text-align: center;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  border-right: 1px solid var(--mrp-toolbar-border);
}
.mrp-search-hint {
  font-size: 11px;
  opacity: .7;
  white-space: nowrap;
}
.mrp-search-no-results .mrp-search-count {
  opacity: .6;
}
@container(max-width:720px) {
  .mrp-toolbar {
    gap: 6px;
    padding: 9px 10px;
  }
  .mrp-title {
    flex-basis: 100%;
  }
  .mrp-spacer {
    display: none;
  }
  .mrp-output-tools {
    border: 0;
    padding-left: 0;
  }
  .mrp-search-panel {
    align-items: flex-start;
    flex-direction: column;
    gap: 6px;
  }
  .mrp-search {
    box-sizing: border-box;
    width: 100%;
  }
  .mrp-search-hint {
    padding-left: 3px;
  }
}
@media(prefers-reduced-motion:reduce) {
  .mrp-nav {
    transition: none;
  }
}
</style>
