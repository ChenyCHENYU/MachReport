<script setup lang="ts">
import { computed, ref, watchEffect } from "vue";
import type { DatasetRows, PlanComponent } from "@agile-team/mach-report";
import { createChartResolver } from "../layout/chart-layout";
import { renderComponent } from "../render/dom";

const props = defineProps<{
  component: PlanComponent;
  datasets?: DatasetRows;
  zoom: number;
  sampleLabel: string;
}>();
const root = ref<HTMLElement>();
const sampleLimit = 100;
const sample = computed(() => {
  const component = { ...props.component, leftMm: 0, topMm: 0 };
  if (!component.chartBinding) return { components: [component], scope: "" };
  const dataset = component.chartBinding.dataset;
  const rows = props.datasets?.[dataset] ?? [];
  const selected = rows.slice(0, sampleLimit);
  try {
    const resolve = createChartResolver({ [dataset]: selected }, undefined, 5000);
    return { components: resolve(component), scope: `${props.sampleLabel} · ${selected.length} / ${rows.length}` };
  } catch (cause) {
    return { components: [], scope: "", error: cause instanceof Error ? cause.message : String(cause) };
  }
});
watchEffect(() => {
  const element = root.value;
  if (!element) return;
  const nodes = sample.value.components.map(component => renderComponent(component, 96 * props.zoom, {}, element.ownerDocument));
  element.replaceChildren(...nodes);
});
</script>
<template>
  <div class="mr-canvas-primitive" :title="sample.error || sample.scope">
    <div ref="root" class="mr-canvas-primitive-content mr-canvas-content" aria-hidden="true"></div>
    <small v-if="sample.error" class="mr-canvas-primitive-error" role="status">{{ sample.error }}</small>
    <small v-else-if="sample.scope" class="mr-canvas-primitive-sample">{{ sample.scope }}</small>
  </div>
</template>
<style scoped>
.mr-canvas-primitive,.mr-canvas-primitive-content{position:absolute;inset:0;pointer-events:none}.mr-canvas-primitive-content{overflow:hidden}.mr-canvas-primitive-sample{position:absolute;right:0;top:-16px;padding:1px 4px;background:#f1f5f9;color:#64748b;font-size:9px;border-radius:3px;white-space:nowrap}.mr-canvas-primitive-error{display:block;padding:6px;color:#a45b35;background:#fff9f2;font-size:10px;overflow-wrap:anywhere}
</style>
