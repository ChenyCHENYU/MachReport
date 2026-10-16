<script setup lang="ts">
import { computed, ref } from "vue";
import type { MachReportMessages } from "./config";
import type { ReportSection } from "./tools";
import type { RenderPlan } from "../schema/render-plan";
import { createColumnDirectory, searchColumnDirectory, type ReportColumnTarget } from "./column-directory";
const props = defineProps<{ sections: readonly ReportSection[]; currentPage: number; messages: MachReportMessages; busy: boolean; plan?: RenderPlan | null }>();
const emit = defineEmits<{ (e: "goto", page: number): void; (e: "locate", field: string): void; (e: "locate-target", target: ReportColumnTarget): void }>();
const field = ref("");
const opened = ref(false);
const labels = computed(() => ({ columnDirectory: "字段目录", columnSearch: "搜索列名或字段", columnNoMatches: "未找到匹配字段", columnResults: "匹配字段", ...props.messages }));
const directory = computed(() => createColumnDirectory(props.plan, props.sections));
const candidates = computed(() => searchColumnDirectory(directory.value, field.value));
const groups = computed(() => [...new Set(candidates.value.map((item) => item.group))]);
function choose(target: ReportColumnTarget): void {
  emit("locate-target", target); opened.value = false;
}
function submit(): void {
  if (candidates.value.length === 1) choose(candidates.value[0]!);
  else emit("locate", field.value.trim());
}
function leave(event: FocusEvent): void {
  if (!(event.relatedTarget instanceof Node) || !(event.currentTarget as Element).contains(event.relatedTarget)) opened.value = false;
}
</script>
<template>
  <nav class="mrp-section-nav" :aria-label="messages.sections">
    <div v-if="sections.length > 1" class="mrp-section-tabs"><button v-for="(section, index) in sections" :key="index" type="button" :class="{active: currentPage >= section.pageIndex + 1 && (!sections[index + 1] || currentPage <= sections[index + 1]!.pageIndex)}" :disabled="busy" @click="emit('goto', section.pageIndex + 1)">{{ section.label }}</button></div>
    <div class="mrp-column-locator" @keydown.esc="opened = false" @focusout="leave">
      <form @submit.prevent="submit">
        <button v-if="directory.length" type="button" :aria-expanded="opened" :disabled="busy" @click="opened = !opened">{{ labels.columnDirectory }} <span>{{ directory.length }}</span></button>
        <input v-model="field" type="search" :aria-label="messages.locateField" :placeholder="directory.length ? labels.columnSearch : messages.locateFieldPlaceholder" :disabled="busy" @input="opened = directory.length > 0" />
        <button type="submit" :disabled="busy || !field.trim()">{{ messages.locateField }}</button>
      </form>
      <div v-if="opened && directory.length" class="mrp-column-directory" :aria-label="labels.columnResults">
        <p v-if="!candidates.length" role="status">{{ labels.columnNoMatches }}</p>
        <section v-for="group in groups" :key="group" :aria-label="group">
          <strong>{{ group }}</strong>
          <button v-for="item in candidates.filter(candidate => candidate.group === group)" :key="item.key" type="button" :disabled="busy" @mousedown.prevent @click="choose(item)"><span>{{ item.label }}</span><code>{{ item.field }}</code></button>
        </section>
      </div>
    </div>
  </nav>
</template>
<style scoped>
.mrp-section-nav{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:7px;padding:6px 12px;background:var(--mrp-toolbar-bg);color:var(--mrp-toolbar-fg);font-size:12px;border-bottom:1px solid var(--mrp-toolbar-border)}.mrp-section-tabs{display:flex;gap:4px;overflow:auto;max-width:100%}button,input{font:inherit;color:inherit;background:transparent;border:1px solid var(--mrp-btn-border);border-radius:4px;padding:4px 7px}button{cursor:pointer}.active{background:var(--mrp-btn-active-bg)}form{display:flex;gap:4px;margin-left:auto}input{width:min(220px,40vw)}input::placeholder{color:inherit;opacity:.6}
.mrp-column-locator{position:relative;margin-left:auto;max-width:100%}.mrp-column-locator form{flex-wrap:wrap}.mrp-column-directory{position:absolute;right:0;top:calc(100% + 5px);z-index:12;width:min(460px,80vw);max-height:320px;overflow:auto;padding:8px;background:var(--mrp-toolbar-bg);border:1px solid var(--mrp-toolbar-border);border-radius:7px;box-shadow:0 8px 24px #0002}.mrp-column-directory section{margin-bottom:8px}.mrp-column-directory strong{display:block;font-size:11px;opacity:.7;padding:4px}.mrp-column-directory button{display:flex;justify-content:space-between;text-align:left;gap:12px;width:100%;border:0;padding:7px}.mrp-column-directory button:hover{background:var(--mrp-btn-hover-bg)}.mrp-column-directory code{opacity:.6;font-size:11px}button:focus-visible,input:focus-visible{outline:2px solid var(--mrp-btn-active-bg);outline-offset:2px}
</style>
