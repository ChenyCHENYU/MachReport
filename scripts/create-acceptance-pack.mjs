import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { BarcodeFormat, BinaryBitmap, DecodeHintType, HybridBinarizer, MultiFormatReader, RGBLuminanceSource } from "@zxing/library";
import { acceptanceFixtures } from "./acceptance-fixtures.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(root, "packages/mach-report/package.json"), "utf8"));
const option = process.argv.slice(2).find(argument => argument.startsWith("--out="));
const out = option ? resolve(option.slice(6)) : mkdtempSync(resolve(tmpdir(), `mach-report-acceptance-${manifest.version}-`));
mkdirSync(out, { recursive: true });
if (readdirSync(out).length) throw new Error("Acceptance output directory must be empty; existing evidence is never overwritten.");
const core = await import("../packages/mach-report/dist/index.js");
const { renderPlanToPdf } = await import("../packages/mach-report/dist/pdf.js");
const { renderPlanToXlsx } = await import("../packages/mach-report/dist/xlsx.js");
const codes = await import("../packages/mach-report/dist/codes.js");
const require = createRequire(resolve(root, "packages/mach-report/package.json"));
const ExcelJS = require("exceljs"), { decode } = require("fast-png"), { PDFDocument } = require("pdf-lib");
const fixtures = await acceptanceFixtures(core, codes);
const font = new Uint8Array(readFileSync(resolve(root, "examples/minimal/public/fonts/mach-report-demo.otf")));
const samples = [], window = new Window();
function save(name, bytes) {
  writeFileSync(resolve(out, name), bytes);
  samples.push({ file: name, bytes: Buffer.byteLength(bytes), sha256: createHash("sha256").update(bytes).digest("hex") });
}
function decoded(data, format) {
  const png = decode(Buffer.from(data.split(",")[1], "base64"), { checkCrc: true });
  const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [format]], [DecodeHintType.CHARACTER_SET, "UTF-8"]]);
  return new MultiFormatReader().decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(new Uint8ClampedArray(png.data), png.width, png.height))), hints).getText();
}
try {
  if (decoded(fixtures.qr, BarcodeFormat.QR_CODE) !== fixtures.trace || decoded(fixtures.barcode, BarcodeFormat.CODE_128) !== fixtures.serial) throw new Error("Independent code decoding failed");
  for (const [name, plan] of Object.entries(fixtures.plans)) {
    core.assertRenderPlan(plan);
    const pdf = await renderPlanToPdf(plan, { fidelity: "strict", ...(name === "05-chinese-font" ? { customFontBytes: font } : {}) });
    const readPdf = await PDFDocument.load(pdf.bytes);
    if (readPdf.getPageCount() !== plan.pages.length) throw new Error("PDF page count mismatch");
    for (const [index, page] of plan.pages.entries()) {
      const size = readPdf.getPage(index).getSize();
      if (Math.abs(size.width - page.pageWidthMm * 72 / 25.4) > 0.01 || Math.abs(size.height - page.pageHeightMm * 72 / 25.4) > 0.01) throw new Error("PDF physical size mismatch");
    }
    save(`${name}.pdf`, pdf.bytes);
    const rendered = core.renderPlan(plan, window.document);
    const rules = plan.pages.map((page, index) => { rendered.children[index].style.page = `sample${index}`; return `@page sample${index}{size:${page.pageWidthMm}mm ${page.pageHeightMm}mm;margin:0}`; }).join("\n");
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${name}</title><style>@font-face{font-family:MachReportAcceptance;src:url(acceptance-demo.otf)}body{margin:0}.mr-page{break-after:page}${rules}</style></head><body>${rendered.outerHTML}</body></html>`;
    save(`${name}.html`, html);
    if (name === "01-scalars") save("01-scalars.doc", html);
    if (["01-scalars", "02-rich-nested"].includes(name)) {
      const workbook = await renderPlanToXlsx(plan, { fidelity: "strict", valueMode: "raw" });
      const read = new ExcelJS.Workbook(); await read.xlsx.load(workbook.buffer);
      let checked = false;
      read.worksheets[0].eachRow(row => {
        if (name === "01-scalars" && row.getCell(1).value === "000001") checked = row.getCell(2).value === 0 && row.getCell(4).value === fixtures.rows[0].exact;
        row.eachCell(cell => { if (name === "02-rich-nested" && cell.value?.richText?.map(run => run.text).join("") === "Value 42") checked = read.worksheets[0].getImages().length === 1; });
      });
      if (!checked) throw new Error(`${name} workbook content readback failed`);
      save(`${name}.xlsx`, new Uint8Array(workbook.buffer));
    }
    save(`${name}.plan.json`, `${JSON.stringify(plan, null, 2)}\n`);
  }
  save("qr-203dpi.png", Buffer.from(fixtures.qr.split(",")[1], "base64"));
  save("code128-203dpi.png", Buffer.from(fixtures.barcode.split(",")[1], "base64"));
  save("acceptance-demo.otf", font);
  save("FONT-OFL.txt", readFileSync(resolve(root, "examples/minimal/public/fonts/OFL.txt")));
  save("synthetic-data.json", `${JSON.stringify(fixtures.rows, null, 2)}\n`);
  copyFileSync(resolve(root, "docs/EXTERNAL_ACCEPTANCE.md"), resolve(out, "验收说明.md"));
  const checks = ["excel-scalars", "excel-rich-content", "word-html-compatibility", "chinese-font", "label-physical-size", "label-qr-scan", "label-code128-scan", "browser-print-calibration", "screen-reader-keyboard-flow"];
  writeFileSync(resolve(out, "results.json"), `${JSON.stringify({ sdkVersion: manifest.version, status: "not-run", operator: "", performedAt: "", environment: { os: "", office: "", browser: "", printer: "", scanner: "", screenReader: "" }, checks: checks.map(id => ({ id, passed: null, evidence: "", note: "" })) }, null, 2)}\n`);
  writeFileSync(resolve(out, "manifest.json"), `${JSON.stringify({ sdkVersion: manifest.version, generatedAt: new Date().toISOString(), synthetic: true, manualAcceptance: "not-run", machineChecks: { strictPdf: true, xlsxReadback: true, independentQrAndBarcodeDecoding: true }, expected: { firstId: "000001", firstQuantity: 0, secondQuantity: null, exactDecimal: fixtures.rows[0].exact, qr: fixtures.trace, code128: fixtures.serial, labelMm: [80, 55] }, samples }, null, 2)}\n`);
  console.log(`Acceptance pack checked: ${samples.length} files; strict PDF, real XLSX readback, independently decoded QR/Code128. Manual Office/device/screen-reader status: not-run.\n${out}`);
} finally { await window.happyDOM.close(); }
