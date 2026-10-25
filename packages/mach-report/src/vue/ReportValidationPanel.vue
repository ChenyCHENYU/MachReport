<script setup lang="ts">
import { computed } from "vue";
import type { ReportValidationIssue } from "../editing/validation";
const props = defineProps<{
  issues: readonly ReportValidationIssue[];
  messages?: Partial<{ title: string; error: string; warning: string; locate: string; dataset: string; row: string; more: string }>;
}>();
const emit = defineEmits<{ (event: "locate", issue: ReportValidationIssue): void }>();
const m = computed(() => ({ title: "数据校验", error: "错误", warning: "提示", locate: "定位", dataset: "全表", row: "行", more: "请缩小范围查看更多问题", ...props.messages }));
const errors = computed(() => props.issues.filter(issue => issue.severity === "error").length);
const visible = computed(() => props.issues.slice(0, 100));
</script>
<template>
  <section v-if="issues.length" class="mr-validation" :aria-label="m.title" aria-live="polite">
    <details open>
      <summary><strong>{{ m.title }}</strong><span class="mr-validation__count" :class="{ 'is-error': errors }">{{ errors }} {{ m.error }} · {{ issues.length - errors }} {{ m.warning }}</span></summary>
      <ul>
        <li v-for="(issue, index) in visible" :key="`${issue.ruleId}:${issue.dataset}:${issue.rowKey}:${index}`" :class="{ 'is-error': issue.severity === 'error' }">
          <span class="mr-validation__badge">{{ issue.severity === 'error' ? m.error : m.warning }}</span>
          <div><strong>{{ issue.message }}</strong><small>{{ [issue.dataset, issue.rowKey ?? (issue.rowIndex === undefined ? m.dataset : `${m.row} ${issue.rowIndex + 1}`), issue.field].filter(value => value !== undefined && value !== '').join(' · ') }}</small></div>
          <button v-if="issue.rowKey !== undefined && issue.field !== undefined && issue.dataset !== undefined" type="button" @click="emit('locate', issue)">{{ m.locate }} ↗</button>
        </li>
      </ul>
      <p v-if="issues.length > visible.length">{{ visible.length }} / {{ issues.length }} · {{ m.more }}</p>
    </details>
  </section>
</template>
<style scoped>
.mr-validation{font:inherit;color:var(--mr-color-text,#24344c);border:1px solid var(--mr-color-border,#dbe5f1);border-radius:10px;background:var(--mr-color-surface,#fff);overflow:hidden}.mr-validation summary{display:flex;gap:12px;align-items:center;cursor:pointer;padding:10px 14px;background:var(--mr-color-subtle,#f6f9fd)}.mr-validation__count{margin-left:auto;font-size:12px;color:#986007}.mr-validation__count.is-error{color:#b42335}.mr-validation ul{list-style:none;padding:0 14px;margin:0;max-height:240px;overflow:auto}.mr-validation li{display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--mr-color-border,#e5edf5)}.mr-validation li:first-child{border:0}.mr-validation li>div{flex:1;min-width:0}.mr-validation strong{font-weight:600;font-size:12px}.mr-validation small{display:block;font-size:11px;color:var(--mr-color-muted,#6b7d94);margin-top:3px}.mr-validation__badge{font-size:10px;padding:3px 6px;border-radius:5px;background:#fff7e8;color:#986007;white-space:nowrap}.is-error>.mr-validation__badge{background:#fff0f2;color:#b42335}.mr-validation button{font:inherit;font-size:11px;color:var(--mr-color-primary,#235bb2);border:1px solid var(--mr-color-border,#dae5f3);border-radius:5px;padding:4px 8px;background:var(--mr-color-surface,#fff);cursor:pointer}.mr-validation button:focus-visible{outline:2px solid var(--mr-color-primary,#235bb2);outline-offset:2px}.mr-validation p{font-size:11px;color:var(--mr-color-muted,#6b7d94);padding:0 14px}
</style>
