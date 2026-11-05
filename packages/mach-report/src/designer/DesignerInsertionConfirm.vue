<script setup lang="ts">
import { getCurrentInstance, onBeforeUnmount, onMounted, ref } from "vue";
import ReportIcon from "../vue/ReportIcon.vue";

defineProps<{
  title: string;
  description: string;
  impacts: string[];
  confirm: string;
  cancel: string;
}>();
const emit = defineEmits<{ (event: "confirm"): void; (event: "cancel"): void }>();
const id = `mr-insertion-${getCurrentInstance()?.uid ?? 0}`;
const cancelButton = ref<HTMLButtonElement>();
const confirmButton = ref<HTMLButtonElement>();
let previousFocus: HTMLElement | null = null;

function keydown(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === "Escape") {
    event.preventDefault();
    emit("cancel");
  }
  if (event.key !== "Tab") return;
  event.preventDefault();
  const target = event.shiftKey
    ? (document.activeElement === cancelButton.value ? confirmButton.value : cancelButton.value)
    : (document.activeElement === confirmButton.value ? cancelButton.value : confirmButton.value);
  target?.focus();
}
onMounted(() => {
  previousFocus = document.activeElement as HTMLElement | null;
  cancelButton.value?.focus();
});
onBeforeUnmount(() => { if (previousFocus?.isConnected) previousFocus.focus(); });
</script>
<template>
  <div class="mr-insert-confirm mr-designer-controls" @keydown.stop="keydown">
    <section role="alertdialog" aria-modal="true" :aria-labelledby="`${id}-title`" :aria-describedby="`${id}-description ${id}-impact`">
      <span class="mr-insert-confirm-icon" aria-hidden="true"><ReportIcon name="file" :size="20" /></span>
      <h3 :id="`${id}-title`">{{ title }}</h3>
      <p :id="`${id}-description`">{{ description }}</p>
      <ul :id="`${id}-impact`"><li v-for="impact in impacts" :key="impact">{{ impact }}</li></ul>
      <footer><button ref="cancelButton" type="button" @click="emit('cancel')">{{ cancel }}</button><button ref="confirmButton" class="mr-insert-confirm-action" type="button" @click="emit('confirm')">{{ confirm }}</button></footer>
    </section>
  </div>
</template>
<style src="./designer-controls.css"></style>
<style scoped>
.mr-insert-confirm {
  box-sizing: border-box;
  position: absolute;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: #17324d2b;
}
.mr-insert-confirm section {
  box-sizing: border-box;
  width: 420px;
  max-width: 100%;
  max-height: 100%;
  overflow: auto;
  padding: 22px;
  border: 1px solid var(--mrp-toolbar-border, #dbe3ec);
  border-radius: 12px;
  background: var(--mrp-toolbar-bg, #fff);
  box-shadow: 0 18px 50px #17324d26;
}
.mr-insert-confirm-icon {
  display: inline-flex;
  padding: 8px;
  border-radius: 9px;
  background: var(--mrp-btn-hover-bg, #eff6ff);
  color: var(--mrp-btn-hover-fg, #2563eb);
}
.mr-insert-confirm h3 { margin: 12px 0 7px; font-size: 15px; }
.mr-insert-confirm p { margin: 0; color: var(--mrp-btn-fg, #64748b); line-height: 1.7; }
.mr-insert-confirm ul { padding: 10px 12px 10px 28px; margin: 12px 0 18px; border-radius: 7px; background: var(--mrp-btn-hover-bg, #eff6ff); line-height: 1.8; }
.mr-insert-confirm footer { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.mr-insert-confirm .mr-insert-confirm-action { border-color: var(--mrp-btn-active-bg, #2563eb); background: var(--mrp-btn-active-bg, #2563eb); color: #fff; }
.mr-insert-confirm .mr-insert-confirm-action:hover { filter: brightness(0.94); }
</style>
