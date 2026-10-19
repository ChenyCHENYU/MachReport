<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { MachReportMessages } from "./config";
import ReportIcon from "./ReportIcon.vue";
const props = defineProps<{ pageCount: number; currentPage: number; messages: MachReportMessages; busy?: boolean }>();
const emit = defineEmits<{ (e: "goto", page: number): void }>();
const draft = ref(String(props.currentPage));
const invalid = ref(false);
const pageInfo = computed(() => props.messages.pageInfo.replace("{cur}", String(props.currentPage)).replace("{total}", String(props.pageCount)));
watch(() => [props.currentPage, props.pageCount], () => { draft.value = String(props.currentPage); invalid.value = false; });
function jump(): void {
  if (props.busy) return;
  const value = draft.value.trim();
  const page = Number(value);
  invalid.value = !/^\d+$/.test(value) || !Number.isSafeInteger(page) || page < 1 || page > props.pageCount;
  if (!invalid.value && page !== props.currentPage) emit("goto", page);
}
</script>
<template>
  <nav v-if="pageCount > 0" class="mrp-pagination" role="navigation" :aria-label="messages.pagination ?? '报表分页'">
    <span class="mrp-pageinfo" aria-live="polite">{{ pageInfo }}</span>
    <div class="mrp-page-buttons">
      <button class="mrp-nav" type="button" :aria-label="messages.prevPage" :title="messages.prevPage" :disabled="busy || currentPage <= 1" @click="emit('goto', currentPage - 1)"><ReportIcon name="chevron-left" /></button>
      <button class="mrp-nav" type="button" :aria-label="messages.nextPage" :title="messages.nextPage" :disabled="busy || currentPage >= pageCount" @click="emit('goto', currentPage + 1)"><ReportIcon name="chevron-right" /></button>
    </div>
    <form v-if="pageCount > 1" class="mrp-page-jump" @submit.prevent="jump">
      <label><span>{{ messages.pageJump ?? '跳至页' }}</span><input v-model="draft" type="text" inputmode="numeric" autocomplete="off" :aria-label="messages.pageJump ?? '跳至页'" :title="messages.pageJumpHint ?? 'Enter 跳转'" :aria-invalid="invalid" :disabled="busy" @input="invalid = false" @keydown.esc="draft = String(currentPage); invalid = false" /></label>
      <button class="mrp-nav" type="submit" :aria-label="messages.pageJump ?? '跳至页'" :disabled="busy"><ReportIcon name="arrow-right" :size="14" /></button>
    </form>
    <span v-if="invalid" class="mrp-page-error" role="alert">{{ messages.pageJumpInvalid ?? '请输入有效页码' }}</span>
  </nav>
</template>
<style scoped>
.mrp-pagination {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  flex: none;
  min-height: 48px;
  box-sizing: border-box;
  margin: 0;
  padding: 8px 14px;
  background: var(--mrp-toolbar-bg);
  color: var(--mrp-toolbar-fg);
  font-size: 12px;
  font-family: inherit;
  font-weight: 400;
  line-height: 18px;
  letter-spacing: normal;
  border-top: 1px solid var(--mrp-toolbar-border);
}
.mrp-pageinfo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 29px;
  margin: 0;
  padding: 0;
  min-width: 45px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  opacity: .8;
}
.mrp-page-buttons {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  padding: 0;
}
.mrp-nav {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 29px;
  height: 29px;
  min-width: 29px;
  min-height: 29px;
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  border: 1px solid var(--mrp-btn-border);
  border-radius: 6px;
  color: var(--mrp-btn-fg);
  background: transparent;
  font: inherit;
  line-height: 18px;
  cursor: pointer;
}
.mrp-nav:hover:not(:disabled) {
  background: var(--mrp-btn-hover-bg);
  color: var(--mrp-btn-hover-fg);
}
.mrp-nav:disabled {
  opacity: .35;
  cursor: not-allowed;
}
.mrp-page-jump {
  display: flex;
  align-items: center;
  gap: 5px;
  box-sizing: border-box;
  min-height: 29px;
  margin: 0;
  padding: 0 0 0 12px;
  font: inherit;
  line-height: inherit;
  border-left: 1px solid var(--mrp-toolbar-border);
}
.mrp-page-jump label {
  display: flex;
  align-items: center;
  gap: 7px;
  box-sizing: border-box;
  min-height: 29px;
  margin: 0;
  padding: 0;
  font: inherit;
  line-height: inherit;
}
.mrp-page-jump label span {
  display: inline-flex;
  align-items: center;
  min-height: 29px;
  margin: 0;
  padding: 0;
  opacity: .6;
}
.mrp-page-jump input {
  display: block;
  box-sizing: border-box;
  width: 45px;
  height: 29px;
  min-width: 0;
  min-height: 29px;
  margin: 0;
  padding: 0 6px;
  border: 1px solid var(--mrp-btn-border);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  line-height: 18px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.mrp-nav :deep(svg) {
  display: block;
  flex: none;
  margin: 0;
  padding: 0;
}
button:focus-visible,input:focus-visible {
  outline: 2px solid var(--mrp-btn-active-bg);
  outline-offset: 2px;
}
input[aria-invalid=true] {
  border-color: #c05050;
}
.mrp-page-error {
  flex-basis: 100%;
  text-align: right;
  color: #c05050;
  font-size: 11px;
}
.mrp-toolbar .mrp-pagination {
  padding: 0;
  min-height: 32px;
  border-top: 0;
}
@media(max-width:480px) {
  .mrp-pagination {
    gap: 8px;
    padding: 8px 10px;
  }
  .mrp-page-jump {
    padding-left: 8px;
  }
}
</style>
