<script setup lang="ts">
import type { ExcelImportResult } from "../xlsx/import-types";
import type { MachReportMessages } from "./config";
defineProps<{ result: Pick<ExcelImportResult, "sheets" | "warnings">; messages: MachReportMessages }>();
</script>
<template>
  <details class="mrp-import-summary">
    <summary>{{ messages.importSummary }} · {{ messages.importPreserved?.replace('{sheets}', String(result.sheets.length)) }} <span v-if="result.warnings.length"> · {{ result.warnings.length }} {{ messages.importWarnings }}</span></summary>
    <p>{{ messages.importReadOnly }}</p><ul><li v-for="sheet in result.sheets" :key="sheet.index">{{ sheet.name }} · {{ sheet.range }} · {{ sheet.rowCount }} × {{ sheet.columnCount }}</li></ul>
    <ul v-if="result.warnings.length"><li v-for="(warning, index) in result.warnings" :key="index">{{ warning }}</li></ul>
  </details>
</template>
<style scoped>.mrp-import-summary{padding:8px 12px;font-size:12px;background:var(--mrp-toolbar-bg);color:var(--mrp-toolbar-fg);border-bottom:1px solid var(--mrp-toolbar-border);max-height:180px;overflow:auto}.mrp-import-summary summary{cursor:pointer}.mrp-import-summary p{opacity:.75}.mrp-import-summary li{margin:4px 0}</style>
