import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(resolve(tmpdir(), "mach-report-compat-"));
const args = Object.fromEntries(process.argv.slice(2).filter((arg) => arg.startsWith("--")).map((arg) => { const split = arg.indexOf("="); return [arg.slice(2, split), arg.slice(split + 1)]; }));
const node = args.node ?? process.execPath;
const require = createRequire(resolve(root, "packages/mach-report/package.json"));
function run(command, arguments_, cwd = scratch) {
  const result = spawnSync(command, arguments_, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command}: ${result.error ?? ""}\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  return result.stdout.trim();
}
try {
  if (!args.archive) run("pnpm", ["--filter", "@agile-team/mach-report", "pack", "--pack-destination", scratch], root);
  const archive = args.archive ? resolve(args.archive) : resolve(scratch, readdirSync(scratch).find((name) => name.endsWith(".tgz")) ?? "missing.tgz");
  run("tar", ["-xzf", archive]);
  const manifest = JSON.parse(readFileSync(resolve(scratch, "package/package.json"), "utf8"));
  let compilerRequire = require;
  // 最低peer使用真实安装版本；无参数时只核验本机已有版本，不伪装已测矩阵。
  if (args.vue) {
    writeFileSync(resolve(scratch, "package.json"), JSON.stringify({ private: true, type: "module" }));
    run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", `vue@${args.vue}`, `@vue/server-renderer@${args.vue}`, `typescript@${manifest.devDependencies?.typescript ?? "^5.9.0"}`, `@types/node@${manifest.dependencies?.["@types/node"] ?? "^22.12.0"}`, "--registry=https://registry.npmjs.org"]);
    compilerRequire = createRequire(resolve(scratch, "package.json"));
  } else {
    mkdirSync(resolve(scratch, "node_modules"), { recursive: true });
    const vuePackage = require.resolve("vue/package.json");
    symlinkSync(dirname(vuePackage), resolve(scratch, "node_modules/vue"), "dir");
    mkdirSync(resolve(scratch, "node_modules/@vue"), { recursive: true });
    symlinkSync(dirname(createRequire(vuePackage).resolve("@vue/server-renderer/package.json")), resolve(scratch, "node_modules/@vue/server-renderer"), "dir");
  }
  mkdirSync(resolve(scratch, "node_modules/@agile-team"), { recursive: true });
  symlinkSync(resolve(scratch, "package"), resolve(scratch, "node_modules/@agile-team/mach-report"), "dir");
  if (!args.vue) {
    mkdirSync(resolve(scratch, "node_modules/@types"), { recursive: true });
    const nodeTypes = require.resolve("@types/node/package.json");
    symlinkSync(dirname(nodeTypes), resolve(scratch, "node_modules/@types/node"), "dir");
    symlinkSync(dirname(createRequire(nodeTypes).resolve("undici-types/package.json")), resolve(scratch, "node_modules/undici-types"), "dir");
  }
  writeFileSync(resolve(scratch, "consumer.mts"), `
import { ReportPreview, createProviderEditing, defineMachReportConfig, machReportPlugin, type ReportEditHistoryOptions, type ReportPreviewTask, type MachReportController, type MachReportTheme } from '@agile-team/mach-report/vue';
import { createApp } from 'vue';
import { ReportTemplateEditor, ExcelBindingWizard, RuleEditor, TemplateReviewPanel, type TemplateDraftStorage } from '@agile-team/mach-report/designer';
import { createReportRuntime, type ReportRuntimeInput } from '@agile-team/mach-report/server';
import { createNodeAutoReportExporter } from '@agile-team/mach-report/server/node';
import type { ReportExportExecutionOptions } from '@agile-team/mach-report/worker';
import { inspectOutputCapabilitiesSummary, type DiagnosticSummary, type OutputDiagnostic, type RenderPlan, type ReportCellEdit, type ReportProvider, type ReportProviderConflict, type ReportQueryContext, type ReportQuerySource, type ReportTaskEvent, type ReportTemplateDocument } from '@agile-team/mach-report';
type PreviewProps = InstanceType<typeof ReportPreview>['$props'];
const existingTheme: MachReportTheme = {
  shellBg: '#ffffff', shellFg: '#334155', toolbarBg: '#ffffff', toolbarBorder: '#e2e8f0', toolbarFg: '#334155',
  btnFg: '#475569', btnBorder: '#cbd5e1', btnHoverBg: '#eff6ff', btnHoverFg: '#1d4ed8', btnActiveBg: '#2563eb'
};
const themeOverrides: Partial<MachReportTheme> = { colorScheme: 'dark', btnActiveFg: '#102030', errorFg: '#fca5a5', warningFg: '#fcd34d', successFg: '#6ee7b7' };
// @ts-expect-error 原生控件主题使用明确的浅色或深色模式
const invalidTheme: Partial<MachReportTheme> = { colorScheme: 'automatic' };
void [existingTheme, themeOverrides, invalidTheme];
createApp({}).use(machReportPlugin, { config: defineMachReportConfig({ defaults: { theme: themeOverrides } }) });
const props: PreviewProps = { reportId: 'sample', onLoaded: (count: number) => { void count; } };
// @ts-expect-error 参数必须为字符串字典
const invalidParams: PreviewProps = { params: 12 };
// @ts-expect-error loaded事件的参数必须为页数
const invalidLoaded: PreviewProps = { onLoaded: (_count: string) => {} };
declare const preview: InstanceType<typeof ReportPreview>;
preview.reload(); preview.getChanges?.(); preview.focusField?.({field:'name'});
// @ts-expect-error 页码必须为数字
preview.gotoPage('2');
declare const document: ReportTemplateDocument;
const editorProps: InstanceType<typeof ReportTemplateEditor>['$props'] = { modelValue: document };
const draftStorage: TemplateDraftStorage = {
  scope: 'compat:account', rememberView: true,
  adapter: { read: () => null, write: () => {}, remove: () => {} },
};
const legacyDraftStorage: TemplateDraftStorage = { scope: 'compat:legacy', adapter: draftStorage.adapter };
const rememberedEditor: InstanceType<typeof ReportTemplateEditor>['$props'] = { modelValue: document, draftStorage };
const wizard: InstanceType<typeof ExcelBindingWizard>['$props'] = { datasets: [{id:'detail',fields:[{field:'id',type:'text'}],rowKey:'id'}] };
const review: InstanceType<typeof TemplateReviewPanel>['$props'] = { document };
type RuleProps = InstanceType<typeof RuleEditor>['$props'];
declare const rule: RuleProps;
void [wizard, review, rule];
// @ts-expect-error 模板文档不能为数字
const invalidEditor: InstanceType<typeof ReportTemplateEditor>['$props'] = { modelValue: 12 };
declare const editor: InstanceType<typeof ReportTemplateEditor>;
editor.reset(); editor.guardChanges('reset');
void [invalidParams, invalidLoaded, invalidEditor, editorProps];
const input: ReportRuntimeInput = { reportIds: ['sample'], diagnosticLimit: 200, onEvent(event: ReportTaskEvent) { void event.stage; } };
// @ts-expect-error 诊断窗口必须为数字，范围由运行时校验
const invalidDiagnosticLimit: ReportRuntimeInput = { reportIds: ['sample'], diagnosticLimit: '200' };
const task: ReportPreviewTask | null = null;
const controller: MachReportController | null = null;
const execution: ReportExportExecutionOptions = { mode: 'worker', onDecision(decision) { void decision.hardCancellation; } };
const isolatedProps: PreviewProps = { reportId: 'sample', exportExecution: execution };
const history: ReportEditHistoryOptions = { maxSteps: 100, maxBytes: 8388608 };
const editing = createProviderEditing({ query: () => ({ datasets: {} }), save: async () => ({ revision: 'v2' }) }, {
  reportId: 'sample', history, fields: { quantity: { type: 'number', min: 0 } },
  canEdit: context => context.source?.field === 'quantity', readOnlyReason: () => 'Read-only business field',
});
const editingProps: PreviewProps = { reportId: 'sample', editable: editing };
const source: ReportQuerySource = { reportId: 'sample', reportIndex: 0, reportScope: '[0,"sample"]', revision: 'query-v1', sourceToken: 'query-token' };
const queryContext: ReportQueryContext = { queryId: 'query-1', reportIds: Object.freeze(['sample']), params: Object.freeze({ date: '2026-11-07' }), sources: Object.freeze([source]) };
const zeroConflict: ReportProviderConflict = { editIndex: 0, code: 'changed', message: 'Changed remotely', currentValue: 0, revision: 0 };
const nullConflict: ReportProviderConflict = { ...zeroConflict, currentValue: null, revision: 'remote-v2' };
const provider: ReportProvider = {
  query: context => ({ datasets: { detail: [{ quantity: 0 }] }, revision: context.reportId + '-v1', sourceToken: 'query-token' }),
  save: async request => { void request.expectedRevision; return { revision: 'saved-v2', conflicts: [zeroConflict, nullConflict] }; },
};
const automaticEditing = createProviderEditing(provider);
const automaticEditingProps: PreviewProps = { reportId: 'sample', editable: automaticEditing };
declare const edit: ReportCellEdit;
automaticEditing.save?.(edit, { signal: new AbortController().signal, query: queryContext });
// @ts-expect-error 已执行查询参数继续保持字符串字典
const invalidQueryParams: ReportQueryContext = { ...queryContext, params: { date: 20261107 } };
// @ts-expect-error 查询来源的修订号是字符串，数值修订仅用于明确支持的冲突/单元格协议
const invalidQueryRevision: ReportQuerySource = { ...source, revision: 1 };
// @ts-expect-error 冲突修订号只接受字符串或数字
const invalidConflictRevision: ReportProviderConflict = { ...zeroConflict, revision: false };
declare const plan: RenderPlan;
const outputIssue: OutputDiagnostic = { code: 'missing-image', severity: 'warning', format: 'xlsx', pageIndex: 0, componentIndex: 0, kind: 'image', message: 'Missing image' };
const summary: DiagnosticSummary<OutputDiagnostic> = { total: 3, counts: { 'missing-image': 3 }, entries: [outputIssue], omitted: 2 };
const inspected = inspectOutputCapabilitiesSummary(plan, 'xlsx', 200);
const sampledEntries: readonly OutputDiagnostic[] = inspected.entries;
// @ts-expect-error 诊断总数必须为数字
const invalidSummary: DiagnosticSummary<OutputDiagnostic> = { ...summary, total: '3' };
// @ts-expect-error 显式样本窗口必须为数字
inspectOutputCapabilitiesSummary(plan, 'xlsx', '200');
// @ts-expect-error 核心预检输出格式使用明确枚举
inspectOutputCapabilitiesSummary(plan, 'word', 200);
// @ts-expect-error 撤销步骤预算必须为数字
const invalidHistory: ReportEditHistoryOptions = { maxSteps: '100' };
void [props, input, task, controller, createReportRuntime, ReportTemplateEditor, isolatedProps, createNodeAutoReportExporter, editingProps, invalidHistory, draftStorage, legacyDraftStorage, rememberedEditor, automaticEditingProps, queryContext, zeroConflict, nullConflict, summary, sampledEntries, invalidDiagnosticLimit, invalidQueryParams, invalidQueryRevision, invalidConflictRevision, invalidSummary];
`);
  writeFileSync(resolve(scratch, "consumer.cts"), readFileSync(resolve(scratch, "consumer.mts"), "utf8"));
  writeFileSync(resolve(scratch, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext", target: "ES2022", lib: ["ES2022", "DOM", "DOM.Iterable"], strict: true, skipLibCheck: false, noEmit: true, types: [] }, files: ["consumer.mts", "consumer.cts"] }));
  console.log(run(node, [compilerRequire.resolve("typescript/bin/tsc"), "-p", "tsconfig.json"]));
  const entries = ["", "/pdf", "/xlsx", "/sql", "/server", "/server/node", "/worker", "/analytics", "/xlsx/node", "/vue", "/vue/async", "/designer", "/codes"];
  writeFileSync(resolve(scratch, "smoke.cjs"), `${entries.map((entry) => `require('@agile-team/mach-report${entry}');`).join("\n")}
(async()=>{
 const {createMemoryReportJobStore,createReportJobService}=require('@agile-team/mach-report/server');
 const service=createReportJobService({store:createMemoryReportJobStore(),now:()=>1000,handlers:{export:()=>null}});
 const input={scope:'compat',id:'cjs-job',kind:'export',payload:{zero:0,text:'中文'}};
 await service.submit(input); await service.runNext('cjs-worker');
 if((await service.prune({terminalBefore:1000})).archived!==1 || !(await service.submit(input)).archived) throw Error('CommonJS durable archive');
 await service.close(); console.log('CommonJS imports and durable SHA-256 archive OK');
 const {createReportRuntime}=require('@agile-team/mach-report/server');
 const {createTableTemplate}=require('@agile-team/mach-report');
 const {createNodeAutoReportExporter}=require('@agile-team/mach-report/server/node');
 const runtime=createReportRuntime({reports:{sample:{template:createTableTemplate({columns:[{field:'id',header:'ID'}]}),datasets:{detail:[{id:'0001'}]}}}});
 const automatic=createNodeAutoReportExporter({mode:'worker'});
 try { const file=await automatic.exportPrepared({prepared:await runtime.prepare({reportIds:['sample']}),format:'xlsx'});
 if(file.bytes[0]!==80 || file.execution.mode!=='worker') throw Error('CommonJS automatic encoding'); }
 finally { automatic.dispose(); }
})().catch(error=>{console.error(error);process.exitCode=1});`);
  writeFileSync(resolve(scratch, "smoke.mjs"), `
import { createSSRApp } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { ReportPreview, machReportPlugin } from '@agile-team/mach-report/vue';
import { createTableTemplate } from '@agile-team/mach-report';
import { createReportRuntime,createMemoryReportJobStore,createReportJobService } from '@agile-team/mach-report/server';
import { openFileReportJobStore, createNodeAutoReportExporter } from '@agile-team/mach-report/server/node';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
${entries.map((entry) => `await import('@agile-team/mach-report${entry}');`).join("\n")}
const template = createTableTemplate({columns:[{field:'id',header:'ID'}]});
const reports = {sample:{template,datasets:{detail:[{id:'0001'}]}}};
const runtime=createReportRuntime({reports});
const events=[];
const prepared=await runtime.prepare({reportIds:['sample'],onEvent:event=>events.push(event)});
if(prepared.stats.rows!==1 || !events.some(e=>e.stage==='layout'&&e.status==='completed')) throw Error('prepare contract');
const automatic=createNodeAutoReportExporter({mode:'worker'});
try { const file=await automatic.exportPrepared({prepared,format:'xlsx'});
 if(file.bytes[0]!==80 || file.execution.mode!=='worker' || !file.execution.hardCancellation) throw Error('ESM automatic encoding'); }
finally { automatic.dispose(); }
let workbook;
for(const format of ['pdf','xlsx']) {
 const result=await runtime.export({reportIds:['sample'],format});
 if(format==='xlsx') workbook=result.bytes;
 if(format==='pdf'?new TextDecoder().decode(result.bytes.slice(0,4))!=='%PDF':result.bytes[0]!==0x50) throw Error('binary export');
}
const xlsx=await import('@agile-team/mach-report/xlsx');
let supportsRaw=false; try { new DecompressionStream('deflate-raw'); supportsRaw=true; } catch { /* Older Node has an explicit safe-import boundary. */ }
if(supportsRaw) {
 const imported=await xlsx.importExcelTemplate(workbook);
 if(imported.sheets.length!==1 || !imported.template.pages.length) throw Error('Excel import roundtrip');
 console.log('Safe Excel import roundtrip OK');
} else {
 let message=''; try { await xlsx.importExcelTemplate(workbook); } catch(error) { message=error.message; }
 if(!message.includes('Node.js 22+')) throw Error('Missing explicit safe-import compatibility error: '+message);
 console.log('Safe Excel import: expected explicit deflate-raw compatibility error on this Node');
}
// Execute file scripts on the selected runtime: Node 18 has no global WebCrypto here.
const jobInput={scope:'compat',id:'archive-job',kind:'export',payload:{zero:0,text:'中文😀'}};
async function checkArchive(store){
 const service=createReportJobService({store,now:()=>1000,handlers:{export:()=>({reference:'artifact'})}});
 await service.submit(jobInput); await service.runNext('compat-worker');
 if((await service.prune({terminalBefore:1000})).archived!==1) throw Error('durable archive count');
 if(!(await service.submit(jobInput)).archived) throw Error('durable archive replay');
 let conflict=false; try{await service.submit({...jobInput,payload:{zero:1}})}catch(error){conflict=error.code==='conflict'}
 if(!conflict) throw Error('durable archive conflict');
 await service.close();
}
await checkArchive(createMemoryReportJobStore());
const directory=await mkdtemp(path.join(tmpdir(),'report-compat-jobs-'));
try{
 let store=await openFileReportJobStore({directory});
 await checkArchive(store); await store.close();
 store=await openFileReportJobStore({directory});
 const service=createReportJobService({store,now:()=>1000,handlers:{export:()=>null}});
 if(!(await service.submit(jobInput)).archived) throw Error('durable file archive restart');
 await service.close(); await store.close();
}finally{await rm(directory,{recursive:true,force:true})}
console.log('Durable memory/file SHA-256 archive, conflict and restart OK; global crypto='+typeof globalThis.crypto);
const app=createSSRApp(ReportPreview,{reportId:['sample'],autoLoad:false});
app.use(machReportPlugin,{reports});
const html=await renderToString(app);
if(!html.includes('mach-report')) throw Error('Vue SSR smoke failed');
console.log('ESM, runtime, real PDF/XLSX, Vue SSR OK');
`);
  console.log(run(node, ["smoke.cjs"]));
  console.log(run(node, ["smoke.mjs"]));
  const localRequire = createRequire(resolve(scratch, "package.json"));
  console.log(JSON.stringify({ node: run(node, ["--version"]), vue: JSON.parse(readFileSync(localRequire.resolve("vue/package.json"), "utf8")).version, matrix: "only this pair was executed, strict declarations included" }));
} finally { rmSync(scratch, { recursive: true, force: true }); }
