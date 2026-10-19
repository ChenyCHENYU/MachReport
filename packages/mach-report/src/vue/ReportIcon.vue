<script setup lang="ts">
defineProps<{ name: "search" | "close" | "chevron-down" | "chevron-up" | "chevron-left" | "chevron-right" | "download" | "upload" | "print" | "external" | "settings" | "grid" | "fit" | "columns" | "arrow-right" | "file"; size?: number }>();
const paths = {
  search: "m15.5 15.5 4.5 4.5M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z",
  close: "m6 6 12 12M6 18 18 6",
  "chevron-down": "m6 9 6 6 6-6", "chevron-up": "m6 15 6-6 6 6",
  "chevron-left": "m15 6-6 6 6 6", "chevron-right": "m9 6 6 6-6 6",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4", upload: "M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4",
  print: "M7 8V3h10v5M7 17H4V9h16v8h-3M7 14h10v7H7v-7m10-2h.01",
  external: "M14 3h7v7m0-7L10 14M11 3H3v18h18v-8",
  settings: "M3 6h18M3 12h18M3 18h18M8 3v6m8 0v6M9 15v6",
  grid: "M3 3h18v18H3V3m6 0v18m6-18v18M3 9h18M3 15h18",
  fit: "M8 5H3v14h5m8-14h5v14h-5M7 12h10m-7-3-3 3 3 3m4-6 3 3-3 3",
  columns: "M3 4h18v16H3V4m6 0v16m6-16v16M3 9h18", "arrow-right": "M4 12h16m-6-6 6 6-6 6",
  file: "M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8m-8 4h6"
};
</script>
<template>
  <svg :width="size ?? 16" :height="size ?? 16" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><path :d="paths[name]" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" /></svg>
</template>
