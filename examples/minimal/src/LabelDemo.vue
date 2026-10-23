<script setup lang="ts">
import { computed, ref } from "vue";
import { createMemoryTemplateStore, createReportSource, createTemplateManager, parseReportTemplate, type ReportTemplateDocument } from "@agile-team/mach-report";
import { createCodeAssetRenderers } from "@agile-team/mach-report/codes";
import { ReportPreview, provideMachReportConfig } from "@agile-team/mach-report/vue";
import { ReportTemplateEditor, type TemplateEditorController, type TemplateEditorSaveContext } from "@agile-team/mach-report/designer";
import { labelContract, labelDocument, labelRows } from "./label-template";

const mode = ref("preview"), record = ref("all");
const editor = ref<TemplateEditorController>();
const manager = createTemplateManager(createMemoryTemplateStore());
const document = ref(parseReportTemplate(labelDocument)), saved = ref(false);
const assets = { assetRenderers: createCodeAssetRenderers() };
provideMachReportConfig({ defaults: { pdfFontUrl: "/fonts/mach-report-demo.otf", assets } });
const datasets = computed(() => ({ materials: record.value === "all" ? labelRows : [labelRows[Number(record.value)]!] }));
const fetcher = computed(() => createReportSource({ labels: { template: document.value.template, datasets: datasets.value, dataSchema: { materials: labelContract } } }));
const fields = labelContract.fields.map(field => ({ ...field, sample: labelRows[0]?.[field.field as keyof typeof labelRows[0]] }));
async function save(draft: ReportTemplateDocument, context: TemplateEditorSaveContext) {
  const stored = await manager.saveDraft(draft, { expectedRevision: context.expectedRevision ?? null, signal: context.signal });
  saved.value = true;
  return stored.draft!;
}
async function navigate(next: string) {
  if (mode.value === "design" && next !== "design" && editor.value && !await editor.value.guardChanges()) return;
  mode.value = next;
}
</script>
<template>
  <main class="label-demo">
    <header class="label-heading">
      <a class="label-brand" href="/" aria-label="MachReport 首页">M<span>R</span></a>
      <div><p>MACHREPORT / INDUSTRIAL LABELS</p><h1>让每一件产品，都有清晰的身份</h1><span>80 × 55 mm · 字段绑定 · 真实码图 · 多版顺序输出</span></div>
      <a class="label-guide" href="https://github.com/ChenyCHENYU/MachReport/blob/main/docs/LABELS.md" target="_blank" rel="noreferrer">接入说明 ↗</a>
    </header>
    <section class="label-workspace">
      <aside class="label-context">
        <div class="label-context-title"><span class="label-dot"></span>工业材料标签<small>LABEL SYSTEM</small></div>
        <div class="label-spec"><strong>80 <span>×</span> 55</strong><span>毫米 / 自定义纸张</span></div>
        <label class="label-record">预览数据<select v-model="record"><option value="all">全部物料 · 2 条记录</option><option v-for="(item, index) in labelRows" :key="item.serial" :value="String(index)">{{ item.serial }} · {{ item.grade }}</option></select></label>
        <dl><div><dt>标签版面</dt><dd>产品标识 + 仓储识别</dd></div><div><dt>生成顺序</dt><dd>每条物料的两版相邻</dd></div><div><dt>编码</dt><dd>QR · Code 128</dd></div></dl>
        <div class="label-how"><strong>从设计到打印</strong><ol><li>在设计器调整尺寸与布局</li><li>绑定字段，使用样例预览</li><li>保存模板，按原尺寸输出</li></ol></div>
        <p class="label-notice">合成示例数据。实际打印请选择相同纸张与 100% 比例，并先试打一张核对尺寸及扫码。</p>
      </aside>
      <div class="label-main">
        <nav aria-label="标签工作区"><button :aria-pressed="mode === 'preview'" @click="navigate('preview')">打印预览</button><button :aria-pressed="mode === 'design'" @click="navigate('design')">设计标签</button><span role="status">{{ saved ? '模板已保存到本次会话' : '示例模板 · 刷新恢复' }}</span></nav>
        <ReportPreview v-if="mode === 'preview'" report-id="labels" :fetcher="fetcher" :assets="assets" height="650px" :toolbar="{ exportFormats: ['pdf', 'png', 'html'], editing: false, excelImport: false }" :messages="{ title: '材料标签', fitWidth: '适宽' }" />
        <ReportTemplateEditor v-else ref="editor" v-model="document" :datasets="datasets" :data-schemas="{ materials: labelContract }" :binding-datasets="[{ id: 'materials', label: '物料', fields }]" :preview="{ assets, pdfFontUrl: '/fonts/mach-report-demo.otf' }" :save="save" />
        <footer class="label-footer"><span>同一份模板，浏览器与 Node 共用</span><span>驱动控制纸盒、打印机和硬件双面</span></footer>
      </div>
    </section>
  </main>
</template>
<style>
html,body,#app{margin:0;min-height:100%;font-family:Inter,"Microsoft YaHei",system-ui,sans-serif}body{background:#f1f5fa;color:#263e59}.label-demo{max-width:1640px;margin:auto;padding:28px 32px}.label-heading{display:flex;align-items:center;gap:16px;margin-bottom:26px}.label-brand{display:flex;align-items:center;justify-content:center;width:54px;height:54px;flex-shrink:0;background:#173756;color:white;text-decoration:none;font-size:20px;letter-spacing:-2px;font-weight:700;border-radius:14px;box-shadow:0 8px 20px #17375615}.label-brand span{color:#8bdece}.label-heading p{font-size:9px;letter-spacing:2.2px;color:#6a83a0;margin:0 0 5px}.label-heading h1{font-size:23px;letter-spacing:.2px;margin:0 0 6px;color:#183652}.label-heading>div>span{font-size:11px;color:#74869a}.label-guide{margin-left:auto;color:#4f7194;text-decoration:none;font-size:12px}.label-workspace{display:grid;grid-template-columns:236px minmax(0,1fr);border:1px solid #dce5ef;border-radius:13px;background:white;box-shadow:0 14px 40px #17375608;overflow:hidden}.label-context{padding:23px 20px;background:linear-gradient(155deg,#fbfdff,#f5f8fc);border-right:1px solid #e3ebf4}.label-context-title{font-size:13px;font-weight:600}.label-context-title small{display:block;font-size:8px;letter-spacing:1.5px;font-weight:400;color:#8295aa;margin:7px 0 0 14px}.label-dot{display:inline-block;width:6px;height:6px;background:#4b95ca;border-radius:50%;margin-right:8px}.label-spec{padding:24px 0;border-bottom:1px solid #e2eaf3;margin-bottom:22px}.label-spec strong{font-size:33px;font-weight:500;letter-spacing:-1px}.label-spec strong span{font-size:23px;color:#9bacbe;margin:0 5px}.label-spec>span{display:block;font-size:10px;color:#8194a9;margin-top:7px}.label-record{display:grid;gap:8px;font-size:11px;color:#627b94}.label-record select{min-width:0;width:100%;font:11px/1.4 inherit;color:#2d4b6a;padding:9px 6px;border:1px solid #d6e1ee;background:white;border-radius:6px}.label-context dl{font-size:11px;margin:20px 0}.label-context dl>div{padding:9px 0}.label-context dt{color:#8b9caf;margin-bottom:5px;font-size:10px}.label-context dd{margin:0;color:#435e7a}.label-how{border-top:1px solid #e1e9f3;padding-top:20px;font-size:11px}.label-how strong{font-weight:500}.label-how ol{padding-left:16px;font-size:10px;line-height:2.4;color:#7c8ea2}.label-notice{font-size:10px;line-height:1.9;color:#8a9aab;margin-top:24px}.label-main{min-width:0}.label-main>nav{display:flex;gap:4px;align-items:center;padding:10px 18px;border-bottom:1px solid #e4eaf2}.label-main>nav button{border:0;background:transparent;font:12px/1.5 inherit;color:#7e8c9d;border-radius:5px;padding:8px 14px;cursor:pointer}.label-main>nav button[aria-pressed=true]{background:#edf4ff;color:#285f9b;font-weight:600}.label-main>nav>span{margin-left:auto;font-size:10px;color:#92a0b0}.label-main>.mr-designer{height:650px;border:0;border-radius:0}.label-footer{display:flex;justify-content:space-between;gap:12px;padding:12px 20px;font-size:10px;color:#98a6b5;border-top:1px solid #e4eaf2}.label-demo :focus-visible{outline:2px solid #78aee4;outline-offset:3px}@media(max-width:900px){.label-demo{padding:18px}.label-workspace{grid-template-columns:1fr}.label-context{display:none}.label-heading h1{font-size:18px}.label-guide{display:none}}@media(max-width:540px){.label-demo{padding:10px}.label-heading{gap:10px;margin:10px 0 18px}.label-brand{width:42px;height:42px}.label-heading h1{font-size:16px}.label-heading p{font-size:8px;letter-spacing:1.3px}.label-main>nav{padding:8px}.label-main>nav>span{font-size:9px}.label-footer{flex-direction:column;gap:4px}}
</style>
