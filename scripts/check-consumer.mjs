import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = resolve(root, "packages/mach-report");
const scratch = mkdtempSync(resolve(tmpdir(), "mach-report-consumer-"));
const packageRequire = createRequire(resolve(packageDir, "package.json"));

function run(command, args, cwd = scratch) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} failed:\n${result.stdout ?? ""}${result.stderr ?? ""}${result.error ?? ""}`);
}

try {
  const providedArchive = process.argv[2];
  if (!providedArchive) run("pnpm", ["--filter", "@agile-team/mach-report", "pack", "--pack-destination", scratch], root);
  const archive = providedArchive ? resolve(providedArchive) : readdirSync(scratch).find((name) => name.endsWith(".tgz"));
  if (!archive) throw new Error("Missing packed npm archive");
  run("tar", ["-xzf", resolve(scratch, archive)]);
  const extracted = resolve(scratch, "package");
  const manifest = JSON.parse(readFileSync(resolve(extracted, "package.json"), "utf8"));
  if (!manifest.exports["."].import.default.startsWith("./dist/")) throw new Error("Packed exports still point to source");
  for (const file of ["README.md", "LICENSE", "LICENSING.md"]) readFileSync(resolve(extracted, file), "utf8");
  if (/\]\(\.\/|\b(?:src|href)="\.\//.test(readFileSync(resolve(extracted, "README.md"), "utf8"))) throw new Error("Packed README has relative repository links");

  mkdirSync(resolve(scratch, "node_modules/@agile-team"), { recursive: true });
  symlinkSync(extracted, resolve(scratch, "node_modules/@agile-team/mach-report"), "dir");
  // 模拟公开的类型依赖与可选 Vue peer；刻意不安装 ExcelJS/PDF/SQL 源依赖。
  mkdirSync(resolve(scratch, "node_modules/@types"), { recursive: true });
  const nodeTypes = dirname(packageRequire.resolve("@types/node/package.json"));
  symlinkSync(nodeTypes, resolve(scratch, "node_modules/@types/node"), "dir");
  const nodeTypesRequire = createRequire(resolve(nodeTypes, "package.json"));
  symlinkSync(dirname(nodeTypesRequire.resolve("undici-types/package.json")), resolve(scratch, "node_modules/undici-types"), "dir");
  const frameworkFreeEntries = ["", "/pdf", "/xlsx", "/sql", "/server", "/server/node", "/worker", "/analytics", "/xlsx/node"];
  writeFileSync(resolve(scratch, "without-vue.mjs"), frameworkFreeEntries.map((path) => `await import("@agile-team/mach-report${path}");`).join("\n"));
  writeFileSync(resolve(scratch, "without-vue.cjs"), frameworkFreeEntries.map((path) => `require("@agile-team/mach-report${path}");`).join("\n"));
  run(process.execPath, ["without-vue.mjs"]);
  run(process.execPath, ["without-vue.cjs"]);
  symlinkSync(dirname(packageRequire.resolve("vue/package.json")), resolve(scratch, "node_modules/vue"), "dir");

  const runtime = `
const template = core.createTemplate().page("a4").text("Consumer", { leftMm: 10, topMm: 10, widthMm: 80, heightMm: 8 }).build();
const { plan } = core.paginateTemplate(template, {});
const tableTemplate = core.createTableTemplate({ title: "Consumer", columns: [{ header: "Name", field: "name" }, { header: "Qty", field: "qty", widthMm: 25 }] });
const tablePlan = core.paginateTemplate(tableTemplate, { detail: [{ name: "Item", qty: 3 }] }).plan;
if (!tablePlan.pages[0]?.components.some(c => c.grid)) throw new Error("Missing standard table output");
const document = core.defineReportTemplate({ id: "managed", name: "Managed", revision: "1", template: tableTemplate });
const templates = core.createTemplateRegistry([core.parseReportTemplate(core.serializeReportTemplate(document))]);
const managed = core.createReportSource({ managed: { template: () => templates.get("managed").template, load: () => ({ detail: [{ name: "00123", qty: 3 }] }) } });
const managedPlan = await managed({ reportIds: ["managed"], params: {} });
const managedGrids = managedPlan.pages[0].components.filter(c => c.grid).map(c => c.grid);
if (managedGrids[0].cells[0][0].style.align !== "center" || managedGrids[1].cells[0][1].style.align !== "right") throw new Error("Missing independent automatic alignment");
const rawExcel = await xlsx.renderPlanToXlsx(managedPlan, { valueMode: "raw", paperSize: "auto" });
if (rawExcel.workbook.worksheets[0].getCell("B3").value !== 3) throw new Error("Raw Excel number was lost");
const wideColumns = Array.from({ length: 82 }, (_, index) => ({ header: "Column " + index, field: "c" + index }));
const wideTemplate = core.createTableTemplate({ layout: "wide", title: "Wide Consumer", columns: wideColumns });
const wideRows = Array.from({ length: 100 }, (_, row) => Object.fromEntries(wideColumns.map((column, col) => [column.field, row * 1000 + col])));
const widePlan = core.paginateTemplate(wideTemplate, { detail: wideRows }).plan;
if (widePlan.pages.length < 2 || widePlan.pages[0].layout !== "wide" || widePlan.pages[0].pageWidthMm < 2400) throw new Error("Wide template lost natural column widths");
const wideExcel = await xlsx.renderPlanToXlsx(widePlan, { sheetMode: "auto", paperSize: "a3" });
const wideSheet = wideExcel.workbook.worksheets[0];
if (wideExcel.workbook.worksheets.length !== 1 || wideSheet.columnCount !== 82 || wideSheet.rowCount !== 102 || wideSheet.getCell(102, 82).value !== 99081) throw new Error("Continuous Excel lost wide columns or logical rows");
if (wideSheet.pageSetup.paperSize !== 8 || wideExcel.warnings.length) throw new Error("Optional A3 printing was lost");
const source = core.createReportSource({ consumer: core.defineReport({ template, load: () => ({}) }) });
const loaded = await source({ reportIds: ["consumer"], params: {} });
if (loaded.pages.length !== plan.pages.length) throw new Error("Invalid report source output");
const pdfResult = await pdf.renderPlanToPdf(plan);
const xlsxResult = await xlsx.renderPlanToXlsx(plan);
if (new TextDecoder().decode(pdfResult.bytes.slice(0, 5)) !== "%PDF-") throw new Error("Invalid PDF");
if (new Uint8Array(xlsxResult.buffer)[0] !== 0x50) throw new Error("Invalid XLSX");
if (typeof sql.compileDynamicSql !== "function") throw new Error("Missing SQL API");
if (typeof vue.useMachReport !== "function" || typeof vue.createTableTemplate !== "function" || typeof vue.createProviderEditing !== "function" || typeof asyncVue.preloadMachReport !== "function") throw new Error("Missing Vue runtime API");
const contract = { rowKey: "id", fields: [{ field: "id", type: "text", semanticRole: "identifier" }, { field: "qty", type: "number", required: true }] };
if (!core.validateDatasetRows([{ id: "0001", qty: 0 }], contract).ok || core.columnsFromContract(contract)[0].semanticRole !== "identifier") throw new Error("Invalid data contract runtime");
const runtime = server.createReportRuntime({ reports: { sample: { template: tableTemplate, datasets: { detail: [{ name: "0001", qty: 0 }] } } } });
const prepared = await runtime.prepare({ reportIds: ["sample"] });
const remoteExcel = await runtime.export({ reportIds: ["sample"], format: "xlsx" });
if (!prepared.stats.pages || remoteExcel.bytes[0] !== 0x50 || remoteExcel.stats.outputBytes !== remoteExcel.bytes.byteLength) throw new Error("Invalid Node runtime/export");
const collected = [];
const destination = new nodeStream.Writable({ write(chunk, _encoding, done) { collected.push(Buffer.from(chunk)); done(); } });
await nodeXlsx.writeRowsToXlsx((async function* () { yield { id: "0001", qty: 0 }; yield { id: "0002", qty: 2 }; })(), { stream: destination, columns: [{ key: "id" }, { key: "qty" }], batchSize: 1 });
if (Buffer.concat(collected).subarray(0, 2).toString() !== "PK") throw new Error("Node streaming entry resolved the browser ExcelJS build");
const manager = core.createTemplateManager(core.createMemoryTemplateStore());
const draft = await manager.saveDraft(document, { expectedRevision: null });
const published = await manager.publish(document.id, { expectedRevision: draft.revision });
if ((await manager.get(document.id)).revision !== published.revision || (await manager.history(document.id)).length !== 1) throw new Error("Invalid template manager");
if (typeof designer.ReportTemplateEditor !== "object" || typeof worker.createBrowserReportExecutor !== "function") throw new Error("Missing optional UI/Worker entry");
const calculated = analytics.computeDataset([{ qty: 2 }], { fields: [{ field: "amount", expression: { op: "multiply", args: [{ field: "qty" }, { value: 3 }] } }] });
if (calculated.rows[0].amount !== 6) throw new Error("Invalid analytics entry");
if (analytics.aggregateRows([{ n: "0.10" }, { n: "0.20" }], { op: "sum", field: "n", numeric: "decimal", digits: 2 }) !== "0.30") throw new Error("Exact decimal aggregation was lost");
if ([...core.paginateTemplatePages(tableTemplate, { detail: [{ name: "Item", qty: 0 }] })].length !== core.countTemplatePages(tableTemplate, { detail: [{ name: "Item", qty: 0 }] })) throw new Error("Incremental pagination mismatch");
const reviewed = await server.reviewReportPublication(document, { fixtures: [{ name: "sample", datasets: { detail: [{ name: "Item", qty: 0 }] } }], formats: ["xlsx"], digest: nodeServer.reportArtifactSha256 });
if (!reviewed.ok || reviewed.artifacts[0]?.digest?.length !== 64) throw new Error("Packed publication gate failed");
const durable = await nodeServer.openFileReportJobStore({ directory: ${JSON.stringify(resolve(scratch, "durable"))} });
const jobs = server.createReportJobService({ store: durable, handlers: { test: () => ({ artifactId: "saved" }) } });
await jobs.submit({ scope: "consumer", id: "one", kind: "test", payload: { value: 0 } });
await jobs.runNext("worker");
if ((await jobs.get("consumer", "one"))?.status !== "completed") throw new Error("Packed durable job adapter failed");
await jobs.close(); await durable.close();
if (typeof designer.ExcelBindingWizard !== "object" || typeof designer.TemplateReviewPanel !== "object" || typeof designer.RuleEditor !== "object" || typeof xlsx.inspectExcelWorkbook !== "function" || typeof xlsx.createExcelBindingDocument !== "function") throw new Error("Missing designer/binding public API");
const executor = nodeServer.createNodeReportExecutor({ filename: new URL("./worker-fixture.mjs", import.meta.url) });
const isolated = await executor.prepare({ reportIds: ["worker"] });
if (!isolated.plan.pages.length) throw new Error("Packed Node Worker did not return a plan");
`;
  const entries = { core: "", pdf: "/pdf", xlsx: "/xlsx", sql: "/sql", vue: "/vue", asyncVue: "/vue/async", server: "/server", nodeServer: "/server/node", nodeXlsx: "/xlsx/node", worker: "/worker", designer: "/designer", analytics: "/analytics" };
  const esmImports = Object.entries(entries).map(([name, path]) => `import * as ${name} from "@agile-team/mach-report${path}";`).join("\n");
  const cjsImports = Object.entries(entries).map(([name, path]) => `const ${name} = require("@agile-team/mach-report${path}");`).join("\n");
  writeFileSync(resolve(scratch, "worker-fixture.mjs"), `import { createTableTemplate } from "@agile-team/mach-report"; import { createReportRuntime } from "@agile-team/mach-report/server"; import { serveNodeReportWorker } from "@agile-team/mach-report/server/node"; serveNodeReportWorker(createReportRuntime({ reports: { worker: { template: createTableTemplate({ columns: [{ header: "ID", field: "id" }] }), datasets: { detail: [{ id: "0001" }] } } } }));`);
  writeFileSync(resolve(scratch, "smoke.mjs"), `${esmImports}\nimport * as nodeStream from "node:stream";\n${runtime}`);
  writeFileSync(resolve(scratch, "smoke.cjs"), `${cjsImports}\nconst nodeStream = require("node:stream");\n(async () => {${runtime.replace('new URL("./worker-fixture.mjs", import.meta.url)', 'require("node:path").resolve(__dirname, "worker-fixture.mjs")')}})().catch(error => { console.error(error); process.exitCode = 1; });`);
  run(process.execPath, ["smoke.mjs"]);
  run(process.execPath, ["smoke.cjs"]);

  const consumer = `import { createTemplate, paginateTemplate, paginateTemplatePages, reviewReportTemplate } from "@agile-team/mach-report";
import { renderPlanToXlsx } from "@agile-team/mach-report/xlsx";
import { renderPlanToPdf } from "@agile-team/mach-report/pdf";
import { compileDynamicSql } from "@agile-team/mach-report/sql";
import { machReportPlugin, ReportPreview, createTemplate as createVueTemplate, createTableTemplate, createReportSource, defineReport, defineReportTemplate, parseReportTemplate, serializeReportTemplate, createTemplateRegistry, defineMachReportConfig, useMachReport, type PdfFontCheckResult, type MachReportToolbarOptions, type ReportEmptyState, type ReportPreviewPreferences } from "@agile-team/mach-report/vue";
import { preloadMachReport } from "@agile-team/mach-report/vue/async";
import { createReportRuntime, createReportTaskQueue, reviewReportPublication, createReportJobService, createMemoryReportJobStore } from "@agile-team/mach-report/server";
import { createNodeReportExecutor, reportArtifactSha256 } from "@agile-team/mach-report/server/node";
import { createBrowserReportExecutor } from "@agile-team/mach-report/worker";
import { writeRowsToXlsx } from "@agile-team/mach-report/xlsx/node";
import { ReportTemplateEditor, ExcelBindingWizard, RuleEditor, TemplateReviewPanel, type TemplateEditorOptions, type TemplateEditorMessages } from "@agile-team/mach-report/designer";
import { computeDataset, createCrossTable, createChartComponents } from "@agile-team/mach-report/analytics";
import { Writable } from "node:stream";
async function consume() {
  const builder: ReturnType<typeof createTemplate> = createVueTemplate();
  const definition = defineReport({
    template: builder.page("a4").build(),
    load: async ({ params, signal }) => ({ items: [{ name: params.name, qty: signal?.aborted ? 0 : 3 }] }),
    mapData: (data) => ({ detail: data.items })
  });
  const source = createReportSource({ sample: definition });
  await source({ reportIds: ["sample"], params: {} });
  const toolbar: MachReportToolbarOptions = { editing: false, excelImport: false, exportFormats: ["xlsx", "pdf"] };
  const emptyState: ReportEmptyState = { title: "No rows", description: "Change the query" };
  const previewProps: InstanceType<typeof ReportPreview>["$props"] = { showSettings: true, toolbar, emptyState, "onPreferences-change": (preferences: Readonly<ReportPreviewPreferences>) => { void preferences.search; } };
  const config = defineMachReportConfig({ defaults: { pdfFontUrl: "/report.otf", showSettings: true, toolbar, preview: { overscanPages: 1 }, xlsx: { valueMode: "raw", sheetMode: "auto", paperSize: "auto" } } });
  const report = useMachReport();
  const { state } = report;
  const loading: boolean = state.loading;
  const fontResult: PdfFontCheckResult = await report.checkPdfFont();
  const simple = createTableTemplate({ title: "Consumer", columns: [{ header: "Name", field: "name", flex: 2, align: "left", headerAlign: "center" }] });
  const wide = createTableTemplate({ layout: "wide", columnWidthMm: 28, columns: [{ header: "Qty", field: "qty" }] });
  await renderPlanToXlsx(paginateTemplate(wide, { detail: [{ qty: 0 }] }).plan, { sheetMode: "continuous", paperSize: "a4" });
  const document = defineReportTemplate({ id: "managed", name: "Managed", template: simple });
  const templates = createTemplateRegistry([parseReportTemplate(serializeReportTemplate(document))]);
  const dynamic = createReportSource({ managed: { template: async () => templates.get("managed")!.template } });
  await dynamic({ reportIds: ["managed"], params: {} });
  void [loading, fontResult, simple, previewProps];
  const exportJob: Promise<void> = report.exportAs("xlsx");
  void exportJob;
  const { plan } = paginateTemplate(createTemplate().page("a4").build(), {});
  const result = await renderPlanToXlsx(plan);
  result.workbook.addWorksheet("custom").getCell("A1").value = 42;
  result.workbook.getWorksheet(1)?.getCell("A1").value;
  await result.workbook.xlsx.writeBuffer();
  const bytes: ArrayBuffer = result.buffer;
  await renderPlanToPdf(plan);
  compileDynamicSql("select 1");
  const runtime = createReportRuntime({ reports: { sample: definition }, budget: { maxPages: 100 } });
  await runtime.prepare({ reportIds: ["sample"], params: {} });
  const queue = createReportTaskQueue({ concurrency: 2, maxQueued: 4 });
  void queue;
  createNodeReportExecutor({ filename: "/worker.mjs" });
  createBrowserReportExecutor(() => new Worker("/worker.js"));
  await writeRowsToXlsx([{ id: "0001" }], { columns: [{ key: "id" }], stream: new Writable({ write(_chunk, _encoding, done) { done(); } }) });
  const editorOptions: TemplateEditorOptions = { modelValue: document, datasets: { detail: [] }, preview: { showExport: false, theme: { shellBg: "#fff" }, assets: { assetRenderers: { qrcode: ({ component }) => component.imageData ?? "data:image/png;base64," } } }, save: async (draft, context) => ({ ...draft, revision: context.expectedRevision }) };
  const editorProps: InstanceType<typeof ReportTemplateEditor>["$props"] = editorOptions;
  const reviewProps: InstanceType<typeof TemplateReviewPanel>["$props"] = { document, datasets: { detail: [] } };
  const wizardProps: InstanceType<typeof ExcelBindingWizard>["$props"] = { datasets: [{ id: "detail", rowKey: "name", fields: [{ field: "name", type: "text" }] }] };
  const list = document.template.pages[0]!.components.find(item => item.kind === "list");
  if (list?.kind === "list") { const rules: InstanceType<typeof RuleEditor>["$props"] = { list }; void rules; }
  for (const page of paginateTemplatePages(document.template, { detail: [] }, { maxCells: 1000 })) void page;
  reviewReportTemplate(document, { fixtures: [{ name: "sample", datasets: { detail: [] } }] });
  await reviewReportPublication(document, { fixtures: [{ name: "sample", datasets: { detail: [] } }], digest: reportArtifactSha256 });
  const jobs = createReportJobService({ store: createMemoryReportJobStore(), handlers: { sample: () => null } });
  await jobs.submit({ scope: "test", id: "one", kind: "sample", payload: {} }); await jobs.close();
  void [reviewProps, wizardProps];
  const legacyEditorMessages: TemplateEditorMessages = {
    title: "Editor", heading: "Properties", unpublished: "Unpublished", dirty: "Unsaved",
    reset: "Reset", saving: "Saving", save: "Save", name: "Name", description: "Description",
    area: "Area", page: "Page", header: "Header", field: "Field", width: "Width",
    semantic: "Semantic", identifier: "ID", dimension: "Dimension", measure: "Measure", date: "Date", text: "Text",
    bodyAlign: "Body", headerAlign: "Header", auto: "Auto", left: "Left", center: "Center", right: "Right", justify: "Justify",
    editable: "Editable", json: "JSON", applyJson: "Apply", note: "Note", invalid: "Invalid"
  };
  const compatibleEditorMessages: TemplateEditorMessages = { ...legacyEditorMessages, undo: "Undo" };
  // @ts-expect-error Message overrides remain strings even when newly optional.
  const invalidEditorMessages: TemplateEditorMessages = { ...legacyEditorMessages, undo: 123 };
  void [compatibleEditorMessages, invalidEditorMessages];
  const computed = computeDataset([{ value: 1 }], { fields: [{ field: "copy", expression: { field: "value" } }] });
  createCrossTable(computed.rows, { rowField: "value", columnField: "copy", aggregate: "count" });
  createChartComponents({ type: "bar", categories: ["A"], series: [{ name: "Q", values: [0] }], leftMm: 0, topMm: 0, widthMm: 100, heightMm: 50 });
  void editorProps;
  return { bytes, machReportPlugin, preloadMachReport, config, report };
}
void consume;
`;
  for (const [extension, module, moduleResolution] of [["mts", "ESNext", "Bundler"], ["cts", "Node16", "Node16"]]) {
    const file = `consumer.${extension}`;
    writeFileSync(resolve(scratch, file), consumer);
    const config = `tsconfig-${extension}.json`;
    writeFileSync(resolve(scratch, config), JSON.stringify({ compilerOptions: { target: "ES2020", module, moduleResolution, strict: true, noEmit: true, skipLibCheck: false, esModuleInterop: true, types: [], lib: ["ES2020", "DOM", "DOM.Iterable"] }, files: [file] }));
    run(process.execPath, [resolve(root, "node_modules/typescript/bin/tsc"), "-p", config]);
  }
  console.log("Packed npm consumer checked: Vue-free core/Node entries, ESM/CJS runtime, real Worker/streaming XLSX/PDF bytes, all public TypeScript entries, licensing and README");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
