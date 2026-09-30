<script setup lang="ts">
import { inject } from "vue";
import type { PropType } from "vue";
import { MACH_REPORT_FETCHER_KEY, ReportPreview as ReportPreviewBase } from "@agile-team/mach-report-vue";

defineProps({
  tempId: {
    type: [String, Array] as PropType<string | string[] | null>,
    default: null
  },
  furnitureTempId: { type: String, default: "" },
  params: {
    type: Object as PropType<Record<string, string>>,
    default: () => ({})
  },
  height: { type: String, default: "100vh" },
  autoLoad: { type: Boolean, default: true },
  showExport: { type: Boolean, default: true },
  showPrint: { type: Boolean, default: true },
  showPdfWindow: { type: Boolean, default: true }
});

defineEmits<{ (e: "loaded", n: number): void; (e: "error", m: string): void }>();

const fetcher = inject(MACH_REPORT_FETCHER_KEY, null);
</script>

<template>
  <ReportPreviewBase
    :temp-id="tempId"
    :furniture-temp-id="furnitureTempId"
    :params="params"
    :height="height"
    :auto-load="autoLoad"
    :show-export="showExport"
    :show-print="showPrint"
    :show-pdf-window="showPdfWindow"
    :fetcher="fetcher"
    @loaded="$emit('loaded', $event)"
    @error="$emit('error', $event)"
  />
</template>
