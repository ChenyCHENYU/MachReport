<script setup lang="ts">
/**
 * 工具栏（纯展示）：所有按钮事件上抛，无自身状态。
 * 主题走 CSS 变量（--mrp-*），文案走 messages 参数（配置中心可全局覆写）。
 * 搜索区（search.visible 时渲染）：输入即时上抛（防抖在 composable 层），
 * 打开时自动聚焦输入框。
 */
import { nextTick, ref, watch } from "vue";
import type { MachReportMessages } from "./config";

const props = defineProps<{
  pageCount: number;
  currentPage: number;
  zoomMode: "fit" | "raw";
  zoom: number;
  showExport: boolean;
  showPrint: boolean;
  showPdfWindow: boolean;
  messages: MachReportMessages;
  search: { visible: boolean; query: string; matchIndex: number; matchCount: number };
  thumbsVisible: boolean;
}>();

defineEmits<{
  (e: "goto", page: number): void;
  (e: "zoom", mode: "fit" | number): void;
  (e: "export", format: "html" | "pdf"): void;
  (e: "print"): void;
  (e: "pdf-window"): void;
  (e: "search-input", query: string): void;
  (e: "search-nav", dir: 1 | -1): void;
  (e: "search-toggle"): void;
  (e: "thumbs-toggle"): void;
}>();

const searchInputRef = ref<HTMLInputElement | null>(null);
watch(
  () => props.search.visible,
  (visible) => {
    if (visible) {
      void nextTick(() => searchInputRef.value?.focus());
    }
  }
);

function pageInfo(text: string, cur: number, total: number): string {
  return text.replace("{cur}", String(cur)).replace("{total}", String(total));
}
</script>

<template>
  <div class="mrp-toolbar">
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
    <div v-if="search.visible" class="mrp-search">
      <input
        ref="searchInputRef"
        class="mrp-search-input"
        type="text"
        :placeholder="messages.searchPlaceholder"
        :value="search.query"
        @input="$emit('search-input', ($event.target as HTMLInputElement).value)"
      />
      <span v-if="search.query" class="mrp-search-count">{{
        pageInfo(messages.matchInfo, search.matchIndex + 1, search.matchCount)
      }}</span>
      <button
        class="mrp-nav"
        type="button"
        :disabled="search.matchCount === 0"
        @click="$emit('search-nav', -1)"
      >
{{ messages.prevMatch }}
</button>
      <button
        class="mrp-nav"
        type="button"
        :disabled="search.matchCount === 0"
        @click="$emit('search-nav', 1)"
      >
{{ messages.nextMatch }}
</button>
    </div>
    <button
      class="mrp-nav"
      :class="{ 'mrp-active': search.visible }"
      type="button"
      title="Ctrl+F"
      @click="$emit('search-toggle')"
    >
🔍
</button>
    <button
      class="mrp-nav"
      :class="{ 'mrp-active': thumbsVisible }"
      type="button"
      @click="$emit('thumbs-toggle')"
    >
▦ {{ messages.thumbnails }}
</button>
    <button
      class="mrp-nav"
      :class="{ 'mrp-active': zoomMode === 'fit' }"
      type="button"
      @click="$emit('zoom', 'fit')"
    >
{{ messages.fitWidth }}
</button>
    <button
      class="mrp-nav"
      :class="{ 'mrp-active': zoomMode === 'raw' && Math.round(zoom * 100) === 100 }"
      type="button"
      @click="$emit('zoom', 100)"
    >
100%
</button>
    <button
      class="mrp-nav"
      :class="{ 'mrp-active': zoomMode === 'raw' && Math.round(zoom * 100) === 150 }"
      type="button"
      @click="$emit('zoom', 150)"
    >
150%
</button>
    <button
      v-if="showExport"
      class="mrp-nav"
      type="button"
      @click="$emit('export', 'html')"
    >
{{ messages.exportHtml }}
</button>
    <button
      v-if="showExport"
      class="mrp-nav"
      type="button"
      @click="$emit('export', 'pdf')"
    >
{{ messages.exportPdf }}
</button>
    <button v-if="showPrint" class="mrp-nav" type="button" @click="$emit('print')">{{ messages.print }}</button>
    <button v-if="showPdfWindow" class="mrp-nav" type="button" @click="$emit('pdf-window')">{{ messages.pdfWindow }}</button>
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
.mrp-pageinfo { font-size: 12px; min-width: 56px; text-align: center; color: var(--mrp-toolbar-fg, #e8e8e8); }
.mrp-spacer { flex: 1; }
.mrp-search { display: flex; align-items: center; gap: 4px; }
.mrp-search-input {
  background: #22252a;
  color: #e8e8e8;
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
