<script setup lang="ts">
import { computed } from "vue";
import type { MachReportMessages } from "./config";
import type { ReportSection } from "./tools";
import type { RenderPlan } from "../schema/render-plan";
import type { ReportColumnTarget } from "./column-directory";
import ReportIcon from "./ReportIcon.vue";
import { useColumnDirectory } from "./composables/useColumnDirectory";
const props = defineProps<{ sections: readonly ReportSection[]; currentPage: number; messages: MachReportMessages; busy: boolean; plan?: RenderPlan | null; compact?: boolean }>();
const emit = defineEmits<{ (e: "goto", page: number): void; (e: "locate", field: string): void; (e: "locate-target", target: ReportColumnTarget): void }>();
const controls = useColumnDirectory({ plan: () => props.plan, sections: () => props.sections, busy: () => props.busy, locate: (target) => emit("locate-target", target), locateField: (field) => emit("locate", field) });
const { root, trigger, panel, opened, field, active, directory, matches, candidates, groups, listId } = controls;
const hasFields = computed(() => directory.value.length > 0 || !props.plan || props.plan.pages.some(page => page.components.some(component => component.table?.columnKeys.length)));
const labels = computed(() => ({ columnDirectory: "字段目录", columnSearch: "搜索列名或字段", columnNoMatches: "未找到匹配字段", columnResults: "匹配字段", ...props.messages }));
const moreResults = computed(() => (props.messages.columnResultsMore ?? "{count} 个匹配字段，显示前 {limit} 个；继续输入可缩小范围").replace("{count}", String(matches.value.length)).replace("{limit}", String(candidates.value.length)));
function sectionActive(index: number): boolean {
  const section = props.sections[index];
  return !!section && props.currentPage >= section.pageIndex + 1 && (!props.sections[index + 1] || props.currentPage <= props.sections[index + 1]!.pageIndex);
}
</script>
<template>
  <nav v-if="sections.length > 1 || hasFields" class="mrp-section-nav" :class="{ 'mrp-compact': compact }" :aria-label="messages.sections ?? '工作表与章节'">
    <div v-if="sections.length > 1" class="mrp-section-tabs"><button v-for="(section, index) in sections" :key="index" type="button" :class="{ active: sectionActive(index) }" :aria-current="sectionActive(index) ? 'page' : undefined" :disabled="busy" @click="emit('goto', section.pageIndex + 1)">{{ section.label }}</button></div>
    <div v-if="hasFields" ref="root" class="mrp-column-locator" @keydown="controls.onKeydown">
      <button ref="trigger" type="button" class="mrp-directory-trigger" :class="{ active: opened }" :aria-expanded="opened" aria-haspopup="dialog" :disabled="busy" @click="opened = !opened"><ReportIcon name="columns" /><span>{{ labels.columnDirectory }}</span><span v-if="directory.length" class="mrp-column-count">{{ directory.length }}</span><ReportIcon name="chevron-down" :size="12" /></button>
      <div v-if="opened" ref="panel" class="mrp-column-directory" role="dialog" :aria-label="labels.columnDirectory">
        <div class="mrp-column-heading"><span><ReportIcon name="columns" />{{ labels.columnDirectory }}</span><button type="button" class="mrp-column-close" :aria-label="messages.closeColumnDirectory ?? '关闭字段目录'" @click="controls.close(true)"><ReportIcon name="close" :size="15" /></button></div>
        <form class="mrp-column-search" @submit.prevent="controls.submit">
          <ReportIcon name="search" />
          <input v-model="field" type="search" autocomplete="off" spellcheck="false" role="combobox" :aria-label="labels.columnSearch" :placeholder="labels.columnSearch" aria-autocomplete="list" aria-expanded="true" :aria-controls="listId" :aria-activedescendant="candidates.length ? `${listId}-${active}` : undefined" :disabled="busy" @keydown="controls.onSearchKeydown" />
          <button v-if="field" class="mrp-column-clear" type="button" :aria-label="messages.clearSearch ?? '清除搜索'" @click="controls.clear"><ReportIcon name="close" :size="13" /></button>
        </form>
        <div :id="listId" class="mrp-column-results" role="listbox" :aria-label="labels.columnResults">
          <p v-if="!candidates.length" class="mrp-column-empty" role="status"><ReportIcon name="search" :size="22" />{{ labels.columnNoMatches }}</p>
          <section v-for="group in groups" :key="group.label" role="group" :aria-label="group.label">
            <strong>{{ group.label }}</strong>
            <button v-for="item in group.items" :id="`${listId}-${controls.candidateIndex(item.key)}`" :key="item.key" type="button" role="option" tabindex="-1" :class="{ 'mrp-column-active': controls.candidateIndex(item.key) === active }" :aria-selected="controls.candidateIndex(item.key) === active" :disabled="busy" @pointermove="active = controls.candidateIndex(item.key)" @mousedown.prevent @click="controls.choose(item)"><span>{{ item.label }}<code :title="item.field">{{ item.field }}</code></span><ReportIcon name="arrow-right" :size="14" /></button>
          </section>
        </div>
        <p class="mrp-column-help" role="status">{{ matches.length > candidates.length ? moreResults : messages.columnSearchShortcut ?? '↑ ↓ 选择 · Enter 定位' }}</p>
      </div>
    </div>
  </nav>
</template>
<style scoped>
.mrp-section-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 7px 14px;
  background: var(--mrp-toolbar-bg);
  color: var(--mrp-toolbar-fg);
  font-size: 12px;
  border-bottom: 1px solid var(--mrp-toolbar-border);
}
button,input {
  font: inherit;
  color: inherit;
}
.mrp-section-tabs {
  display: flex;
  gap: 4px;
  overflow: auto;
  max-width: 100%;
}
.mrp-section-tabs button {
  border: 0;
  border-radius: 6px;
  padding: 7px 10px;
  background: transparent;
  cursor: pointer;
  white-space: nowrap;
}
.active {
  color: var(--mrp-btn-active-bg);
  background: color-mix(in srgb,var(--mrp-btn-active-bg) 10%,transparent);
}
button:disabled {
  opacity: .4;
  cursor: not-allowed;
}
button:focus-visible {
  outline: 2px solid var(--mrp-btn-active-bg);
  outline-offset: 2px;
}
.mrp-column-locator {
  position: relative;
  margin-left: auto;
  max-width: 100%;
}
.mrp-directory-trigger {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 30px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  cursor: pointer;
}
.mrp-directory-trigger:hover {
  background: var(--mrp-btn-hover-bg);
}
.mrp-column-count {
  padding: 1px 5px;
  min-width: 15px;
  border-radius: 4px;
  background: color-mix(in srgb,var(--mrp-toolbar-fg) 6%,transparent);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  text-align: center;
  opacity: .75;
}
.mrp-column-directory {
  position: absolute;
  right: 0;
  top: calc(100% + 7px);
  z-index: 25;
  width: min(400px,calc(100vw - 48px));
  padding: 10px;
  box-sizing: border-box;
  background: var(--mrp-toolbar-bg);
  border: 1px solid var(--mrp-toolbar-border);
  border-radius: 12px;
  box-shadow: 0 14px 40px #122a4f24;
}
.mrp-column-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2px 9px;
  font-weight: 600;
}
.mrp-column-heading>span {
  display: flex;
  align-items: center;
  gap: 7px;
}
.mrp-column-close,.mrp-column-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 25px;
  height: 25px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  cursor: pointer;
  opacity: .6;
}
.mrp-column-close:hover,.mrp-column-clear:hover {
  background: var(--mrp-btn-hover-bg);
  opacity: 1;
}
.mrp-column-search {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 9px;
  padding: 4px 7px 4px 9px;
  border: 1px solid var(--mrp-btn-border);
  border-radius: 8px;
  background: color-mix(in srgb,var(--mrp-btn-active-bg) 3%,var(--mrp-toolbar-bg));
}
.mrp-column-search:focus-within {
  outline: 2px solid color-mix(in srgb,var(--mrp-btn-active-bg) 30%,transparent);
  outline-offset: 1px;
  border-color: var(--mrp-btn-active-bg);
}
.mrp-column-search>svg {
  opacity: .5;
  flex: none;
}
.mrp-column-search input {
  min-width: 0;
  width: 100%;
  height: 26px;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
}
.mrp-column-search input::placeholder {
  color: inherit;
  opacity: .45;
}
.mrp-column-search input::-webkit-search-cancel-button {
  display: none;
}
.mrp-column-results {
  max-height: min(340px,45vh);
  overflow: auto;
  overscroll-behavior: contain;
}
.mrp-column-results section+section {
  margin-top: 7px;
}
.mrp-column-results strong {
  display: block;
  padding: 6px 8px;
  font-size: 11px;
  font-weight: 500;
  color: var(--mrp-btn-fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mrp-column-results button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 9px 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.mrp-column-results button>span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.mrp-column-results code {
  display: block;
  margin-top: 3px;
  color: var(--mrp-btn-fg);
  font-family: ui-monospace,SFMono-Regular,Consolas,monospace;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mrp-column-results button>svg {
  flex: none;
  opacity: 0;
}
.mrp-column-results .mrp-column-active,.mrp-column-results button:hover {
  background: color-mix(in srgb,var(--mrp-btn-active-bg) 9%,transparent);
  color: var(--mrp-btn-active-bg);
}
.mrp-column-results .mrp-column-active>svg,.mrp-column-results button:hover>svg {
  opacity: .65;
}
.mrp-column-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 9px;
  padding: 22px 10px;
  opacity: .5;
}
.mrp-column-help {
  padding: 9px 4px 0;
  margin: 9px 0 0;
  border-top: 1px solid var(--mrp-toolbar-border);
  font-size: 11px;
  line-height: 1.6;
  color: var(--mrp-btn-fg);
}
@media(max-width:600px) {
  .mrp-section-nav {
    padding: 7px 10px;
  }
  .mrp-column-directory {
    width: min(360px,calc(100vw - 40px));
  }
}
.mrp-section-nav.mrp-compact {
  padding: 0;
  border: 0;
  background: transparent;
  gap: 0;
}
.mrp-compact .mrp-column-locator {
  margin-left: 0;
}
</style>
