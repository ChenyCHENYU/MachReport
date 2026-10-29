<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from "vue";
import type { TemplateEditorPanel } from "./useTemplateEditor";
import { DESIGNER_GUIDE_MESSAGES, type DesignerGuideMessages } from "./guide-messages";
const props = defineProps<{ fields: boolean; disabled?: boolean; messages?: Partial<DesignerGuideMessages> }>();
const emit = defineEmits<{ (event: "choose", target: TemplateEditorPanel): void }>();
const m = computed(() => ({ ...DESIGNER_GUIDE_MESSAGES, ...props.messages }));
const open = ref(false);
const trigger = ref<HTMLButtonElement>();
const root = ref<HTMLElement>();
function outside(event: Event): void {
  if (event.target instanceof Node && !root.value?.contains(event.target)) open.value = false;
}
function blur(event: FocusEvent): void {
  if (!(event.relatedTarget instanceof Node) || !root.value?.contains(event.relatedTarget)) open.value = false;
}
onMounted(() => window.document.addEventListener("pointerdown", outside));
onBeforeUnmount(() => window.document.removeEventListener("pointerdown", outside));
const tasks = computed(() => [ ...(props.fields ? ["fields" as const] : []), "components", "layout", "excel", "rules", "review" ] as const);
function choose(target: TemplateEditorPanel): void { emit("choose", target); open.value = false; trigger.value?.focus(); }
function close(): void { open.value = false; trigger.value?.focus(); }
</script>
<template>
  <div ref="root" class="mr-designer-guide" @keydown.esc.stop.prevent="close" @focusout="blur">
    <button ref="trigger" type="button" :aria-expanded="open" :disabled="disabled" @click="open = !open">{{ m.title }}<span aria-hidden="true">⌄</span></button>
    <div v-if="open" class="mr-designer-guide-panel" role="region" :aria-label="m.title">
      <header><strong>{{ m.prompt }}</strong><button type="button" :aria-label="m.close" @click="close">×</button></header>
      <button v-for="target in tasks" :key="target" type="button" @click="choose(target)"><strong>{{ m[target] }}</strong><span>{{ m[`${target}Hint`] }}</span><i aria-hidden="true">→</i></button>
      <p>{{ m.result }}</p>
    </div>
  </div>
</template>
<style scoped>
.mr-designer-guide{position:relative}.mr-designer-guide>button{gap:7px}.mr-designer-guide-panel{position:absolute;z-index:60;top:calc(100% + 7px);right:0;width:310px;max-width:calc(100vw - 64px);padding:8px;background:var(--mrp-toolbar-bg,#fff);border:1px solid var(--mrp-toolbar-border,#dbe3ed);border-radius:9px;box-shadow:0 12px 32px #16314b24;color:var(--mrp-toolbar-fg,#334155)}.mr-designer-guide-panel header{display:flex;justify-content:space-between;align-items:center;padding:4px 7px 8px;font-size:12px}.mr-designer-guide-panel header button{border:0;background:transparent;padding:0;width:24px;height:24px}.mr-designer-guide-panel>button{display:grid;grid-template-columns:1fr 20px;justify-content:start;gap:2px;width:100%;border:0;padding:9px;text-align:left;background:transparent}.mr-designer-guide-panel>button strong{font-size:12px;font-weight:600}.mr-designer-guide-panel>button span{grid-column:1;font-size:10px;color:var(--mrp-btn-fg,#64748b)}.mr-designer-guide-panel i{grid-column:2;grid-row:1 / span 2;align-self:center;font-style:normal;color:var(--mrp-btn-active-bg,#2563eb)}.mr-designer-guide-panel p{padding:8px 7px 2px;margin:4px 0 0;border-top:1px solid var(--mrp-toolbar-border,#dbe3ed);font-size:10px;color:var(--mrp-btn-fg,#64748b)}
</style>
