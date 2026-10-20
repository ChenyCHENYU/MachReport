<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from "vue";
import { createLocalTemplateCatalog, createMemoryTemplateStore, createTemplateManager, parseReportTemplate, type ReportTemplateDocument } from "@agile-team/mach-report";
import { ReportTemplateEditor, ReportTemplateLibrary, ReportBatchPanel, type TemplateEditorController, type TemplateEditorSaveContext } from "@agile-team/mach-report/designer";
import { ReportPreview, provideMachReportConfig } from "@agile-team/mach-report/vue";
import { createMemoryReportInstanceStore, createReportGenerationService, createReportRuntime, type ReportBatchCase, type ReportInstanceSnapshot, type ReportInstanceSummary } from "@agile-team/mach-report/server";
import { platformDatasets, platformTemplate } from "./platform-template";
provideMachReportConfig({ pdfFontUrl: "/fonts/mach-report-demo.otf" });
const manager = createTemplateManager(createMemoryTemplateStore()), store = createMemoryReportInstanceStore();
const active = ref("library"), document = ref(platformTemplate), editor = ref<TemplateEditorController>();
const provider = shallowRef(createLocalTemplateCatalog([{ document: platformTemplate, category: "生产运营", tags: ["多区域", "树形汇总"] }]));
const instances = ref<ReportInstanceSummary[]>([]), current = shallowRef<ReportInstanceSnapshot>(), error = ref(""), status = ref("初始化参考存储…");
const paramDefs = computed(() => document.value.template.params ?? []);
const initialCases = [{ id: "october", params: { month: "2026-10", period: "2026-10-01/2026-10-20" } }, { id: "september", params: { month: "2026-09", period: "2026-09-01/2026-09-30" } }];
const fetcher = computed(() => async () => current.value!.plan);
async function refreshCatalog() {
  const rows = await manager.list();
  const documents = await Promise.all(rows.map(async row => ({ document: (await manager.get(row.id)) ?? (await manager.get(row.id, { draft: true }))!, category: "生产运营", tags: ["多区域", "树形汇总"] })));
  provider.value = createLocalTemplateCatalog(documents);
}
onMounted(async () => {
  try { const draft = await manager.saveDraft(platformTemplate, { expectedRevision: null }); const published = await manager.publish(draft.id, { expectedRevision: draft.revision }); document.value = published.published!; await refreshCatalog(); status.value = "本地参考适配器 · 刷新清空 · 所有数据为合成样例"; }
  catch (cause) { error.value = String(cause); }
});
async function navigate(next: string) {
  if (active.value === "design" && next !== "design" && editor.value && !await editor.value.guardChanges()) return;
  active.value = next;
}
async function openTemplate(value: ReportTemplateDocument) { if (active.value === "design" && editor.value && !await editor.value.guardChanges("replace", value)) return; document.value = value; active.value = "design"; }
async function save(value: ReportTemplateDocument, context: TemplateEditorSaveContext) { const next = await manager.saveDraft(value, { expectedRevision: context.expectedRevision ?? null, signal: context.signal }); status.value = `已保存草稿 · ${next.revision}，批量生成仍使用已发布版本`; await refreshCatalog(); return next.draft!; }
async function publish() {
  try { await editor.value?.save(); const next = await manager.publish(document.value.id, { expectedRevision: document.value.revision ?? null }); document.value = next.published!; status.value = `已发布模板 · 修订 ${next.revision}`; await refreshCatalog(); } catch (cause) { error.value = String(cause); }
}
async function copy(value: ReportTemplateDocument, { signal }: { signal: AbortSignal }) { const next = await manager.saveDraft(value, { expectedRevision: null, signal }); await refreshCatalog(); return next.draft!; }
async function generate(item: ReportBatchCase, { signal }: { signal: AbortSignal }) {
  const template = await manager.get(document.value.id, { signal });
  if (!template?.revision) throw new Error("请先发布该模板");
  const snapshot = parseReportTemplate(template);
  const runtime = createReportRuntime({ reports: { [snapshot.id]: { template: snapshot.template, datasets: platformDatasets } } });
  const service = createReportGenerationService({ runtime, instances: store, templateRevisions: { [snapshot.id]: snapshot.revision! } });
  const result = await service.generate({ scope: "local-demo", id: `${snapshot.id}-${item.id}`, title: `${snapshot.name} · ${item.params.month}`, reportIds: [snapshot.id], params: item.params, expectedRevision: null, signal });
  instances.value = (await store.list("local-demo")).items;
  return { instanceId: result.id, label: result.title };
}
async function openInstance(id: string) { const result = await store.read("local-demo", id); if (result) { current.value = result; active.value = "instances"; } }
</script>
<template>
  <main class="platform-demo">
<header><div><p>MACHREPORT / PRODUCT WORKFLOW</p><h1>从业务模板到可追溯的报表实例</h1></div><a href="/designer.html">模板工作台 ↗</a></header><div class="platform-status" role="status">{{ status }}</div>
    <nav aria-label="产品工作流"><button v-for="item in [{id:'library',label:'模板库'},{id:'design',label:'模板设计'},{id:'batch',label:'批量生成'},{id:'instances',label:'报表实例'}]" :key="item.id" :aria-pressed="active === item.id" @click="navigate(item.id)">{{ item.label }}</button></nav>
    <p v-if="error" role="alert">{{ error }}</p>
    <ReportTemplateLibrary v-if="active === 'library'" :provider="provider" :create="copy" @open="openTemplate" />
    <div v-if="active === 'design'"><div class="platform-actions"><span>模板设计与发布分开；生成使用最后发布的修订</span><button @click="publish">发布当前草稿</button></div><ReportTemplateEditor ref="editor" v-model="document" :datasets="platformDatasets" :save="save" /></div>
    <ReportBatchPanel v-if="active === 'batch'" :param-defs="paramDefs" :execute="generate" :initial-cases="initialCases" @open-instance="$event.instanceId && openInstance($event.instanceId)" />
    <section v-if="active === 'instances'" class="platform-instances"><aside><h2>报表实例 <small>{{ instances.length }}</small></h2><p v-if="!instances.length">从批量生成创建第一份实例</p><button v-for="item in instances" :key="item.id" :aria-pressed="current?.id === item.id" @click="openInstance(item.id)"><strong>{{ item.title }}</strong><small>实例修订 {{ item.revision }} · 模板 {{ Object.values(item.templateRevisions).join(', ') }}</small></button></aside><ReportPreview v-if="current" :key="`${current.id}:${current.revision}`" :report-id="current.id" :fetcher="fetcher" /><div v-else class="platform-instance-empty">选择实例以预览保存的快照</div></section>
  </main>
</template>
<style>
body{margin:0;background:#f2f5fa}.platform-demo{max-width:1500px;margin:0 auto;padding:28px;color:#334155;font:13px/1.5 system-ui,sans-serif}.platform-demo>header{display:flex;align-items:center;justify-content:space-between;gap:16px}.platform-demo>header p{font-size:10px;letter-spacing:2px;color:#6886aa}.platform-demo h1{font-size:24px;color:#18375d;margin:6px 0 16px}.platform-demo a{color:#54749c;text-decoration:none}.platform-status{color:#71869e;font-size:12px;margin-bottom:16px}.platform-demo>nav{display:flex;gap:4px;border-bottom:1px solid #d7e1ed;margin-bottom:18px}.platform-demo button{font:inherit;cursor:pointer;border:1px solid #d7e1ed;border-radius:6px;background:#fff;color:#475569;padding:7px 12px}.platform-demo>nav button{border:0;border-radius:6px 6px 0 0;background:transparent;padding:10px 18px}.platform-demo>nav button[aria-pressed=true]{background:#fff;color:#245fba;box-shadow:inset 0 -2px #3b82f6}.platform-demo :focus-visible{outline:2px solid #60a5fa;outline-offset:2px}.platform-actions{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px;color:#71869e}.platform-instances{display:grid;grid-template-columns:250px minmax(0,1fr);gap:16px;min-height:650px}.platform-instances aside{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px}.platform-instances h2{font-size:14px;margin:0 0 14px;color:#234b80}.platform-instances aside button{width:100%;text-align:left;margin-bottom:8px;white-space:normal}.platform-instances small{display:block;font-size:11px;color:#94a3b8}.platform-instances button[aria-pressed=true]{background:#eff6ff;border-color:#9bc0f0}.platform-instance-empty{display:grid;place-items:center;background:#fff;border:1px dashed #cbd5e1;border-radius:10px;color:#94a3b8}.platform-demo [role=alert]{color:#991b1b;padding:12px;background:#fff7f7;border:1px solid #fecaca;border-radius:6px}@media(max-width:750px){.platform-demo{padding:12px}.platform-demo h1{font-size:18px}.platform-instances{grid-template-columns:1fr}.platform-actions{align-items:start;flex-direction:column}}
</style>
