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
import { ReportPreview, type ReportPreviewTask, type MachReportController } from '@agile-team/mach-report/vue';
import { ReportTemplateEditor, ExcelBindingWizard, RuleEditor, TemplateReviewPanel } from '@agile-team/mach-report/designer';
import { createReportRuntime, type ReportRuntimeInput } from '@agile-team/mach-report/server';
import type { ReportTaskEvent, ReportTemplateDocument } from '@agile-team/mach-report';
type PreviewProps = InstanceType<typeof ReportPreview>['$props'];
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
const input: ReportRuntimeInput = { reportIds: ['sample'], onEvent(event: ReportTaskEvent) { void event.stage; } };
const task: ReportPreviewTask | null = null;
const controller: MachReportController | null = null;
void [props, input, task, controller, createReportRuntime, ReportTemplateEditor];
`);
  writeFileSync(resolve(scratch, "consumer.cts"), readFileSync(resolve(scratch, "consumer.mts"), "utf8"));
  writeFileSync(resolve(scratch, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext", target: "ES2022", lib: ["ES2022", "DOM", "DOM.Iterable"], strict: true, skipLibCheck: false, noEmit: true, types: [] }, files: ["consumer.mts", "consumer.cts"] }));
  console.log(run(node, [compilerRequire.resolve("typescript/bin/tsc"), "-p", "tsconfig.json"]));
  const entries = ["", "/pdf", "/xlsx", "/sql", "/server", "/server/node", "/worker", "/analytics", "/xlsx/node", "/vue", "/vue/async", "/designer"];
  writeFileSync(resolve(scratch, "smoke.cjs"), `${entries.map((entry) => `require('@agile-team/mach-report${entry}');`).join("\n")}\nconsole.log('CommonJS OK');`);
  writeFileSync(resolve(scratch, "smoke.mjs"), `
import { createSSRApp } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { ReportPreview, machReportPlugin } from '@agile-team/mach-report/vue';
import { createTableTemplate } from '@agile-team/mach-report';
import { createReportRuntime } from '@agile-team/mach-report/server';
${entries.map((entry) => `await import('@agile-team/mach-report${entry}');`).join("\n")}
const template = createTableTemplate({columns:[{field:'id',header:'ID'}]});
const reports = {sample:{template,datasets:{detail:[{id:'0001'}]}}};
const runtime=createReportRuntime({reports});
const events=[];
const prepared=await runtime.prepare({reportIds:['sample'],onEvent:event=>events.push(event)});
if(prepared.stats.rows!==1 || !events.some(e=>e.stage==='layout'&&e.status==='completed')) throw Error('prepare contract');
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
const app=createSSRApp(ReportPreview,{reportIds:['sample'],autoLoad:false});
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
