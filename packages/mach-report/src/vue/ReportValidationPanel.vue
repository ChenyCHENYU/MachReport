<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ReportValidationIssue } from "../editing/validation";
import type { RenderPlan } from "../schema/render-plan";
import { resolveValidationPanelMessages, validationPanelText, type ReportValidationPanelMessages } from "./validation-panel-messages";
import { validationIssueKey, validationPanelTargets } from "./validation-panel-targets";
import ReportIcon from "./ReportIcon.vue";
const props = defineProps<{
  issues: readonly ReportValidationIssue[];
  messages?: Partial<ReportValidationPanelMessages>;
  plan?: RenderPlan | null;
  busy?: boolean;
}>();
const emit = defineEmits<{ (event: "locate", issue: ReportValidationIssue): void }>();
const m = computed(() => resolveValidationPanelMessages(props.messages));
const search = ref<HTMLInputElement | null>(null), list = ref<HTMLElement | null>(null), query = ref(""), composing = ref(false);
const severity = ref(""), dataset = ref(""), page = ref(0), pageSize = 100;
const errors = computed(() => props.issues.filter(issue => issue.severity === "error").length);
const targets = computed(() => validationPanelTargets(props.plan, props.issues));
const entries = computed(() => props.issues.map((issue, index) => {
  const key = validationIssueKey(issue), target = key ? targets.value.get(key) : undefined;
  const field = target?.label ?? issue.field;
  return { issue, index, field, locatable: !!target && !target.ambiguous,
    text: [issue.message, issue.ruleId, issue.dataset, issue.sourceScope, issue.rowKey, issue.field, field].filter(value => value !== undefined).join(" ").toLocaleLowerCase() };
}));
const datasets = computed(() => [...new Set(props.issues.map(issue => issue.dataset).filter((value): value is string => value !== undefined && value !== ""))]);
const matches = computed(() => {
  const terms = query.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return entries.value.filter(entry => (!severity.value || entry.issue.severity === severity.value) && (!dataset.value || entry.issue.dataset === dataset.value) && terms.every(term => entry.text.includes(term)));
});
const pages = computed(() => Math.max(1, Math.ceil(matches.value.length / pageSize)));
const visible = computed(() => matches.value.slice(page.value * pageSize, (page.value + 1) * pageSize));
const filtered = computed(() => !!query.value || !!severity.value || !!dataset.value);
const resultText = computed(() => validationPanelText(m.value.results, { matched: matches.value.length, total: props.issues.length }));
const rangeText = computed(() => validationPanelText(m.value.range, { start: matches.value.length ? page.value * pageSize + 1 : 0, end: Math.min((page.value + 1) * pageSize, matches.value.length), count: matches.value.length }));
const pageText = computed(() => validationPanelText(m.value.page, { page: page.value + 1, pages: pages.value }));
watch([query, severity, dataset], () => { page.value = 0; });
watch(pages, count => { page.value = Math.min(page.value, count - 1); });
watch(datasets, values => { if (dataset.value && !values.includes(dataset.value)) dataset.value = ""; });
watch(page, () => { if (list.value) list.value.scrollTop = 0; }, { flush: "post" });
function input(event: Event): void { if (!composing.value && !(event as InputEvent).isComposing) query.value = (event.target as HTMLInputElement).value; }
function finishInput(event: CompositionEvent): void { composing.value = false; query.value = (event.target as HTMLInputElement).value; }
function clear(): void { query.value = ""; severity.value = ""; dataset.value = ""; if (search.value) { search.value.value = ""; search.value.focus(); } }
function keydown(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229 || composing.value) { event.stopPropagation(); return; }
  if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); }
  if (event.key === "Escape" && filtered.value) { event.preventDefault(); event.stopPropagation(); clear(); }
}
function locate(entry: typeof entries.value[number]): void { if (!props.busy && entry.locatable) emit("locate", entry.issue); }
function caption(issue: ReportValidationIssue, field?: string): string {
  return [issue.dataset, issue.rowKey ?? (issue.rowIndex === undefined ? m.value.dataset : `${m.value.row} ${issue.rowIndex + 1}`), field].filter(value => value !== undefined && value !== "").join(" · ");
}
</script>
<template>
  <section class="mr-validation" :aria-label="m.title" :aria-busy="!!busy">
    <details open>
      <summary><strong>{{ m.title }}</strong><span class="mr-validation__count" :class="{ 'is-error': errors }">{{ errors }} {{ m.error }} · {{ issues.length - errors }} {{ m.warning }}</span></summary>
      <div v-if="issues.length || filtered" class="mr-validation__filters">
        <label class="mr-validation__search"><ReportIcon name="search" :size="14" /><input ref="search" type="search" :value="query" :aria-label="m.search" :placeholder="m.searchPlaceholder" @input="input" @compositionstart="composing = true" @compositionend="finishInput" @keydown="keydown" /></label>
        <label><span>{{ m.severity }}</span><select v-model="severity" :aria-label="m.severity"><option value="">{{ m.allSeverities }}</option><option value="error">{{ m.error }}</option><option value="warning">{{ m.warning }}</option></select></label>
        <label v-if="datasets.length > 1 || dataset"><span>{{ m.datasetFilter }}</span><select v-model="dataset" :aria-label="m.datasetFilter"><option value="">{{ m.allDatasets }}</option><option v-for="value in datasets" :key="value" :value="value">{{ value }}</option></select></label>
        <button v-if="filtered" type="button" class="mr-validation__clear" @click="clear">{{ m.clear }}</button>
      </div>
      <p v-if="busy" class="mr-validation__loading" role="status">{{ m.loading }}</p>
      <ul v-if="visible.length" ref="list">
        <li v-for="entry in visible" :key="entry.index" :class="{ 'is-error': entry.issue.severity === 'error' }">
          <span class="mr-validation__badge">{{ entry.issue.severity === 'error' ? m.error : m.warning }}</span>
          <div><strong>{{ entry.issue.message }}</strong><small>{{ caption(entry.issue, entry.field) }}</small></div>
          <button v-if="validationIssueKey(entry.issue)" type="button" :disabled="busy || !entry.locatable" :title="entry.locatable ? undefined : m.unavailable" :aria-label="`${m.locate} ${caption(entry.issue, entry.field)}`" @click="locate(entry)">{{ m.locate }}<ReportIcon name="external" :size="12" /></button>
        </li>
      </ul>
      <p v-else-if="!busy" class="mr-validation__empty" role="status">{{ issues.length ? m.noMatches : m.empty }}</p>
      <div class="mr-validation__footer"><span role="status">{{ resultText }}<span v-if="matches.length"> · {{ rangeText }}</span></span><nav v-if="pages > 1" :aria-label="m.title"><button type="button" :aria-label="m.previous" :disabled="page === 0" @click="page--"><ReportIcon name="chevron-left" :size="14" /></button><span>{{ pageText }}</span><button type="button" :aria-label="m.next" :disabled="page + 1 === pages" @click="page++"><ReportIcon name="chevron-right" :size="14" /></button></nav></div>
    </details>
  </section>
</template>
<style scoped>
.mr-validation{font:inherit;font-size:12px;color:var(--mrp-toolbar-fg,#24344c);border:1px solid var(--mrp-toolbar-border,#dbe5f1);border-radius:10px;background:var(--mrp-toolbar-bg,#fff);overflow:hidden}
.mr-validation summary{display:flex;gap:12px;align-items:center;cursor:pointer;padding:11px 14px;background:var(--mrp-btn-hover-bg,#f6f9fd)}
.mr-validation__count{margin-left:auto;font-size:11px;color:var(--mrp-warning-fg,#986007);white-space:nowrap;font-variant-numeric:tabular-nums}.mr-validation__count.is-error{color:var(--mrp-error-fg,#b42318)}
.mr-validation__filters{display:flex;align-items:flex-end;flex-wrap:wrap;gap:8px;padding:12px 14px;border-bottom:1px solid var(--mrp-toolbar-border,#dbe5f1)}
.mr-validation__filters label{display:grid;gap:5px;font-size:10px;color:var(--mrp-toolbar-fg,#24344c)}
.mr-validation__filters .mr-validation__search{display:flex;align-items:center;align-self:flex-end;flex:1;gap:7px;min-width:160px;min-height:31px;padding:0 9px;border:1px solid var(--mrp-btn-border,#dbe5f1);border-radius:7px;background:var(--mrp-toolbar-bg,#fff);color:var(--mrp-btn-fg,#4b6080)}
.mr-validation input,.mr-validation select{box-sizing:border-box;min-height:31px;font:inherit;font-size:12px;color:var(--mrp-toolbar-fg,#24344c);background:var(--mrp-toolbar-bg,#fff)}
.mr-validation input{min-width:0;width:100%;border:0;outline:0}.mr-validation input::placeholder{color:var(--mrp-btn-fg,#4b6080);opacity:.8}.mr-validation select{border:1px solid var(--mrp-btn-border,#dbe5f1);border-radius:7px;padding:4px 25px 4px 8px}
.mr-validation ul{list-style:none;padding:0 14px;margin:0;max-height:320px;overflow:auto;overscroll-behavior:contain}.mr-validation li{display:flex;align-items:center;gap:10px;padding:11px 0;border-top:1px solid var(--mrp-toolbar-border,#dbe5f1)}.mr-validation li:first-child{border:0}.mr-validation li>div{flex:1;min-width:0;overflow-wrap:anywhere}.mr-validation strong{font-weight:600;font-size:12px;line-height:1.5}.mr-validation small{display:block;font-size:11px;color:var(--mrp-btn-fg,#4b6080);margin-top:3px;line-height:1.5}
.mr-validation__badge{font-size:10px;padding:3px 6px;border-radius:5px;background:var(--mrp-btn-hover-bg,#f6f9fd);background:color-mix(in srgb,var(--mrp-warning-fg,#986007) 9%,var(--mrp-toolbar-bg,#fff));color:var(--mrp-warning-fg,#986007);white-space:nowrap}.is-error>.mr-validation__badge{background:var(--mrp-btn-hover-bg,#f6f9fd);background:color-mix(in srgb,var(--mrp-error-fg,#b42318) 9%,var(--mrp-toolbar-bg,#fff));color:var(--mrp-error-fg,#b42318)}
.mr-validation button{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-height:28px;font:inherit;font-size:11px;color:var(--mrp-btn-fg,#4b6080);border:1px solid var(--mrp-btn-border,#dbe5f1);border-radius:6px;padding:4px 8px;background:var(--mrp-toolbar-bg,#fff);cursor:pointer}.mr-validation button:hover:not(:disabled){color:var(--mrp-btn-hover-fg,#24344c);background:var(--mrp-btn-hover-bg,#f6f9fd)}.mr-validation button:disabled{opacity:.5;cursor:not-allowed}.mr-validation button:focus-visible,.mr-validation select:focus-visible,.mr-validation summary:focus-visible,.mr-validation__search:focus-within{outline:2px solid var(--mrp-btn-active-bg,#2964da);outline-offset:2px}
.mr-validation__empty{margin:14px;padding:24px 12px;text-align:center;border:1px dashed var(--mrp-toolbar-border,#dbe5f1);border-radius:8px;color:var(--mrp-btn-fg,#4b6080)}.mr-validation__loading{margin:10px 14px;color:var(--mrp-btn-fg,#4b6080)}
.mr-validation__footer{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;padding:10px 14px;border-top:1px solid var(--mrp-toolbar-border,#dbe5f1);font-size:11px;color:var(--mrp-btn-fg,#4b6080);font-variant-numeric:tabular-nums}.mr-validation nav{display:flex;align-items:center;gap:8px;margin-left:auto}.mr-validation nav button{padding:3px;min-width:28px}
@media(max-width:480px){.mr-validation summary{flex-wrap:wrap;gap:5px}.mr-validation__count{margin-left:0}.mr-validation__filters .mr-validation__search{flex-basis:100%;min-height:33px}}
</style>
