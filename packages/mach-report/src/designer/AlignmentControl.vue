<script setup lang="ts">
import { nextTick } from "vue";

type Alignment = "auto" | "left" | "center" | "right" | "justify";
const props = defineProps<{
  modelValue: string;
  label: string;
  labels: Record<Alignment, string>;
  autoLabel: string;
  allowAuto?: boolean;
}>();
const emit = defineEmits<{
  (event: "update:modelValue", value: Alignment): void;
}>();
const options = (): Alignment[] =>
  props.allowAuto
    ? ["auto", "left", "center", "right", "justify"]
    : ["left", "center", "right", "justify"];
async function navigate(
  event: KeyboardEvent,
  current: Alignment,
): Promise<void> {
  const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
  if (!keys.includes(event.key)) return;
  event.preventDefault();
  const values = options(),
    index = values.indexOf(current);
  const target =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? values.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + values.length) %
          values.length;
  emit("update:modelValue", values[target]!);
  const group = (event.currentTarget as HTMLElement).parentElement;
  await nextTick();
  group
    ?.querySelector<HTMLButtonElement>(`[data-align="${values[target]}"]`)
    ?.focus();
}
</script>

<template>
  <div class="mr-designer-alignment" role="radiogroup" :aria-label="label">
    <button
      v-for="option in options()"
      :key="option"
      type="button"
      role="radio"
      :data-align="option"
      :aria-label="labels[option]"
      :title="labels[option]"
      :aria-checked="modelValue === option"
      :tabindex="modelValue === option ? 0 : -1"
      @click="emit('update:modelValue', option)"
      @keydown="navigate($event, option)"
    >
      <span v-if="option === 'auto'">{{ autoLabel }}</span>
      <svg v-else viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path v-if="option === 'left'" d="M3 4h14M3 8h9M3 12h14M3 16h9" />
        <path
          v-else-if="option === 'center'"
          d="M3 4h14M6 8h8M3 12h14M6 16h8"
        />
        <path v-else-if="option === 'right'" d="M3 4h14M8 8h9M3 12h14M8 16h9" />
        <path v-else d="M3 4h14M3 8h14M3 12h14M3 16h14" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.mr-designer-alignment {
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--mrp-toolbar-border, #dbe3ec);
  border-radius: 5px;
  background: var(--mrp-toolbar-bg, #fff);
}
.mr-designer-alignment button {
  flex: 1;
  min-width: 0;
  height: 24px;
  padding: 3px 5px;
  border: 0;
  border-radius: 3px;
  background: transparent;
  margin: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.mr-designer-alignment button:disabled {
  cursor: default;
  opacity: 0.45;
}
.mr-designer-alignment button:focus-visible {
  outline: 2px solid var(--mrp-btn-active-bg, #2563eb);
  outline-offset: 1px;
}
.mr-designer-alignment button[aria-checked="true"] {
  color: var(--mrp-btn-hover-fg, #1d4ed8);
  background: var(--mrp-btn-hover-bg, #eff6ff);
}
.mr-designer-alignment svg {
  width: 15px;
  height: 15px;
  stroke: currentColor;
  stroke-width: 1.4;
  stroke-linecap: round;
}
.mr-designer-alignment span {
  font-size: 11px;
  white-space: nowrap;
}
</style>
