<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import ReportIcon from "./ReportIcon.vue";
defineProps<{ title: string; closeLabel: string }>();
const emit = defineEmits<{ close: [] }>();
const panel = ref<HTMLElement | null>(null), closeButton = ref<HTMLButtonElement | null>(null);
let previous: HTMLElement | null = null;
function keydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing) return;
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); emit("close"); return; }
  if (event.key !== "Tab") return;
  const elements = [...(panel.value?.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex='0']") ?? [])];
  const first = elements[0], last = elements[elements.length - 1];
  if (!panel.value?.contains(document.activeElement) || event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
}
onMounted(() => { previous = document.activeElement instanceof HTMLElement ? document.activeElement : null; closeButton.value?.focus(); document.addEventListener("keydown", keydown); });
onUnmounted(() => { document.removeEventListener("keydown", keydown); if (previous?.isConnected) previous.focus(); });
</script>
<template>
  <div class="mrp-review-backdrop" @click.self="emit('close')"><section ref="panel" class="mrp-review-dialog" role="dialog" aria-modal="true" :aria-label="title"><header><div><span>MACH REPORT</span><strong>{{ title }}</strong></div><button ref="closeButton" type="button" :aria-label="closeLabel" @click="emit('close')"><ReportIcon name="close" /></button></header><div class="mrp-review-dialog-body"><slot /></div></section></div>
</template>
<style scoped>
.mrp-review-backdrop{position:absolute;inset:0;z-index:44;display:flex;justify-content:flex-end;background:#11284a2e;padding:12px}.mrp-review-dialog{box-sizing:border-box;width:min(760px,100%);height:100%;display:flex;flex-direction:column;background:var(--mrp-toolbar-bg);color:var(--mrp-toolbar-fg);border:1px solid var(--mrp-toolbar-border);border-radius:14px;box-shadow:0 14px 50px #122a4f26;overflow:hidden}.mrp-review-dialog>header{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid var(--mrp-toolbar-border)}.mrp-review-dialog header span{display:block;letter-spacing:2px;font-size:9px;opacity:.8;margin-bottom:5px}.mrp-review-dialog header strong{font-size:15px}.mrp-review-dialog header button{display:grid;place-items:center;width:30px;height:30px;border:1px solid var(--mrp-btn-border);border-radius:7px;color:inherit;background:transparent;cursor:pointer}.mrp-review-dialog button:focus-visible{outline:2px solid var(--mrp-btn-active-bg);outline-offset:2px}.mrp-review-dialog-body{overflow:auto;min-height:0;padding:14px;flex:1}.mrp-review-dialog-body :deep(.mrp-data-review){border:0;padding:0}
</style>
