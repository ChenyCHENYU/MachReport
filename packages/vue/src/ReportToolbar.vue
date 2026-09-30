<script setup lang="ts">
/**
 * 工具栏（纯展示）：所有按钮事件上抛，无自身状态。
 * 主题走 CSS 变量（--mrp-*），宿主可在 :root 或组件外壳覆写配色。
 */
defineProps<{
  pageCount: number;
  currentPage: number;
  zoomMode: "fit" | "raw";
  zoom: number;
  showExport: boolean;
  showPrint: boolean;
  showPdfWindow: boolean;
}>();

defineEmits<{
  (e: "goto", page: number): void;
  (e: "zoom", mode: "fit" | number): void;
  (e: "export", format: "html" | "pdf"): void;
  (e: "print"): void;
  (e: "pdf-window"): void;
}>();
</script>

<template>
  <div class="mrp-toolbar">
    <span class="mrp-title">报表预览</span>
    <template v-if="pageCount > 0">
      <button class="mrp-nav" type="button" :disabled="currentPage <= 1" @click="$emit('goto', currentPage - 1)">‹ 上一页</button>
      <span class="mrp-pageinfo">{{ currentPage }} / {{ pageCount }}</span>
      <button class="mrp-nav" type="button" :disabled="currentPage >= pageCount" @click="$emit('goto', currentPage + 1)">下一页 ›</button>
    </template>
    <span class="mrp-spacer" />
    <button
      class="mrp-nav"
      :class="{ 'mrp-active': zoomMode === 'fit' }"
      type="button"
      @click="$emit('zoom', 'fit')"
    >
适宽
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
    <button v-if="showExport" class="mrp-nav" type="button" @click="$emit('export', 'html')">导出 HTML</button>
    <button v-if="showExport" class="mrp-nav" type="button" @click="$emit('export', 'pdf')">导出 PDF</button>
    <button v-if="showPrint" class="mrp-nav" type="button" @click="$emit('print')">打印</button>
    <button v-if="showPdfWindow" class="mrp-nav" type="button" @click="$emit('pdf-window')">PDF 窗口</button>
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
</style>
