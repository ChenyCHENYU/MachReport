<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ReportCellValue } from "../editing/context";
import type { ReportDataReviewMessages, ReportReviewRow } from "./data-review";
const props = defineProps<{ count: number; row(index: number): ReportReviewRow; messages: ReportDataReviewMessages; delta?: boolean }>();
const emit = defineEmits<{ locate: [index: number] }>();
const page = ref(0), pageSize = 50;
const pages = computed(() => Math.max(1, Math.ceil(props.count / pageSize)));
const rows = computed(() => Array.from({ length: Math.min(pageSize, Math.max(0, props.count - page.value * pageSize)) }, (_, offset) => { const index = page.value * pageSize + offset; return { index, ...props.row(index) }; }));
function display(value: ReportCellValue | undefined): string { return value === undefined || value === null || value === "" ? "—" : String(value); }
watch(() => props.count, () => { page.value = Math.min(page.value, pages.value - 1); });
</script>
<template>
  <div v-if="count" class="mrp-review-results">
    <div class="mrp-review-scroll"><table><thead><tr><th>{{ messages.reviewKey }}</th><th>{{ messages.reviewField }}</th><th>{{ messages.reviewBefore }}</th><th>{{ messages.reviewAfter }}</th><th v-if="delta">{{ messages.reviewDelta }}</th><th v-if="delta">{{ messages.reviewRatio }}</th><th><span class="mrp-review-sr">{{ messages.reviewLocate }}</span></th></tr></thead><tbody><tr v-for="item in rows" :key="item.index"><th scope="row">{{ item.rowKey }}</th><td>{{ item.label }}</td><td class="mrp-review-value">{{ display(item.before) }}</td><td class="mrp-review-value">{{ display(item.after) }}</td><td v-if="delta" class="mrp-review-value">{{ item.delta ?? '—' }}</td><td v-if="delta" class="mrp-review-value">{{ item.ratio ?? '—' }}</td><td class="mrp-review-status"><button v-if="item.locatable" type="button" :aria-label="`${messages.reviewLocate}: ${item.rowKey} · ${item.label}`" @click="emit('locate', item.index)">{{ messages.reviewLocate }}</button><span v-else :data-tone="item.tone">{{ item.status }}</span></td></tr></tbody></table></div>
    <nav v-if="pages > 1" class="mrp-review-pagination" :aria-label="messages.reviewPage"><button type="button" :disabled="page === 0" :aria-label="messages.reviewPrevious" @click="page--">‹</button><span>{{ page + 1 }} / {{ pages }}</span><button type="button" :disabled="page + 1 >= pages" :aria-label="messages.reviewNext" @click="page++">›</button></nav>
  </div>
  <p v-else class="mrp-review-empty" role="status">{{ messages.reviewEmpty }}</p>
</template>
<style src="./data-review.css"></style>
