<script setup lang="ts">
import { ref } from "vue";
import type { MachReportMessages } from "./config";
import type { ReportSection } from "./tools";
defineProps<{ sections: readonly ReportSection[]; currentPage: number; messages: MachReportMessages; busy: boolean }>();
const emit = defineEmits<{ (e: "goto", page: number): void; (e: "locate", field: string): void }>();
const field = ref("");
</script>
<template>
  <nav class="mrp-section-nav" :aria-label="messages.sections">
    <div v-if="sections.length > 1" class="mrp-section-tabs"><button v-for="(section, index) in sections" :key="index" type="button" :class="{active: currentPage >= section.pageIndex + 1 && (!sections[index + 1] || currentPage <= sections[index + 1]!.pageIndex)}" :disabled="busy" @click="emit('goto', section.pageIndex + 1)">{{ section.label }}</button></div>
    <form @submit.prevent="emit('locate', field.trim())"><input v-model="field" type="text" :aria-label="messages.locateField" :placeholder="messages.locateFieldPlaceholder" :disabled="busy" /><button type="submit" :disabled="busy || !field.trim()">{{ messages.locateField }}</button></form>
  </nav>
</template>
<style scoped>
.mrp-section-nav{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:7px;padding:6px 12px;background:var(--mrp-toolbar-bg);color:var(--mrp-toolbar-fg);font-size:12px;border-bottom:1px solid var(--mrp-toolbar-border)}.mrp-section-tabs{display:flex;gap:4px;overflow:auto;max-width:100%}button,input{font:inherit;color:inherit;background:transparent;border:1px solid var(--mrp-btn-border);border-radius:4px;padding:4px 7px}button{cursor:pointer}.active{background:var(--mrp-btn-active-bg)}form{display:flex;gap:4px;margin-left:auto}input{width:min(220px,40vw)}input::placeholder{color:inherit;opacity:.6}
</style>
