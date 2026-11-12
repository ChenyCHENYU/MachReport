<script setup lang="ts">
import type { ExcelImportResult, ExcelImportDiagnostic } from "../xlsx/import-types";
import type { MachReportMessages } from "./config";
defineProps<{ result: Pick<ExcelImportResult, "sheets" | "warnings" | "diagnostics" | "diagnosticSummary">; messages: MachReportMessages }>();
defineEmits<{ (event: "locate", entry: ExcelImportDiagnostic): void }>();
</script>
<template>
  <details class="mrp-import-summary">
    <summary>{{ messages.importSummary }} · {{ messages.importPreserved?.replace('{sheets}', String(result.sheets.length)) }} <span v-if="result.warnings.length || result.diagnosticSummary?.total"> · {{ result.diagnosticSummary?.total ?? result.warnings.length }} {{ messages.importWarnings }}</span></summary>
    <p>{{ messages.importReadOnly }}</p><ul><li v-for="sheet in result.sheets" :key="sheet.index">{{ sheet.name }} · {{ sheet.range }} · {{ sheet.rowCount }} × {{ sheet.columnCount }}</li></ul>
    <ul v-if="result.diagnostics?.length"><li v-for="(entry, index) in result.diagnostics" :key="index"><button v-if="entry.sheet" type="button" @click="$emit('locate', entry)"><span>{{ entry.sheet }}<template v-if="entry.cell || entry.range"> · {{ entry.cell ?? entry.range }}</template></span>{{ entry.message }}</button><template v-else>{{ entry.message }}</template></li></ul>
    <ul v-else-if="result.warnings.length"><li v-for="(warning, index) in result.warnings" :key="index">{{ warning }}</li></ul>
    <p v-if="result.diagnosticSummary?.omitted">{{ messages.importOmitted?.replace('{count}', String(result.diagnosticSummary.omitted)) }}</p>
  </details>
</template>
<style scoped>.mrp-import-summary{padding:8px 12px;font-size:12px;background:var(--mrp-toolbar-bg);color:var(--mrp-toolbar-fg);border-bottom:1px solid var(--mrp-toolbar-border);max-height:180px;overflow:auto}.mrp-import-summary summary{cursor:pointer}.mrp-import-summary p{opacity:.75}.mrp-import-summary li{margin:4px 0}.mrp-import-summary button{display:flex;gap:8px;padding:4px 6px;border:0;border-radius:5px;background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer}.mrp-import-summary button span{color:var(--mrp-btn-active-bg);white-space:nowrap}.mrp-import-summary button:hover{background:var(--mrp-btn-hover-bg)}.mrp-import-summary button:focus-visible{outline:2px solid var(--mrp-btn-active-bg)}</style>
