<script setup lang="ts">
import type { ReportPrintCalibration } from "./print-options";
import type { MachReportMessages } from "./config";
const props = defineProps<{ value: ReportPrintCalibration; messages: MachReportMessages; busy?: boolean; canTest?: boolean }>();
const emit = defineEmits<{ (event: "change", calibration: ReportPrintCalibration): void; (event: "test"): void }>();
function change(key: keyof ReportPrintCalibration, event: Event): void {
  const input = event.target as HTMLInputElement, value = Number(input.value);
  if (!input.value.trim() || !Number.isFinite(value) || Math.abs(value) > 20) { input.value = String(props.value[key] ?? 0); return; }
  emit("change", { ...props.value, [key]: value });
}
</script>
<template>
  <details class="mrp-print-settings">
    <summary>{{ messages.printCalibration }}</summary>
    <p>{{ messages.printCalibrationHint }}</p>
    <div>
      <label>
        {{ messages.printOffsetX }}
        <input
type="number" min="-20" max="20" step=".1"
          :value="value.offsetXmm ?? 0" :disabled="busy"
          @change="change('offsetXmm', $event)"
/>
      </label>
      <label>
        {{ messages.printOffsetY }}
        <input
type="number" min="-20" max="20" step=".1"
          :value="value.offsetYmm ?? 0" :disabled="busy"
          @change="change('offsetYmm', $event)"
/>
      </label>
    </div>
    <button type="button" :disabled="busy || !canTest" @click="emit('test')">
      {{ messages.printCalibrationTest }}
    </button>
  </details>
</template>
<style scoped>
.mrp-print-settings {
  border:1px solid var(--mrp-btn-border);
  border-radius:9px;
  padding:11px 13px;
  margin:0 0 14px;
  font-size:12px;
  color:var(--mrp-toolbar-fg)
}
summary {
  cursor:pointer;
  font-weight:600
}
.mrp-print-settings p {
  font-size:11px;
  line-height:1.8;
  opacity:.65;
  margin:10px 0
}
.mrp-print-settings>div {
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:12px
}
label {
  display:grid;
  gap:6px;
  font-size:11px
}
input {
  width:100%;
  box-sizing:border-box;
  border:1px solid var(--mrp-btn-border);
  border-radius:6px;
  padding:6px 8px;
  color:inherit;
  background:var(--mrp-toolbar-bg);
  font:inherit
}
button {
  border:1px solid var(--mrp-btn-border);
  border-radius:6px;
  padding:6px 10px;
  margin:12px 0 0;
  color:inherit;
  background:var(--mrp-toolbar-bg);
  font:inherit;
  cursor:pointer
}
button:hover:not(:disabled) {
  background:var(--mrp-btn-hover-bg)
}
button:disabled,input:disabled {
  opacity:.4
}
button:focus-visible,input:focus-visible,summary:focus-visible {
  outline:2px solid var(--mrp-btn-active-bg);
  outline-offset:2px
}

</style>
