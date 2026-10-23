<script setup lang="ts">
import { computed, ref } from "vue";
import type { ReportPreviewDiagnostic, ReportPreviewDataTarget } from "./guards";
import type { MachReportMessages } from "./config";
import type { ReportValueState } from "../source/data-explanation";
import ReportIcon from "./ReportIcon.vue";
const props = defineProps<{ entries: readonly Readonly<ReportPreviewDiagnostic>[]; messages: MachReportMessages; busy?: boolean }>();
const emit = defineEmits<{ (e: "locate", target: ReportPreviewDataTarget): void }>();
const query = ref("");
const labels = computed(() => ({ "missing-source": props.messages.dataMissingSource, "not-applicable": props.messages.dataNotApplicable, "not-calculable": props.messages.dataNotCalculable }));
const matches = computed(() => {
  const terms = query.value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return props.entries.filter(entry => terms.every(term => `${entry.message} ${entry.target?.datasetId} ${entry.target?.rowKey ?? ""} ${entry.target?.field} ${labels.value[entry.valueState as ReportValueState] ?? ""}`.toLocaleLowerCase().includes(term)));
});
const visible = computed(() => matches.value.slice(0, 100));
</script>
<template>
  <details v-if="entries.length" class="mrp-data-explanation">
    <summary>
      <ReportIcon name="file" :size="14" />
      <span>{{ messages.dataExplanation }}</span><b>{{ entries.length }}</b>
      <small>{{ messages.dataExplanationHint }}</small>
      <ReportIcon name="chevron-down" :size="12" />
    </summary>
    <div class="mrp-data-content">
      <label>
        <ReportIcon name="search" :size="15" />
        <input
v-model="query" type="search"
          :aria-label="messages.dataExplanationSearch"
          :placeholder="messages.dataExplanationSearch"
/>
      </label>
      <ul>
        <li v-for="(entry, index) in visible" :key="index">
          <div>
            <span class="mrp-data-state">{{ labels[entry.valueState as ReportValueState] }}</span>
            <code>
              {{ entry.target?.datasetId }} · {{ entry.target?.field }}
              <template v-if="entry.target?.rowKey !== undefined"> · {{ entry.target.rowKey }}</template>
            </code>
            <p>{{ entry.message }}</p>
          </div>
          <button
v-if="entry.target" type="button" :disabled="busy"
            @click="emit('locate', entry.target)"
>
            {{ messages.diagnosticsLocate }}<ReportIcon name="arrow-right" :size="13" />
          </button>
        </li>
      </ul>
      <p v-if="!matches.length" role="status">{{ messages.dataExplanationEmpty }}</p>
      <small v-if="matches.length > visible.length">
        {{ (messages.diagnosticsMore ?? '').replace('{count}', String(matches.length)) }}
      </small>
    </div>
  </details>
</template>
<style scoped>
.mrp-data-explanation {
  flex:none;
  background:var(--mrp-toolbar-bg);
  border-bottom:1px solid var(--mrp-toolbar-border);
  color:var(--mrp-toolbar-fg);
  font-family:inherit;
  font-size:12px;
  line-height:1.5
}

summary {
  display:flex;
  align-items:center;
  gap:8px;
  padding:8px 14px;
  cursor:pointer;
  list-style:none;
  font-size:11px
}
summary::-webkit-details-marker {
  display:none
}
summary>b {
  font-size:10px;
  font-weight:500;
  padding:0 5px;
  border-radius:4px;
  background:var(--mrp-shell-bg)
}
summary>small {
  font-size:10px;
  opacity:.6;
  margin-left:5px
}
summary>svg:last-child {
  margin-left:auto;
  opacity:.55
}
.mrp-data-content {
  padding:2px 14px 12px;
  max-height:260px;
  overflow:auto
}
.mrp-data-content>label {
  display:flex;
  align-items:center;
  gap:7px;
  border:1px solid var(--mrp-btn-border);
  border-radius:7px;
  padding:5px 9px;
  max-width:480px
}
.mrp-data-content input {
  border:0;
  outline:0;
  min-width:0;
  flex:1;
  background:transparent;
  color:inherit;
  font:inherit
}
ul {
  padding:0;
  margin:8px 0;
  list-style:none
}
li {
  display:flex;
  align-items:center;
  gap:12px;
  padding:10px 2px;
  border-bottom:1px solid var(--mrp-toolbar-border)
}
li>div {
  min-width:0;
  flex:1
}
code {
  font:10px ui-monospace,monospace;
  opacity:.6;
  overflow-wrap:anywhere;
  margin-left:8px
}
.mrp-data-state {
  font-size:10px;
  background:var(--mrp-shell-bg);
  border-radius:4px;
  padding:3px 5px;
  color:var(--mrp-btn-hover-fg)
}
li p {
  margin:5px 0 0;
  font-size:12px;
  overflow-wrap:anywhere
}
button {
  display:flex;
  align-items:center;
  gap:5px;
  border:1px solid var(--mrp-btn-border);
  background:transparent;
  color:inherit;
  border-radius:6px;
  padding:5px 9px;
  font-family:inherit;
  font-size:11px;
  cursor:pointer
}
button:hover:not(:disabled) {
  background:var(--mrp-btn-hover-bg)
}
button:disabled {
  opacity:.4
}
button:focus-visible,input:focus-visible,summary:focus-visible {
  outline:2px solid var(--mrp-btn-active-bg);
  outline-offset:2px
}
@media (max-width: 680px) {
  summary>small {
  display:none
}
code {
  display:block;
  margin:5px 0 0
}

}

</style>
