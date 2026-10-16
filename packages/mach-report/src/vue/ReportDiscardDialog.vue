<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import type { MachReportMessages } from "./config";
defineProps<{ messages: MachReportMessages }>();
const emit = defineEmits<{ (e: "answer", approved: boolean): void }>();
const keep = ref<HTMLButtonElement | null>(null);
const discard = ref<HTMLButtonElement | null>(null);
let previousFocus: HTMLElement | null = null;
function keydown(event: KeyboardEvent): void {
  if (event.key === "Escape") { event.preventDefault(); emit("answer", false); }
  if (event.key !== "Tab") return;
  event.preventDefault();
  if (document.activeElement === keep.value) discard.value?.focus();
  else keep.value?.focus();
}
onMounted(() => { previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null; keep.value?.focus(); });
onUnmounted(() => { if (previousFocus?.isConnected) previousFocus.focus(); });
</script>
<template>
  <div class="mrp-discard-backdrop" @keydown="keydown" @click.self="emit('answer', false)">
    <section class="mrp-discard-dialog" role="alertdialog" aria-modal="true" :aria-label="messages.discardTitle">
      <strong>{{ messages.discardTitle }}</strong><p>{{ messages.discardDescription }}</p>
      <footer><button ref="keep" type="button" @click="emit('answer', false)">{{ messages.discardKeep }}</button><button ref="discard" type="button" @click="emit('answer', true)">{{ messages.discardProceed }}</button></footer>
    </section>
  </div>
</template>
<style scoped>
.mrp-discard-backdrop{position:absolute;inset:0;z-index:45;background:rgba(15,23,42,.25);display:flex;align-items:center;justify-content:center;padding:18px}.mrp-discard-dialog{box-sizing:border-box;width:min(400px,100%);padding:22px;border-radius:10px;border:1px solid var(--mrp-toolbar-border);background:var(--mrp-toolbar-bg);color:var(--mrp-toolbar-fg);box-shadow:0 14px 45px #0003;font-size:13px}.mrp-discard-dialog strong{font-size:16px}.mrp-discard-dialog p{line-height:1.7;opacity:.8}footer{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}button{font:inherit;color:inherit;background:transparent;border:1px solid var(--mrp-btn-border);padding:7px 12px;border-radius:5px;cursor:pointer}button:hover{background:var(--mrp-btn-hover-bg)}button:focus-visible{outline:2px solid var(--mrp-btn-active-bg);outline-offset:2px}
</style>
