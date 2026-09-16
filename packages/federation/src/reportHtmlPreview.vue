<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import type { PropType } from "vue";
import { inject } from "vue";
import { MACH_REPORT_FETCHER_KEY } from "@mach-report/vue";
import type { PlanFetcher } from "@mach-report/vue";
import { normalizeTempIds } from "@mach-report/vue";
import { renderPlan as renderPlanToDom } from "@mach-report/core";
import { validateRenderPlan } from "@mach-report/core";

const props = defineProps({
  tempId: {
    type: [String, Array] as PropType<string | string[] | null>,
    default: null
  },
  params: {
    type: Object as PropType<Record<string, string>>,
    default: () => ({})
  },
  height: { type: String, default: "100vh" }
});

const emit = defineEmits<{ (e: "loaded", n: number): void; (e: "error", m: string): void }>();

const containerRef = ref<HTMLElement | null>(null);
const errorMessage = ref("");
const fetcher = inject(MACH_REPORT_FETCHER_KEY, null);

async function render(): Promise<void> {
  const el = containerRef.value;
  if (!el) return;
  el.innerHTML = "";
  const ids = normalizeTempIds(props.tempId);
  if (ids.length === 0) {
    errorMessage.value = "缺少报表模板 ID";
    emit("error", errorMessage.value);
    return;
  }
  if (!fetcher) {
    errorMessage.value = "宿主未注入 machReportFetcher";
    emit("error", errorMessage.value);
    return;
  }
  errorMessage.value = "";
  try {
    const plan = await (fetcher as PlanFetcher)({
      tempIds: ids,
      params: { ...props.params }
    });
    const check = validateRenderPlan(plan);
    if (!check.ok) throw new Error(check.errors[0] ? `${check.errors[0].path}: ${check.errors[0].message}` : "校验失败");
    el.appendChild(renderPlanToDom(plan, document));
    emit("loaded", plan.pages.length);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "渲染失败";
    emit("error", errorMessage.value);
  }
}

onMounted(render);
watch(() => [props.tempId, JSON.stringify(props.params)], render);
</script>

<template>
  <div class="mach-report-html-preview" :style="{ height, overflow: 'auto' }">
    <div v-if="errorMessage" class="mrhp-error">{{ errorMessage }}</div>
    <div ref="containerRef" class="mrhp-container" />
  </div>
</template>

<style scoped>
.mach-report-html-preview { background: #fff; }
.mrhp-container { padding: 8px; }
.mrhp-error { padding: 20px; color: #c00; font-size: 13px; }
</style>
