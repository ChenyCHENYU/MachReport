<script setup lang="ts">
import { computed, ref } from "vue";
import { ReportPreview, createReportSource, createTableTemplate, defineReportTemplate, parseReportTemplate, parseReportParamSelection, parseReportNumberRange, parseReportCascaderPath, validateReportDataset, assertReportValidation, provideMachReportConfig, type ReportValidationRule, type ReportDataRecord, type ReportEditingOptions, type ReportPrefillReviewOptions, type ReportDataComparisonReviewOptions } from "@agile-team/mach-report/vue";
import { ReportTemplateEditor } from "@agile-team/mach-report/designer";

interface ProductionRow { id: string; shift: string; input: number; output: number; note: string }
let stored: ProductionRow[] = [
  { id: "EAF-001", shift: "甲班", input: 120, output: 112.4, note: "" },
  { id: "EAF-002", shift: "乙班", input: 98, output: 0, note: "" },
  { id: "EAF-003", shift: "甲班", input: 115, output: 108.2, note: "已复核" },
];
const mode = ref("report"), saved = ref(0), revision = ref(1), latestParams = ref<Record<string, string>>({});
const template = createTableTemplate({ title: "生产实绩与填报核对", layout: "wide", columns: [
  { field: "id", header: "炉号", semanticRole: "identifier", editable: false, widthMm: 30 },
  { field: "shift", header: "班别", semanticRole: "dimension", editable: false, widthMm: 25 },
  { field: "input", header: "投料重（t）", format: { kind: "number", digits: 1 }, editable: false, widthMm: 30 },
  { field: "output", header: "出钢重（t）", format: { kind: "number", digits: 1 }, valueType: "number", editable: true, widthMm: 30, visual: { kind: "dataBar" } },
  { field: "yield", header: "收得率", format: { kind: "percent", digits: 2 }, editable: false, widthMm: 28, visual: { kind: "colorScale", min: 0, max: 1 } },
  { field: "note", header: "复核说明", semanticRole: "text", editable: true, widthMm: 50 },
], params: [
  { field: "plants", label: "厂别", type: "multiSelect", required: true, defaultValue: '["YTS0"]', options: [{ value: "YTS0", label: "烟台炼钢厂" }, { value: "YTS1", label: "二厂" }] },
  { field: "area", label: "区域", type: "cascader", defaultValue: '["YT","EAF"]', options: [{ value: "YT", label: "烟台", children: [{ value: "EAF", label: "电炉" }, { value: "AOD", label: "精炼" }] }] },
  { field: "range", label: "投料范围", type: "numberRange", min: 0, defaultValue: "[0,200]" },
], listOptions: { rowKey: "id", computed: [{ field: "yield", expression: { op: "if", condition: { field: "input", op: ">", value: 0 }, args: [{ op: "divide", args: [{ field: "output" }, { field: "input" }] }, { value: null }] } }] } });
template.pages[0]!.components.push({ kind: "chart", leftMm: 10, topMm: 60, widthMm: 180, heightMm: 48, chartBinding: { dataset: "detail", categoryField: "shift", type: "bar", title: "班别实绩 · 同源聚合", measures: [{ field: "input", op: "sum", label: "投料重", color: "#94b8e5" }, { field: "output", op: "sum", label: "出钢重", color: "#1d4ed8" }] } });
const document = ref(defineReportTemplate({ id: "production-tools", name: "生产实绩与填报核对", template }));
const schemas = { detail: { rowKey: "id", fields: [{ field: "id", label: "炉号", type: "text" as const }, { field: "shift", label: "班别", type: "text" as const }, { field: "input", label: "投料重", type: "number" as const }, { field: "output", label: "出钢重", type: "number" as const }, { field: "note", label: "复核说明", type: "text" as const }] } };
const reports = { production: { sourceScope: "production", template: () => parseReportTemplate(document.value).template, dataSchema: schemas, load: ({ params }: { params: Record<string, string> }) => {
  latestParams.value = { ...params };
  const plants = parseReportParamSelection(params.plants), range = parseReportNumberRange(params.range), area = parseReportCascaderPath(params.area);
  const available = plants?.includes("YTS0") && area?.at(-1) === "EAF";
  return { detail: available ? stored.filter(row => !range || row.input >= range[0] && row.input <= range[1]).map(row => ({ ...row })) : [] };
} } };
const fetcher = computed(() => createReportSource({ production: { ...reports.production, params: document.value.template.params } }));
const rules: ReportValidationRule[] = [{ id: "mass-balance", dataset: "detail", field: "output", assert: { field: "output", op: "<=", right: { field: "input" }, numeric: "number" }, message: "出钢重不能超过投料重" }];
const editing: ReportEditingOptions = {
  requireSource: true,
  fields: { output: { type: "number", label: "出钢重", required: true, min: 0, precision: 2 }, note: { type: "text", label: "复核说明", maxLength: 120 } },
  validation: { rules },
  saveBatch(batch) {
    const next = stored.map(row => ({ ...row }));
    for (const edit of batch.edits) {
      const source = edit.source, row = next.find(item => item.id === source?.rowKey);
      if (!row || !source || source.datasetId !== "detail" || !["output", "note"].includes(source.field)) throw new Error("示例保存拒绝无来源或非白名单字段");
      const field = source.field as "output" | "note";
      if (!Object.is(row[field], edit.previousValue)) throw new Error("示例记录已变化，请重新查询");
      Object.assign(row, { [field]: edit.value });
    }
    assertReportValidation(validateReportDataset(next, { rowKey: "id", rules }));
    stored = next; saved.value++; revision.value++;
  },
};
const previous: ReportDataRecord[] = [
  { rowKey: "EAF-003", values: { input: 115, output: 107, note: "上期已复核" } },
  { rowKey: "EAF-001", values: { input: 118, output: 110, note: "核对称重数据" } },
  { rowKey: "EAF-002", values: { input: 98, output: 90, note: "待补工艺说明" } },
];
const prefill: ReportPrefillReviewOptions = { sourceScope: "production", datasetId: "detail", fields: [{ field: "note", label: "复核说明" }], load: () => previous, label: "上期说明预填" };
const dataComparison: ReportDataComparisonReviewOptions = { sourceScope: "production", datasetId: "detail", fields: [{ field: "input", label: "投料重", type: "decimal", tolerance: "0.01", ratioDigits: 4 }, { field: "output", label: "出钢重", type: "decimal", tolerance: "0.01", ratioDigits: 4 }], load: () => previous, label: "与上期实绩对比" };
const datasets = computed(() => { void revision.value; return { detail: stored.map(row => ({ ...row })) }; });
provideMachReportConfig({ theme: { toolbarBg: "#fff", toolbarFg: "#334155", toolbarBorder: "#e2e8f0", shellBg: "#f1f5f9", btnFg: "#334155", btnBorder: "#cbd5e1", btnActiveBg: "#1d4ed8" } });
</script>
<template>
  <main class="product-shell data-tools-demo">
    <header class="product-heading"><a class="product-brand" href="/" aria-label="MR · MachReport 首页">M<span>R</span></a><div class="product-title"><p>MACHREPORT / DATA WORKFLOW</p><h1>有规则的填报，有依据的核对</h1><p>示例数据 · 本地原子保存 · 不连接业务数据库</p></div><nav aria-label="演示模式"><button type="button" :class="{ active: mode === 'report' }" @click="mode = 'report'">报表体验</button><button type="button" :class="{ active: mode === 'design' }" @click="mode = 'design'">模板设计</button></nav></header>
    <ReportPreview v-if="mode === 'report'" report-id="production" :fetcher="fetcher" :editable="editing" :prefill="prefill" :data-comparison="dataComparison" :show-export="true" :toolbar="{ exportFormats: ['xlsx'], editing: true }" :show-pdf-window="false" :show-print="false" height="710px" />
    <ReportTemplateEditor v-else v-model="document" :datasets="datasets" :data-schemas="schemas" />
    <footer class="product-footer"><span>双击出钢重或说明编辑 · 数据工具内体验预填与对比</span><span data-testid="save-count">已保存 {{ saved }} 批 · 修订 {{ revision }}</span><code>{{ JSON.stringify(latestParams) }}</code></footer>
  </main>
</template>
<style scoped>
.data-tools-demo nav { display:flex; gap:5px; border:1px solid #dbe5f1; padding:4px; border-radius:9px; background:#fff; }
.data-tools-demo nav button { border:0; border-radius:6px; padding:8px 12px; font:inherit; font-size:12px; line-height:1.3; background:transparent; color:#64748b; cursor:pointer; }
.data-tools-demo nav button.active { background:#eaf2ff; color:#1d4ed8; }
.data-tools-demo nav button:focus-visible { outline:2px solid #2563eb; outline-offset:2px; }
.data-tools-demo .product-footer { display:flex; flex-wrap:wrap; gap:10px 20px; justify-content:space-between; font-size:11px; }
.data-tools-demo code { color:#526078; overflow-wrap:anywhere; }
@media(max-width:800px) { .data-tools-demo .product-heading { flex-wrap:wrap; }.data-tools-demo nav { margin-left:auto; } }
</style>
