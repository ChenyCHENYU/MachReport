<script setup lang="ts">
defineProps<{ title: string; description?: string }>();
</script>

<template>
  <div class="mrp-empty" role="status">
    <svg class="mrp-empty-art" viewBox="0 0 160 112" fill="none" aria-hidden="true">
      <ellipse cx="80" cy="100" rx="54" ry="7" fill="currentColor" opacity=".05" />
      <rect x="34" y="15" width="92" height="78" rx="9" fill="currentColor" opacity=".04" />
      <rect x="42" y="9" width="76" height="78" rx="7" fill="var(--mrp-toolbar-bg, #fff)" stroke="currentColor" stroke-opacity=".2" stroke-width="1.5" />
      <path d="M55 27H105M55 42H105M55 57H85M55 72H76M71 27V72M89 27V57" stroke="currentColor" stroke-opacity=".15" stroke-width="1.5" stroke-linecap="round" />
      <circle cx="112" cy="76" r="16" fill="var(--mrp-toolbar-bg, #fff)" stroke="currentColor" stroke-opacity=".35" stroke-width="2" />
      <path d="M124 88L137 101M106 76H118" stroke="currentColor" stroke-opacity=".45" stroke-width="3" stroke-linecap="round" />
      <circle cx="27" cy="38" r="3" fill="currentColor" opacity=".12" /><circle cx="132" cy="24" r="2" fill="currentColor" opacity=".2" />
    </svg>
    <strong>{{ title }}</strong><p v-if="description">{{ description }}</p>
  </div>
</template>

<style scoped>
.mrp-empty { box-sizing: border-box; position: sticky; left: max(0px, calc((100% - 560px) / 2)); width: min(560px, 100%); margin: 22px auto; padding: 20px 24px 26px; text-align: center; color: var(--mrp-toolbar-fg, #526078); border: 1px dashed var(--mrp-toolbar-border, #dfe5ed); border-radius: 12px; background: var(--mrp-toolbar-bg, #fff); }
.mrp-empty-art { display: block; width: 144px; height: 101px; margin: 0 auto 10px; }
.mrp-empty strong { display: block; font-size: 14px; font-weight: 600; }
.mrp-empty p { font-size: 12px; line-height: 1.7; opacity: .7; margin: 8px 0 0; overflow-wrap: anywhere; }
</style>
