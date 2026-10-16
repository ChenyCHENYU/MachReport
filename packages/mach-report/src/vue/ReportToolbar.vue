<script setup lang="ts">
/**
 * 工具栏（纯展示）：所有按钮事件上抛，无自身状态。
 * 主题走 CSS 变量（--mrp-*），文案走 messages 参数（配置中心可全局覆写）。
 * 搜索区（search.visible 时渲染）：输入即时上抛（防抖在 composable 层），
 * 打开时自动聚焦输入框。
 */
import type { MachReportMessages } from "./config";
import type { ReportExportFormat } from "./tools";
import { useSearchInput } from "./composables/useSearchInput";

const props = defineProps<{
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
}>();

const emit = defineEmits<{
  (e: "goto", page: number): void;
  (e: "zoom", mode: "fit" | number): void;
  (e: "export", format: "html" | "pdf" | "xlsx" | "png" | "word"): void;
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
  navigate: (direction) => emit("search-nav", direction),
  close: () => { if (props.search.visible) emit("search-toggle"); }
});
const { input: searchInputRef, toggle: searchToggleRef } = searchControls;
defineExpose({ focusSearch: searchControls.focus });

function pageInfo(text: string, cur: number, total: number): string {
  return text.replace("{cur}", String(cur)).replace("{total}", String(total));
}
</script>

<template>
  <div class="mrp-toolbar" role="toolbar" :aria-label="messages.title">
    <span class="mrp-title">{{ messages.title }}</span>
    <template v-if="pageCount > 0">
      <button
        class="mrp-nav"
        type="button"
        :disabled="currentPage <= 1"
        @click="$emit('goto', currentPage - 1)"
      >
{{ messages.prevPage }}
</button>
      <span class="mrp-pageinfo">{{ pageInfo(messages.pageInfo, currentPage, pageCount) }}</span>
      <button
        class="mrp-nav"
        type="button"
        :disabled="currentPage >= pageCount"
        @click="$emit('goto', currentPage + 1)"
      >
{{ messages.nextPage }}
</button>
    </template>
    <span class="mrp-spacer" />
    <button v-if="showImport" class="mrp-nav mrp-import-excel" type="button" :disabled="busy" @click="$emit('import-excel')">{{ messages.importExcel ?? "导入 Excel 模板" }}</button>
    <div v-if="showSearch !== false && search.visible" class="mrp-search">
      <input
        ref="searchInputRef"
        class="mrp-search-input"
        type="text"
        :placeholder="messages.searchPlaceholder"
        :aria-label="messages.search ?? messages.searchPlaceholder"
        :value="search.query"
        @input="$emit('search-input', ($event.target as HTMLInputElement).value)"
        @keydown="searchControls.onKeydown"
      />
      <span v-if="search.query" class="mrp-search-count" role="status">{{ search.searching
        ? messages.searching ?? "搜索中…"
        : pageInfo(messages.matchInfo, search.matchCount > 0 ? search.matchIndex + 1 : 0, search.matchCount)
      }}</span>
      <button
        class="mrp-nav"
        type="button"
        :disabled="search.matchCount === 0"
        :aria-label="messages.prevSearchMatch"
        @click="$emit('search-nav', -1)"
      >
{{ messages.prevMatch }}
</button>
      <button
        class="mrp-nav"
        type="button"
        :disabled="search.matchCount === 0"
        :aria-label="messages.nextSearchMatch"
        @click="$emit('search-nav', 1)"
      >
{{ messages.nextMatch }}
</button>
      <button class="mrp-nav mrp-search-close" type="button" :aria-label="messages.closeSearch" @click="searchControls.close">×</button>
    </div>
    <button
      ref="searchToggleRef"
      v-if="showSearch !== false"
      class="mrp-nav"
      :class="{ 'mrp-active': search.visible }"
      type="button"
      title="Ctrl+F"
      :aria-label="messages.search ?? messages.searchPlaceholder"
      :aria-pressed="search.visible"
      @click="$emit('search-toggle')"
    >
      <svg width="13" height="13" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" stroke-width="1.6" /><path d="m13 13 4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
</button>
    <button
      v-if="showThumbnails !== false"
      class="mrp-nav"
      :class="{ 'mrp-active': thumbsVisible }"
      type="button"
      :aria-pressed="thumbsVisible"
      @click="$emit('thumbs-toggle')"
    >
▦ {{ messages.thumbnails }}
</button>
    <button
      v-if="showZoom !== false"
      class="mrp-nav"
      :class="{ 'mrp-active': zoomMode === 'fit' }"
      type="button"
      @click="$emit('zoom', 'fit')"
    >
{{ messages.fitWidth }}
</button>
    <button
      v-if="showZoom !== false"
      class="mrp-nav"
      :class="{ 'mrp-active': zoomMode === 'raw' && Math.round(zoom * 100) === 100 }"
      type="button"
      @click="$emit('zoom', 100)"
    >
100%
</button>
    <button
      v-if="showZoom !== false"
      class="mrp-nav"
      :class="{ 'mrp-active': zoomMode === 'raw' && Math.round(zoom * 100) === 150 }"
      type="button"
      @click="$emit('zoom', 150)"
    >
150%
</button>
    <button
      v-if="showExport && (!exportFormats || exportFormats.includes('html'))"
      class="mrp-nav"
      type="button"
      :disabled="busy"
      @click="$emit('export', 'html')"
    >
{{ messages.exportHtml }}
</button>
    <button
      v-if="showExport && (!exportFormats || exportFormats.includes('pdf'))"
      class="mrp-nav"
      type="button"
      :disabled="busy"
      @click="$emit('export', 'pdf')"
    >
{{ messages.exportPdf }}
</button>
    <button
      v-if="showExport && (!exportFormats || exportFormats.includes('xlsx'))"
      class="mrp-nav"
      type="button"
      :disabled="busy"
      @click="$emit('export', 'xlsx')"
    >
{{ messages.exportExcel }}
</button>
    <button
      v-if="showExport && (!exportFormats || exportFormats.includes('png'))"
      class="mrp-nav"
      type="button"
      :disabled="busy"
      @click="$emit('export', 'png')"
    >
{{ messages.exportImage }}
</button>
    <button
      v-if="showExport && (!exportFormats || exportFormats.includes('word'))"
      class="mrp-nav"
      type="button"
      :disabled="busy"
      @click="$emit('export', 'word')"
    >
{{ messages.exportWord }}
</button>
    <button v-if="showPrint" class="mrp-nav" type="button" :disabled="busy" @click="$emit('print')">{{ messages.print }}</button>
    <button v-if="showPdfWindow" class="mrp-nav" type="button" :disabled="busy" @click="$emit('pdf-window')">{{ messages.pdfWindow }}</button>
    <button v-if="showSettings" class="mrp-nav mrp-settings-toggle" type="button" :aria-label="messages.settings" aria-haspopup="dialog" :aria-expanded="!!settingsOpen" @click="$emit('settings-toggle')">
      <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /><circle cx="7" cy="5" r="2" fill="var(--mrp-toolbar-bg)" stroke="currentColor" stroke-width="1.5" /><circle cx="13" cy="10" r="2" fill="var(--mrp-toolbar-bg)" stroke="currentColor" stroke-width="1.5" /><circle cx="8" cy="15" r="2" fill="var(--mrp-toolbar-bg)" stroke="currentColor" stroke-width="1.5" /></svg>
      {{ messages.settings }}
    </button>
  </div>
</template>

<style scoped>
.mrp-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--mrp-toolbar-bg, #323639);
  border-bottom: 1px solid var(--mrp-toolbar-border, #22252a);
  flex: none;
  flex-wrap: wrap;
}
.mrp-title {
  font-size: 13px;
  font-weight: 600;
  margin-right: 8px;
  color: var(--mrp-toolbar-fg, #e8e8e8);
}
.mrp-nav {
  background: transparent;
  color: var(--mrp-btn-fg, #cfcfcf);
  border: 1px solid var(--mrp-btn-border, #4a4d52);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.mrp-nav:hover:not(:disabled) { background: var(--mrp-btn-hover-bg, #414549); color: var(--mrp-btn-hover-fg, #fff); }
.mrp-nav:disabled { opacity: 0.4; cursor: not-allowed; }
.mrp-active { background: var(--mrp-btn-active-bg, #2d5fb8); border-color: var(--mrp-btn-active-bg, #2d5fb8); color: #fff; }
.mrp-settings-toggle { display: inline-flex; align-items: center; gap: 5px; }
.mrp-pageinfo { font-size: 12px; min-width: 56px; text-align: center; color: var(--mrp-toolbar-fg, #e8e8e8); }
.mrp-spacer { flex: 1; }
.mrp-search { display: flex; align-items: center; gap: 4px; }
.mrp-search-input {
  background: var(--mrp-toolbar-bg, #323639);
  color: var(--mrp-toolbar-fg, #e8e8e8);
  border: 1px solid var(--mrp-btn-border, #4a4d52);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 12px;
  width: 150px;
  outline: none;
}
.mrp-search-input:focus { border-color: var(--mrp-btn-active-bg, #2d5fb8); }
.mrp-search-count { font-size: 12px; color: var(--mrp-toolbar-fg, #e8e8e8); min-width: 42px; text-align: center; }
</style>
