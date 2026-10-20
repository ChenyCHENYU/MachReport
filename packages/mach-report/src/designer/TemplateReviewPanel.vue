<script setup lang="ts">
import { computed } from "vue";
import type { ReportTemplateReviewIssue } from "@agile-team/mach-report";
import { useTemplateReview, type TemplateReviewOptions } from "./useTemplateReview";
import { TEMPLATE_REVIEW_MESSAGES, type TemplateReviewMessages } from "./review-messages";
const props = defineProps<TemplateReviewOptions & { messages?: Partial<TemplateReviewMessages> }>();
const emit = defineEmits<{ (event: "locate", value: Pick<ReportTemplateReviewIssue, "path" | "pageIndex" | "componentIndex" | "field">): void }>();
const m = computed(() => ({ ...TEMPLATE_REVIEW_MESSAGES, ...props.messages }));
const { report, sampleSize, acknowledged, running, stale, failure, checkedScope, errors, run } = useTemplateReview(props);
function locate(path: string): void {
  const match = /\.pages\[(\d+)\]\.components\[(\d+)\]/.exec(path);
  emit("locate", { path, ...(match ? { pageIndex: Number(match[1]), componentIndex: Number(match[2]) } : {}) });
}
</script>
<template>
  <section class="mr-template-review" :aria-label="m.title" :aria-busy="running">
    <header><strong>{{ m.title }}</strong><button type="button" :disabled="running" @click="run">{{ running ? m.running : m.run }}</button></header>
    <div class="mr-review-controls"><label>{{ m.samples }}<select v-model="sampleSize" :aria-label="m.samples" :disabled="running"><option value="0">{{ m.none }}</option><option value="20">{{ m.first20 }}</option><option value="100">{{ m.first100 }}</option><option value="-1">{{ m.all }}</option></select></label></div>
    <p v-if="failure" class="is-error" role="alert">{{ failure }}</p><p v-if="stale" class="mr-review-stale" role="status">{{ m.stale }}</p><p v-if="!report" class="mr-review-note">{{ m.empty }}</p>
    <template v-else>
      <div v-if="!stale" class="mr-review-summary" role="status"><span :class="{ 'is-error': errors }">{{ errors }} {{ m.errors }}</span><span>{{ report.issues.length - errors }} {{ m.warnings }}</span></div>
      <section>
<h3>{{ m.changes }} <small>{{ report.changes?.totalChanges ?? 0 }}</small></h3><p v-if="!previous" class="mr-review-note">{{ m.baseline }}</p><p v-else-if="!report.changes?.totalChanges" class="mr-review-note">{{ m.noChanges }}</p>
        <ol v-else class="mr-review-list"><li v-for="(change, index) in report.changes?.changes" :key="index"><div><span>{{ m.categories[change.category] }} · {{ m.kinds[change.kind] }}</span><b v-if="change.breaking">{{ m.breaking }}</b><button type="button" @click="locate(change.path)">{{ m.locate }}</button></div><code>{{ change.path }}</code><dl><template v-if="change.before !== undefined"><dt>{{ m.before }}</dt><dd>{{ change.before }}</dd></template><template v-if="change.after !== undefined"><dt>{{ m.after }}</dt><dd>{{ change.after }}</dd></template></dl></li></ol>
        <p v-if="report.changes?.truncated" class="mr-review-note">{{ m.truncated }}</p><label v-if="report.changes?.breakingChanges" class="mr-review-ack"><input v-model="acknowledged" type="checkbox" />{{ m.acknowledge }}</label>
      </section>
      <section><h3>{{ m.issues }}</h3><p v-if="!report.issues.length" class="mr-review-note">{{ m.noIssues }}</p><ol v-else class="mr-review-list"><li v-for="(issue, index) in report.issues" :key="index"><div><span :class="{ 'is-error': issue.severity === 'error' }">{{ issue.severity === 'error' ? m.errors : m.warnings }}</span><button type="button" @click="emit('locate', issue)">{{ m.locate }}</button></div><p>{{ issue.message }}</p><code>{{ issue.path }}</code></li></ol></section>
      <section v-if="report.samples.length" :class="{ 'is-stale': stale }"><h3>{{ m.results }}</h3><p v-if="checkedScope" class="mr-review-scope">{{ m.scope }} · {{ checkedScope.requested === "-1" ? m.all : checkedScope.requested === "0" ? m.none : checkedScope.requested + " " + m.rows }} · {{ checkedScope.datasets }} {{ m.datasets }} · {{ checkedScope.rows }} {{ m.rows }}<span v-if="checkedScope.formats.length"> · {{ checkedScope.formats.join(" / ") }}</span></p><p v-for="item in report.samples" :key="item.name">{{ item.name }} · {{ item.rows }} {{ m.rows }} · {{ item.pages }} {{ m.pages }}</p></section>
      <p class="mr-review-note">{{ m.checked }}</p>
    </template>
  </section>
</template>
<style scoped>
.mr-template-review { min-width:0; padding:16px; color:var(--mrp-toolbar-fg,#334155); font:12px/1.5 system-ui,sans-serif; display:grid; grid-template-columns:minmax(0,1fr) minmax(280px,.8fr); gap:14px 20px; align-content:start; }
.mr-review-stale { grid-column:1/-1; margin:0; padding:9px 12px; color:#92400e; background:#fffbeb; border:1px solid #fde68a; border-radius:6px; }.is-stale { opacity:.65; }.mr-review-scope { color:#64748b; font-size:11px; }
.mr-template-review>header,.mr-review-controls,.mr-review-summary,.mr-template-review>.mr-review-note { grid-column:1/-1; }
.mr-template-review header,.mr-review-list li>div { display:flex; align-items:center; gap:8px; }
.mr-template-review header { justify-content:space-between; min-height:30px; }.mr-template-review header strong { font-size:14px; }.mr-template-review header button { background:#2563eb; border-color:#2563eb; color:#fff; }
.mr-template-review button,.mr-template-review select { min-height:28px; border:1px solid var(--mrp-toolbar-border,#e2e8f0); border-radius:5px; background:#fff; color:inherit; font:inherit; }
.mr-template-review button { padding:3px 9px; cursor:pointer; }
.mr-template-review button:disabled { cursor:default; opacity:.55; }
.mr-template-review :is(button,select,input):focus-visible { outline:2px solid #93c5fd; outline-offset:2px; }
.mr-review-controls label { display:flex; align-items:center; flex-wrap:wrap; gap:10px; }.mr-review-controls select { width:min(100%,360px); padding:4px 6px; }
.mr-review-summary { display:flex; gap:8px; color:#1d4ed8; }.mr-review-summary>span { border:1px solid #dbeafe; background:#eff6ff; border-radius:20px; padding:3px 10px; }.mr-review-summary>.is-error { border-color:#fecaca; background:#fef2f2; }.is-error { color:#b91c1c; }
.mr-template-review>section { margin:0; padding:14px; border:1px solid var(--mrp-toolbar-border,#e2e8f0); border-radius:8px; min-width:0; background:#fff; }.mr-template-review>section:nth-of-type(3) { grid-column:1/-1; }.mr-template-review h3 { margin:0 0 10px; font:600 12px/1.5 system-ui,sans-serif; }.mr-template-review h3 small { color:#64748b; font-weight:400; }
.mr-review-note { color:#64748b; }.mr-review-list { margin:0; padding:0; list-style:none; }.mr-review-list li { padding:10px 0; border-bottom:1px solid var(--mrp-toolbar-border,#e2e8f0); }.mr-review-list button { margin-left:auto; }.mr-review-list b { color:#a16207; font-size:11px; font-weight:500; }.mr-review-list code { display:block; overflow-wrap:anywhere; color:#64748b; font-size:10px; }.mr-review-list dl { display:grid; grid-template-columns:44px minmax(0,1fr); gap:3px; margin:6px 0 0; }.mr-review-list dt { color:#64748b; }.mr-review-list dd { margin:0; overflow-wrap:anywhere; }.mr-review-list p { margin:5px 0; }.mr-review-ack { display:flex; align-items:flex-start; gap:5px; margin-top:9px; }
@media(max-width:760px) { .mr-template-review { grid-template-columns:minmax(0,1fr); padding:12px; }.mr-template-review>section { grid-column:1; } }
</style>
