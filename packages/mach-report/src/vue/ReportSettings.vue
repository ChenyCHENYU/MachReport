<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { MachReportMessages } from "./config";
import type { ReportInteractionOptions, ReportPreviewPreferences, ReportPreviewTool } from "./tools";

const props = defineProps<{
  available: ReportPreviewPreferences;
  enabled: ReportPreviewPreferences;
  messages: MachReportMessages;
  persistedEditing: boolean;
  busy?: boolean;
  interaction?: ReportInteractionOptions;
}>();
const emit = defineEmits<{
  (e: "change", key: ReportPreviewTool, enabled: boolean): void;
  (e: "reset"): void;
  (e: "close"): void;
  (e: "interaction", value: ReportInteractionOptions): void;
}>();
const panel = ref<HTMLElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
let previousFocus: HTMLElement | null = null;
const groups = computed(() => [
  { label: props.messages.settingsDisplay, tools: [
    ["search", props.messages.search], ["thumbnails", props.messages.thumbnails], ["zoom", props.messages.zoom]
  ] },
  { label: props.messages.settingsExport, tools: [
    ["html", props.messages.exportHtml], ["pdf", props.messages.exportPdf], ["xlsx", props.messages.exportExcel],
    ["png", props.messages.exportImage], ["word", props.messages.exportWord],
    ["print", props.messages.print], ["pdfWindow", props.messages.pdfWindow]
  ] },
  { label: props.messages.settingsData, tools: [
    ["editing", props.messages.editCell], ["import", props.messages.importExcel]
  ] }
].map((group) => ({ ...group, tools: group.tools.map(([key, label]) => ({ key: key as ReportPreviewTool, label })) })));

function onChange(event: Event, key: ReportPreviewTool): void {
  const input = event.target as HTMLInputElement;
  const enabled = input.checked;
  // 保持受控：异步校验/保存失败前不提前显示已关闭，键盘操作同样走 change。
  input.checked = props.enabled[key];
  emit("change", key, enabled);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") { event.preventDefault(); emit("close"); return; }
  if (event.key !== "Tab") return;
  const elements = panel.value?.querySelectorAll<HTMLElement>("a[href],button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex='0']");
  const first = elements?.[0];
  const last = elements?.[elements.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}

onMounted(() => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  closeButton.value?.focus();
});
onUnmounted(() => previousFocus?.focus());
</script>

<template>
  <div class="mrp-settings-backdrop" @click.self="$emit('close')" @keydown="onKeydown">
    <section ref="panel" class="mrp-settings-panel" role="dialog" aria-modal="true" :aria-label="messages.settings">
      <header class="mrp-settings-header">
        <div><strong>{{ messages.settings }}</strong><p>{{ messages.settingsLocal }}</p></div>
        <button ref="closeButton" class="mrp-settings-close" type="button" :aria-label="messages.settingsClose" @click="$emit('close')">×</button>
      </header>
      <div class="mrp-settings-content">
        <slot />
        <fieldset v-if="interaction">
          <legend>{{ messages.settingsPanes }}</legend>
          <label class="mrp-settings-option"><span>{{ messages.freezeHeaders }}</span><input type="checkbox" :checked="interaction.freezeHeaders" :disabled="busy" @change="$emit('interaction', { freezeHeaders: ($event.target as HTMLInputElement).checked })" /></label>
          <label class="mrp-settings-option"><span>{{ messages.frozenColumns }}</span><input class="mrp-frozen-count" type="number" min="0" max="20" :value="interaction.frozenColumns ?? 0" :disabled="busy" @change="$emit('interaction', { frozenColumns: Math.max(0, Math.min(20, Number(($event.target as HTMLInputElement).value) || 0)) })" /></label>
        </fieldset>
        <fieldset v-for="group in groups" :key="group.label">
          <legend>{{ group.label }}</legend>
          <label v-for="tool in group.tools" :key="tool.key" class="mrp-settings-option" :class="{ 'mrp-settings-unavailable': !available[tool.key] }">
            <span>{{ tool.label }}<small v-if="!available[tool.key]">{{ messages.settingsUnavailable }}</small></span>
            <input type="checkbox" :checked="enabled[tool.key]" :disabled="busy || !available[tool.key]" @change="onChange($event, tool.key)" />
          </label>
        </fieldset>
        <p v-if="available.editing" class="mrp-settings-note">{{ persistedEditing ? messages.editingSaved : messages.editingLocal }}</p>
        <p v-if="available.import" class="mrp-settings-note">{{ messages.importLocal }}</p>
      </div>
      <footer><button type="button" :disabled="busy" @click="$emit('reset')">{{ messages.settingsReset }}</button></footer>
    </section>
  </div>
</template>

<style scoped>
.mrp-settings-backdrop { position: absolute; inset: 0; z-index: 30; background: rgba(15, 23, 42, .12); display: flex; justify-content: flex-end; padding: 10px; }
.mrp-settings-panel { box-sizing: border-box; width: min(340px, 100%); display: flex; flex-direction: column; min-height: 0; border: 1px solid var(--mrp-toolbar-border); border-radius: 10px; background: var(--mrp-toolbar-bg); color: var(--mrp-toolbar-fg); box-shadow: 0 12px 40px rgba(0, 0, 0, .22); font-size: 13px; }
.mrp-settings-header { display: flex; align-items: flex-start; justify-content: space-between; padding: 16px 16px 10px; }
.mrp-settings-header strong { font-size: 15px; }
.mrp-settings-header p { font-size: 12px; opacity: .7; margin: 7px 0 0; line-height: 1.5; }
.mrp-settings-panel button { cursor: pointer; color: inherit; border: 1px solid var(--mrp-btn-border); background: transparent; border-radius: 5px; padding: 5px 10px; }
.mrp-settings-panel button:hover { background: var(--mrp-btn-hover-bg); }
.mrp-settings-close { font-size: 20px; line-height: 18px; }
.mrp-settings-content { overflow: auto; padding: 0 16px 10px; }
.mrp-settings-content fieldset { border: 0; border-top: 1px solid var(--mrp-toolbar-border); margin: 12px 0 0; padding: 7px 0 0; min-width: 0; }
.mrp-settings-content legend { font-weight: 600; padding-right: 10px; }
.mrp-settings-option { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 0; cursor: pointer; }
.mrp-settings-option input { accent-color: var(--mrp-btn-active-bg); width: 15px; height: 15px; margin: 0; flex: none; }
.mrp-settings-option input.mrp-frozen-count { width: 54px; height: 24px; color: inherit; background: transparent; border: 1px solid var(--mrp-btn-border); border-radius: 4px; }
.mrp-settings-option small { display: block; font-size: 11px; margin-top: 3px; opacity: .75; }
.mrp-settings-unavailable { opacity: .5; cursor: default; }
.mrp-settings-note { font-size: 11px; line-height: 1.6; opacity: .75; }
.mrp-settings-panel footer { border-top: 1px solid var(--mrp-toolbar-border); padding: 10px 16px; }
</style>
