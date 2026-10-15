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
  run("pnpm", ["--filter", "@agile-team/mach-report", "pack", "--pack-destination", scratch], root);
  const archive = readdirSync(scratch).find((name) => name.endsWith(".tgz"));
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
if (typeof vue.useMachReport !== "function" || typeof vue.createTableTemplate !== "function" || typeof asyncVue.preloadMachReport !== "function") throw new Error("Missing Vue runtime API");
`;
  writeFileSync(resolve(scratch, "smoke.mjs"), `import * as core from "@agile-team/mach-report";\nimport * as pdf from "@agile-team/mach-report/pdf";\nimport * as xlsx from "@agile-team/mach-report/xlsx";\nimport * as sql from "@agile-team/mach-report/sql";\nimport * as vue from "@agile-team/mach-report/vue";\nimport * as asyncVue from "@agile-team/mach-report/vue/async";\n${runtime}`);
  writeFileSync(resolve(scratch, "smoke.cjs"), `const core = require("@agile-team/mach-report");\nconst pdf = require("@agile-team/mach-report/pdf");\nconst xlsx = require("@agile-team/mach-report/xlsx");\nconst sql = require("@agile-team/mach-report/sql");\nconst vue = require("@agile-team/mach-report/vue");\nconst asyncVue = require("@agile-team/mach-report/vue/async");\n(async () => {${runtime}})().catch(error => { console.error(error); process.exitCode = 1; });`);
  run(process.execPath, ["smoke.mjs"]);
  run(process.execPath, ["smoke.cjs"]);

  const consumer = `import { createTemplate, paginateTemplate } from "@agile-team/mach-report";
import { renderPlanToXlsx } from "@agile-team/mach-report/xlsx";
import { renderPlanToPdf } from "@agile-team/mach-report/pdf";
import { compileDynamicSql } from "@agile-team/mach-report/sql";
import { machReportPlugin, ReportPreview, createTemplate as createVueTemplate, createTableTemplate, createReportSource, defineReport, defineReportTemplate, parseReportTemplate, serializeReportTemplate, createTemplateRegistry, defineMachReportConfig, useMachReport, type PdfFontCheckResult, type MachReportToolbarOptions, type ReportEmptyState, type ReportPreviewPreferences } from "@agile-team/mach-report/vue";
import { preloadMachReport } from "@agile-team/mach-report/vue/async";
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
  console.log("Packed npm consumer checked: ESM/CJS runtime, XLSX/PDF bytes, all public TypeScript entries, licensing and README");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
