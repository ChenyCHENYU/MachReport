<script setup lang="ts">
import { onBeforeUnmount, onMounted, onUnmounted, ref } from "vue";
import ReportIcon from "./ReportIcon.vue";
defineProps<{ title: string; closeLabel: string }>();
const emit = defineEmits<{ close: [] }>();
const panel = ref<HTMLElement | null>(null), closeButton = ref<HTMLButtonElement | null>(null);
let previous: HTMLElement | null = null;
let heldFocusBeforeUnmount = false;
const modalSelector = '[role="dialog"],[role="alertdialog"],dialog[open]';
function ownsKeyboard(event: KeyboardEvent): boolean {
  const own = panel.value;
  if (!own) return false;
  const target = event.target instanceof Element ? event.target : null;
  const modal = target?.closest(modalSelector);
  if (modal) return modal === own;
  if (event.target instanceof Node && own.contains(event.target)) return true;
  const active = document.activeElement;
  if (active !== document.body && active instanceof Element && !own.contains(active)) return false;
  // A browser can drop focus on body after a clicked or disabled control.
  // Another modal keeps ownership until its own handler restores focus.
  return ![...document.querySelectorAll('[aria-modal="true"],dialog[open]')].some(modal => modal !== own);
}
function focusableElements(): HTMLElement[] {
  return [...(panel.value?.querySelectorAll<HTMLElement>("a[href],button,input,textarea,select,[tabindex]") ?? [])]
    .filter(element => element.tabIndex >= 0 && !element.matches(":disabled") && !element.closest('[hidden],[inert],[aria-hidden="true"]'));
}
function keydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || !ownsKeyboard(event)) return;
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); emit("close"); return; }
  if (event.key !== "Tab") return;
  const elements = focusableElements();
  const first = elements[0], last = elements[elements.length - 1];
  if (!panel.value?.contains(document.activeElement) || event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
}
onMounted(() => { previous = document.activeElement instanceof HTMLElement ? document.activeElement : null; closeButton.value?.focus(); document.addEventListener("keydown", keydown); });
onBeforeUnmount(() => { heldFocusBeforeUnmount = panel.value?.contains(document.activeElement) === true; });
onUnmounted(() => {
  document.removeEventListener("keydown", keydown);
  if (!previous?.isConnected || document.activeElement !== document.body) return;
  const modals = [...document.querySelectorAll('[aria-modal="true"],dialog[open]')];
  if (!heldFocusBeforeUnmount && modals.some(modal => !modal.contains(previous))) return;
  previous.focus({ preventScroll: true });
});
</script>
<template>
  <div class="mrp-review-backdrop" @click.self="emit('close')"><section ref="panel" class="mrp-review-dialog" role="dialog" aria-modal="true" :aria-label="title"><header><div><span>MACH REPORT</span><strong>{{ title }}</strong></div><button ref="closeButton" type="button" :aria-label="closeLabel" @click="emit('close')"><ReportIcon name="close" /></button></header><div class="mrp-review-dialog-body"><slot /></div></section></div>
</template>
<style scoped>
.mrp-review-backdrop{position:absolute;inset:0;z-index:44;display:flex;justify-content:flex-end;background:#11284a2e;padding:12px}.mrp-review-dialog{box-sizing:border-box;width:min(760px,100%);height:100%;display:flex;flex-direction:column;background:var(--mrp-toolbar-bg);color:var(--mrp-toolbar-fg);border:1px solid var(--mrp-toolbar-border);border-radius:14px;box-shadow:0 14px 50px #122a4f26;overflow:hidden}.mrp-review-dialog>header{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid var(--mrp-toolbar-border)}.mrp-review-dialog header span{display:block;letter-spacing:2px;font-size:9px;opacity:.8;margin-bottom:5px}.mrp-review-dialog header strong{font-size:15px}.mrp-review-dialog header button{display:grid;place-items:center;width:30px;height:30px;border:1px solid var(--mrp-btn-border);border-radius:7px;color:inherit;background:transparent;cursor:pointer}.mrp-review-dialog button:focus-visible{outline:2px solid var(--mrp-btn-active-bg);outline-offset:2px}.mrp-review-dialog-body{overflow:auto;min-height:0;padding:14px;flex:1}.mrp-review-dialog-body :deep(.mrp-data-review){border:0;padding:0}
</style>
