<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef } from "vue";
import { createMemoryTemplateStore, createTemplateManager, parseReportTemplate, type ReportTemplateCatalogOpenContext, type ReportTemplateDocument } from "@agile-team/mach-report";
import { ReportTemplateEditor, ReportTemplateLibrary, ReportBatchPanel, type TemplateEditorController, type TemplateEditorSaveContext } from "@agile-team/mach-report/designer";
import { ReportPreview, provideMachReportConfig } from "@agile-team/mach-report/vue";
import { createReportWorkflow, createMemoryReportInstanceStore, type ReportBatchCase, type ReportInstanceSnapshot, type ReportInstanceSummary } from "@agile-team/mach-report/server";
import { platformDatasets, platformTemplate } from "./platform-template";
provideMachReportConfig({ pdfFontUrl: "/fonts/mach-report-demo.otf" });
const manager = createTemplateManager(createMemoryTemplateStore()), store = createMemoryReportInstanceStore();
const workflow = createReportWorkflow({ templates: manager, instances: store, scope: "local-demo", data: { datasets: platformDatasets },
  title: (document, item, params) => `${document.name} · ${params.month ?? item.id}`,
  catalogMetadata: () => ({ category: "生产运营", tags: ["多区域", "树形汇总"] }) });
const provider = workflow.catalog;
const active = ref("library"), document = ref(platformTemplate), documentMode = ref<ReportTemplateCatalogOpenContext["mode"]>("edit"), editor = ref<TemplateEditorController>();
const ready = ref(false), publishing = ref(false), batchBusy = ref(0);
const latestPublished = shallowRef<ReportTemplateDocument>();
const instances = ref<ReportInstanceSummary[]>([]), current = shallowRef<ReportInstanceSnapshot>(), error = ref(""), status = ref("初始化参考存储…");
type BatchSession = Awaited<ReturnType<typeof workflow.batch>> & { key: string; initialCases: ReportBatchCase[] };
const batchSession = shallowRef<BatchSession>();
let batchNumber = 0, successfulSaves = 0;
const fetcher = computed(() => { const plan = current.value?.plan; return async () => plan!; });
const newerPublication = computed(() => latestPublished.value?.id === batchSession.value?.document.id && latestPublished.value?.revision !== batchSession.value?.document.revision);
const failure = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
onMounted(async () => {
  try {
    const draft = await manager.saveDraft(platformTemplate, { expectedRevision: null });
    const published = await manager.publish(draft.id, { expectedRevision: draft.revision });
    document.value = published.published!; latestPublished.value = parseReportTemplate(published.published!);
    ready.value = true; status.value = "本地参考适配器 · 刷新清空 · 所有数据为合成样例";
  } catch (cause) { error.value = failure(cause); }
});
async function loadPublished() { latestPublished.value = await manager.get(document.value.id); return latestPublished.value; }
async function refreshInstances() { instances.value = (await store.list("local-demo", { limit: 100 })).items; }
async function startBatch(template: ReportTemplateDocument) {
  if (batchBusy.value) throw new Error("请先取消或等待当前批次结束");
  const batch = await workflow.batch(template.id, { expectedRevision: template.revision }), number = ++batchNumber;
  const execute = async (item: ReportBatchCase, context: { signal: AbortSignal }) => {
    batchBusy.value++;
    try {
      const result = await batch.execute(item, context);
      // An observation failure must not turn a committed instance into a failed generation.
      try { await refreshInstances(); } catch (cause) { error.value = failure(cause); }
      return result;
    } finally { batchBusy.value--; }
  };
  batchSession.value = { ...batch, execute, key: `${template.id}:${number}`, initialCases: [
    { id: `batch-${number}-october`, params: { month: "2026-10", period: "2026-10-01/2026-10-20" } },
    { id: `batch-${number}-september`, params: { month: "2026-09", period: "2026-09-01/2026-09-30" } },
  ] };
}
async function ensureBatch() {
  const published = await loadPublished();
  if (batchSession.value?.document.id === document.value.id || batchBusy.value) return;
  if (!published) throw new Error("请先发布当前模板再生成报表");
  await startBatch(published);
}
async function navigate(next: string) {
  try {
    if (!ready.value) return;
    if (active.value === "design" && next !== "design" && editor.value && !await editor.value.guardChanges()) return;
    if (next === "batch") await ensureBatch();
    active.value = next; error.value = "";
  } catch (cause) { error.value = failure(cause); }
}
async function openTemplate(value: ReportTemplateDocument, context: ReportTemplateCatalogOpenContext = { mode: "edit" }) {
  try {
    if (active.value === "design" && editor.value && !await editor.value.guardChanges("replace", value)) return;
    document.value = parseReportTemplate(value); documentMode.value = context.mode;
    await loadPublished(); active.value = "design"; error.value = "";
  } catch (cause) { error.value = failure(cause); }
}
async function editDraft() {
  try { const draft = await provider.get(document.value.id, { mode: "edit" }); if (draft) await openTemplate(draft, { mode: "edit" }); }
  catch (cause) { error.value = failure(cause); }
}
async function save(value: ReportTemplateDocument, context: TemplateEditorSaveContext) {
  const next = await manager.saveDraft(value, { expectedRevision: context.expectedRevision ?? null, signal: context.signal });
  successfulSaves++; status.value = `已保存草稿 · 修订 ${next.revision}`; return next.draft!;
}
async function publish() {
  const controller = editor.value;
  if (!controller || publishing.value || documentMode.value === "published") return;
  publishing.value = true; error.value = "";
  try {
    const next = await workflow.publish({ editor: controller, document: () => document.value,
      successfulSaves: () => successfulSaves, afterSave: nextTick });
    document.value = next.published!; latestPublished.value = parseReportTemplate(next.published!);
    status.value = `已发布模板 · 修订 ${next.revision}`;
  } catch (cause) { error.value = failure(cause); }
  finally { publishing.value = false; }
}
async function copy(value: ReportTemplateDocument, { signal }: { signal: AbortSignal }) { const next = await manager.saveDraft(value, { expectedRevision: null, signal }); return next.draft!; }
async function restartBatch() {
  try { const published = await loadPublished(); if (!published) throw new Error("请先发布当前模板"); await startBatch(published); error.value = ""; }
  catch (cause) { error.value = failure(cause); }
}
async function openInstance(id: string) {
  try { const result = await store.read("local-demo", id); if (result) { current.value = result; active.value = "instances"; error.value = ""; } }
  catch (cause) { error.value = failure(cause); }
}
</script>
<template>
  <main class="platform-demo">
<header><div><p>MACHREPORT / PRODUCT WORKFLOW</p><h1>从业务模板到可追溯的报表实例</h1></div><a href="/designer.html">模板工作台 ↗</a></header><div class="platform-status" role="status">{{ status }}</div>
    <nav aria-label="产品工作流"><button v-for="item in [{id:'library',label:'模板库'},{id:'design',label:'模板设计'},{id:'batch',label:'批量生成'},{id:'instances',label:'报表实例'}]" :key="item.id" :aria-pressed="active === item.id" @click="navigate(item.id)">{{ item.label }}</button></nav>
    <p v-if="error" role="alert">{{ error }}</p>
    <ReportTemplateLibrary v-if="ready && active === 'library'" :provider="provider" :create="copy" @open="openTemplate" />
    <div v-if="active === 'design'"><div class="platform-actions"><span>{{ documentMode === 'published' ? '发布版只读' : '编辑草稿' }} · 修订 {{ document.revision }}<template v-if="latestPublished"> · 已发布 {{ latestPublished.revision }}</template></span><button v-if="documentMode === 'published'" @click="editDraft">返回编辑草稿</button><button v-else :disabled="publishing || editor?.saving || editor?.blocked" @click="publish">{{ publishing ? '正在发布…' : '发布当前草稿' }}</button></div><ReportTemplateEditor ref="editor" v-model="document" :readonly="documentMode === 'published'" :datasets="platformDatasets" :save="save" /></div>
    <section v-if="batchSession" v-show="active === 'batch'" class="platform-batch"><div class="platform-actions"><span class="platform-batch-context"><strong :title="batchSession.document.name">{{ batchSession.document.name }}</strong> · 绑定发布修订 {{ batchSession.document.revision }}<template v-if="newerPublication"> · 有新版 {{ latestPublished?.revision }}</template></span><button v-if="newerPublication" :disabled="batchBusy > 0" @click="restartBatch">使用最新发布版创建新批次</button></div><ReportBatchPanel :key="batchSession.key" :param-defs="batchSession.document.template.params ?? []" :execute="batchSession.execute" :initial-cases="batchSession.initialCases" @open-instance="$event.instanceId && openInstance($event.instanceId)" /></section>
    <section v-if="active === 'instances'" class="platform-instances"><aside><h2>报表实例 <small>{{ instances.length }}</small></h2><p v-if="!instances.length">从批量生成创建第一份实例</p><button v-for="item in instances" :key="item.id" :aria-pressed="current?.id === item.id" @click="openInstance(item.id)"><strong>{{ item.title }}</strong><small>实例修订 {{ item.revision }} · 模板 {{ Object.values(item.templateRevisions).join(', ') }}</small></button></aside><ReportPreview v-if="current" :key="`${current.id}:${current.revision}`" :report-id="current.id" :fetcher="fetcher" /><div v-else class="platform-instance-empty">选择实例以预览保存的快照</div></section>
  </main>
</template>
<style>
body{margin:0;background:#f2f5fa}.platform-demo{max-width:1500px;margin:0 auto;padding:28px;color:#334155;font:13px/1.5 system-ui,sans-serif}.platform-demo>header{display:flex;align-items:center;justify-content:space-between;gap:16px}.platform-demo>header p{font-size:10px;letter-spacing:2px;color:#6886aa}.platform-demo h1{font-size:24px;color:#18375d;margin:6px 0 16px}.platform-demo a{color:#54749c;text-decoration:none}.platform-status{color:#71869e;font-size:12px;margin-bottom:16px}.platform-demo>nav{display:flex;gap:4px;border-bottom:1px solid #d7e1ed;margin-bottom:18px}.platform-demo button{font:inherit;cursor:pointer;border:1px solid #d7e1ed;border-radius:6px;background:#fff;color:#475569;padding:7px 12px}.platform-demo>nav button{border:0;border-radius:6px 6px 0 0;background:transparent;padding:10px 18px}.platform-demo>nav button[aria-pressed=true]{background:#fff;color:#245fba;box-shadow:inset 0 -2px #3b82f6}.platform-demo :focus-visible{outline:2px solid #60a5fa;outline-offset:2px}.platform-actions{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px;color:#71869e}.platform-instances{display:grid;grid-template-columns:250px minmax(0,1fr);gap:16px;min-height:650px}.platform-instances aside{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px}.platform-instances h2{font-size:14px;margin:0 0 14px;color:#234b80}.platform-instances aside button{width:100%;text-align:left;margin-bottom:8px;white-space:normal}.platform-instances small{display:block;font-size:11px;color:#94a3b8}.platform-instances button[aria-pressed=true]{background:#eff6ff;border-color:#9bc0f0}.platform-instance-empty{display:grid;place-items:center;background:#fff;border:1px dashed #cbd5e1;border-radius:10px;color:#94a3b8}.platform-demo [role=alert]{color:#991b1b;padding:12px;background:#fff7f7;border:1px solid #fecaca;border-radius:6px}@media(max-width:750px){.platform-demo{padding:12px}.platform-demo h1{font-size:18px}.platform-instances{grid-template-columns:1fr}.platform-actions{align-items:start;flex-direction:column}}
.platform-actions{min-width:0}.platform-actions>span{min-width:0;overflow-wrap:anywhere}.platform-batch-context strong{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-weight:500}.platform-batch-context{flex:1}
</style>
