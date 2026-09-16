<script setup lang="ts">
import { computed } from "vue";
import type { PropType } from "vue";

const props = defineProps({
  src: { type: String, required: true },
  fileType: {
    type: String as PropType<"pdf" | "image" | "office" | "auto">,
    default: "auto"
  },
  height: { type: String, default: "100vh" }
});

const kind = computed<"pdf" | "image" | "office" | "unknown">(() => {
  if (props.fileType !== "auto") return props.fileType === "office" ? "office" : props.fileType;
  const src = props.src.toLowerCase();
  if (src.endsWith(".pdf")) return "pdf";
  if (/\.(png|jpe?g|gif|bmp|webp|svg)$/.test(src)) return "image";
  if (/\.(docx?|xlsx?|pptx?)$/.test(src)) return "office";
  return "unknown";
});
</script>

<template>
  <div class="mach-file-preview" :style="{ height, overflow: 'auto', background: '#525659' }">
    <iframe v-if="kind === 'pdf' || kind === 'office'" :src="src" class="mfp-frame" />
    <img v-else-if="kind === 'image'" :src="src" class="mfp-image" alt="preview" />
    <div v-else class="mfp-unknown">暂不支持的预览类型：{{ src }}</div>
  </div>
</template>

<style scoped>
.mfp-frame { width: 100%; height: 100%; border: 0; background: #fff; }
.mfp-image { display: block; max-width: 100%; margin: 0 auto; }
.mfp-unknown { padding: 40px; color: #ccc; text-align: center; }
</style>
