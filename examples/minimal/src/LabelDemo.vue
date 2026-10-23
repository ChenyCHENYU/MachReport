<script setup lang="ts">
import { computed, ref } from "vue";
import { createMemoryTemplateStore, createReportSource, createTemplateManager, defineLabelReport, parseReportTemplate, type ReportTemplateDocument } from "@agile-team/mach-report";
import { createCodeAssetRenderers } from "@agile-team/mach-report/codes";
import { ReportPreview, provideMachReportConfig } from "@agile-team/mach-report/vue";
import { ReportTemplateEditor, type TemplateEditorController, type TemplateEditorSaveContext } from "@agile-team/mach-report/designer";
import { labelContract, labelDocument, labelRows } from "./label-template";

const mode = ref("preview"), record = ref("all");
const editor = ref<TemplateEditorController>();
const manager = createTemplateManager(createMemoryTemplateStore());
const document = ref(parseReportTemplate(labelDocument)), saved = ref(false);
let savedDocument = parseReportTemplate(labelDocument);
const assets = { assetRenderers: createCodeAssetRenderers() };
provideMachReportConfig({ defaults: { pdfFontUrl: "/fonts/mach-report-demo.otf", assets } });
const rows = computed(() => record.value === "all" ? labelRows : [labelRows[Number(record.value)]!]);
const dataset = computed(() => document.value.template.repeat?.dataset ?? "materials");
const datasets = computed(() => ({ [dataset.value]: rows.value }));
const dataSchemas = computed(() => ({ [dataset.value]: labelContract }));
const fetcher = computed(() => createReportSource({ labels: defineLabelReport({ template: document.value.template, rows: rows.value, dataSchema: labelContract }) }));
const paper = computed(() => document.value.template.pages[0]!);
const pageCount = computed(() => {
  const copies = document.value.template.repeat?.copies ?? 1;
  const counts = rows.value.map(row => typeof copies === "number" ? copies : (row as Record<string, unknown>)[copies.field]);
  if (!counts.every(value => typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 1000)) return null;
  return counts.reduce<number>((total, value) => total + Number(value), 0) * document.value.template.pages.length;
});
const fields = labelContract.fields.map(field => ({ ...field, sample: labelRows[0]?.[field.field as keyof typeof labelRows[0]] }));
async function save(draft: ReportTemplateDocument, context: TemplateEditorSaveContext) {
  const stored = await manager.saveDraft(draft, { expectedRevision: context.expectedRevision ?? null, signal: context.signal });
  saved.value = true;
  savedDocument = parseReportTemplate(stored.draft!);
  return stored.draft!;
}
async function navigate(next: string) {
  if (mode.value === "design" && next !== "design" && editor.value) {
    if (!await editor.value.guardChanges()) return;
    document.value = parseReportTemplate(savedDocument);
  }
  mode.value = next;
}
</script>
<template>
  <main class="label-demo">
    <header class="label-heading">
      <a class="label-brand" href="/" aria-label="MachReport 首页">M<span>R</span></a>
      <div><p>MACHREPORT / LABEL STUDIO</p><h1>材料标识工作台</h1><span>从字段到实物，让信息清晰可追溯</span></div>
      <a class="label-guide" href="https://github.com/ChenyCHENYU/MachReport/blob/main/docs/LABELS.md" target="_blank" rel="noreferrer">接入指南 <span aria-hidden="true">↗</span></a>
    </header>
    <section class="label-workspace">
      <aside class="label-context">
        <div class="label-context-title"><span class="label-dot"></span>工业材料标签<small>示例模板</small></div>
        <div class="label-spec"><strong>{{ paper.widthMm }} <span>×</span> {{ paper.heightMm }}</strong><span>mm · {{ document.template.pages.length }} 个版面</span><div class="label-code-tags"><span>QR</span><span>CODE 128</span></div></div>
        <div class="label-data-control"><label class="label-record">预览数据<select v-model="record"><option value="all">全部物料 · {{ labelRows.length }} 条记录</option><option v-for="(item, index) in labelRows" :key="item.serial" :value="String(index)">{{ item.serial }} · {{ item.grade }}</option></select></label><p class="label-output-count"><strong>{{ rows.length }}</strong> 条物料 <span>→</span> <template v-if="pageCount !== null"><strong>{{ pageCount }}</strong> 张标签</template><span v-else>份数待校验</span></p></div>
        <dl><div><dt>输出顺序</dt><dd>每条物料的版面相邻</dd></div><div><dt>模板与数据</dt><dd>字段绑定 · 独立维护</dd></div></dl>
        <details class="label-help"><summary>设计与打印提示</summary><ol><li>调整版面、内容与字段绑定</li><li>切换预览，核对真实码图</li><li>保存模板，按原尺寸输出</li></ol><p>使用合成示例数据。实际打印请选择同规格纸张与 100% 比例，先试打一张核对尺寸和扫码。</p></details>
      </aside>
      <div class="label-main">
        <nav aria-label="标签工作区"><div class="label-mode-switch"><button :aria-pressed="mode === 'preview'" @click="navigate('preview')"><span aria-hidden="true">◫</span> 打印预览</button><button :aria-pressed="mode === 'design'" @click="navigate('design')"><span aria-hidden="true">✎</span> 设计标签</button></div><span role="status" :class="{ 'label-saved': saved }"><i aria-hidden="true"></i>{{ saved ? '模板已保存到本次会话' : '本次会话 · 刷新恢复' }}</span></nav>
        <div class="label-stage">
        <ReportPreview v-if="mode === 'preview'" report-id="labels" :fetcher="fetcher" height="100%" :toolbar="{ exportFormats: ['pdf', 'png', 'html'], editing: false, excelImport: false }" :messages="{ title: '材料标签', fitWidth: '适宽' }" />
        <ReportTemplateEditor v-else ref="editor" v-model="document" :datasets="datasets" :data-schemas="dataSchemas" :binding-datasets="[{ id: dataset, label: '物料', fields }]" :preview="{ assets, pdfFontUrl: '/fonts/mach-report-demo.otf' }" :save="save" />
        </div>
      </div>
    </section>
    <footer class="label-footer"><span>同一份模板，浏览器与 Node 共用</span><span>毫米级布局 · 按需编码 · 可追溯输出</span></footer>
  </main>
</template>
<style src="./label-demo.css"></style>
