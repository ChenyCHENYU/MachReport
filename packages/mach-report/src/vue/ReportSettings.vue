<script setup lang="ts">
import { computed, getCurrentInstance, onMounted, onUnmounted, ref } from "vue";
import type { MachReportMessages } from "./config";
import type { ReportInteractionOptions, ReportPreviewPreferences, ReportPreviewTool } from "./tools";

const props = defineProps<{
  available: ReportPreviewPreferences;
  enabled: ReportPreviewPreferences;
  messages: MachReportMessages;
  persistedEditing: boolean;
  busy?: boolean;
  interaction?: ReportInteractionOptions;
  section?: "general" | "tools" | "advanced";
}>();
const emit = defineEmits<{
  (e: "change", key: ReportPreviewTool, enabled: boolean): void;
  (e: "reset"): void;
  (e: "close"): void;
  (e: "interaction", value: ReportInteractionOptions): void;
  (e: "section", value: "general" | "tools" | "advanced"): void;
}>();
const panel = ref<HTMLElement | null>(null);
const section = computed(() => props.section ?? "general");
const id = "mrp-settings-" + getCurrentInstance()?.uid;
const tabs = computed(() => [
  { key: "general" as const, label: props.messages.settingsGeneral ?? "常规" },
  { key: "tools" as const, label: props.messages.settingsTools ?? "工具" },
  { key: "advanced" as const, label: props.messages.settingsAdvanced ?? "高级" }
]);
function navigateTabs(event: KeyboardEvent, index: number): void {
  const steps: Record<string, number> = { ArrowRight: (index + 1) % 3, ArrowLeft: (index + 2) % 3, Home: 0, End: 2 };
  const target = steps[event.key];
  if (target === undefined) return;
  event.preventDefault(); emit("section", tabs.value[target]!.key);
  panel.value?.querySelector<HTMLElement>("#" + id + "-tab-" + tabs.value[target]!.key)?.focus();
}
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

function ownsKeyboard(event: KeyboardEvent): boolean {
  if (!panel.value || event.defaultPrevented) return false;
  if (event.target instanceof Node && panel.value.contains(event.target)) return true;
  // Safari may leave focus on body after a clicked/temporarily disabled control.
  // An unrelated or nested modal must still own its own Escape/Tab handling.
  if (event.target instanceof Element && event.target.closest('[role="dialog"],dialog[open]')) return false;
  return !Array.from(document.querySelectorAll('[aria-modal="true"],dialog[open]')).some((dialog) => dialog !== panel.value && !panel.value!.contains(dialog));
}
function onKeydown(event: KeyboardEvent): void {
  if (!ownsKeyboard(event)) return;
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); emit("close"); return; }
  if (event.key !== "Tab") return;
  const elements = Array.from(panel.value?.querySelectorAll<HTMLElement>("a[href],button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex='0']") ?? []).filter((element) => !element.closest("[hidden]") && element.tabIndex !== -1);
  const first = elements?.[0];
  const last = elements?.[elements.length - 1];
  const outside = !panel.value?.contains(document.activeElement);
  if (outside || event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) {
    event.preventDefault(); event.stopPropagation(); (event.shiftKey ? last : first)?.focus();
  }
}

onMounted(() => {
  const opener = panel.value?.closest(".mach-report-preview")?.querySelector<HTMLElement>(".mrp-settings-toggle");
  const active = document.activeElement;
  previousFocus = active instanceof HTMLElement && active !== document.body && !panel.value?.contains(active) ? active : opener ?? null;
  closeButton.value?.focus();
  document.addEventListener("keydown", onKeydown);
});
onUnmounted(() => {
  document.removeEventListener("keydown", onKeydown);
  if (previousFocus?.isConnected) previousFocus.focus();
});
</script>

<template>
  <div class="mrp-settings-backdrop" @click.self="$emit('close')">
    <section ref="panel" class="mrp-settings-panel" role="dialog" aria-modal="true" :aria-label="messages.settings">
      <header class="mrp-settings-header">
        <div><span class="mrp-settings-eyebrow">MACH REPORT</span><strong>{{ messages.settings }}</strong><p>{{ messages.settingsLocal }}</p></div>
        <button ref="closeButton" class="mrp-settings-close" type="button" :aria-label="messages.settingsClose" @click="$emit('close')"><svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg></button>
      </header>
      <div class="mrp-settings-tabs" role="tablist" :aria-label="messages.settings">
        <button v-for="(tab, index) in tabs" :id="id + '-tab-' + tab.key" :key="tab.key" type="button" role="tab" :aria-selected="section === tab.key" :aria-controls="id + '-panel-' + tab.key" :tabindex="section === tab.key ? 0 : -1" @click="$emit('section', tab.key)" @keydown="navigateTabs($event, index)">{{ tab.label }}</button>
      </div>
      <div class="mrp-settings-content">
        <section :id="id + '-panel-general'" role="tabpanel" :aria-labelledby="id + '-tab-general'" :hidden="section !== 'general'">
          <slot />
          <fieldset v-if="interaction">
            <legend>{{ messages.settingsPanes }}</legend>
            <label class="mrp-settings-option"><span>{{ messages.freezeHeaders }}</span><input type="checkbox" :checked="interaction.freezeHeaders" :disabled="busy" @change="$emit('interaction', { freezeHeaders: ($event.target as HTMLInputElement).checked })" /></label>
            <label class="mrp-settings-option"><span>{{ messages.frozenColumns }}</span><input class="mrp-frozen-count" type="number" min="0" max="20" :value="interaction.frozenColumns ?? 0" :disabled="busy" @change="$emit('interaction', { frozenColumns: Math.max(0, Math.min(20, Number(($event.target as HTMLInputElement).value) || 0)) })" /></label>
          </fieldset>
        </section>
        <section :id="id + '-panel-tools'" role="tabpanel" :aria-labelledby="id + '-tab-tools'" :hidden="section !== 'tools'">
          <fieldset v-for="group in groups" :key="group.label">
            <legend>{{ group.label }}</legend>
            <label v-for="tool in group.tools" :key="tool.key" class="mrp-settings-option" :class="{ 'mrp-settings-unavailable': !available[tool.key] }">
              <span>{{ tool.label }}<small v-if="!available[tool.key]">{{ messages.settingsUnavailable }}</small></span>
              <input type="checkbox" :checked="enabled[tool.key]" :disabled="busy || !available[tool.key]" @change="onChange($event, tool.key)" />
            </label>
          </fieldset>
          <p v-if="available.editing" class="mrp-settings-note">{{ persistedEditing ? messages.editingSaved : messages.editingLocal }}</p>
          <p v-if="available.import" class="mrp-settings-note">{{ messages.importLocal }}</p>
        </section>
        <section :id="id + '-panel-advanced'" role="tabpanel" :aria-labelledby="id + '-tab-advanced'" :hidden="section !== 'advanced'">
          <p class="mrp-settings-intro">{{ messages.settingsAdvancedDescription }}</p>
          <label class="mrp-settings-option mrp-settings-feature"><span>{{ messages.settingsCalculations }}<small :id="id + '-calculation-description'">{{ messages.settingsCalculationsDescription }}</small></span><input type="checkbox" :aria-label="messages.settingsCalculations" :aria-describedby="id + '-calculation-description'" :checked="interaction?.calculations === true" :disabled="busy" @change="$emit('interaction', { calculations: ($event.target as HTMLInputElement).checked })" /></label>
          <slot v-if="interaction?.calculations" name="advanced" />
        </section>
      </div>
      <footer><button type="button" :disabled="busy" @click="$emit('reset')">{{ messages.settingsReset }}</button><span>{{ messages.settingsLocal }}</span></footer>
    </section>
  </div>
</template>
<style scoped src="./settings.css"></style>
