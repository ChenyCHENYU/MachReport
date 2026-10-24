import type { PlanComponent, RichParagraph } from "../schema/render-plan";
import type { ReportRuntimePreparedExportInput } from "../server/types";
import type { ReportExportDecision, ReportExportExecutionOptions, ReportExportThresholds } from "./auto-types";

const DEFAULT_THRESHOLDS = { cells: 20_000, pages: 20, bytes: 2_000_000 };
interface Scan { cells: number; pages: number; bytes: number; visits: number; capped: boolean; limits: Required<ReportExportThresholds> }
function exceeded(scan: Scan): boolean { return scan.cells >= scan.limits.cells || scan.pages >= scan.limits.pages || scan.bytes >= scan.limits.bytes || scan.capped; }
function visit(scan: Scan): boolean { if (++scan.visits >= 100_000) scan.capped = true; return !exceeded(scan); }
function textBytes(value: unknown): number { return typeof value === "string" ? value.length * 2 : 0; }
function richBytes(paragraphs: RichParagraph[] | undefined, scan: Scan): void {
  for (const paragraph of paragraphs ?? []) {
    if (!visit(scan)) return;
    for (const segment of paragraph.segments) {
      if (!visit(scan)) return;
      scan.bytes += textBytes(segment.text);
    }
  }
}
function scanComponent(component: PlanComponent, scan: Scan, depth: number): void {
  if (depth > 32) { scan.capped = true; return; }
  if (!visit(scan)) return;
  scan.bytes += textBytes(component.text) + textBytes(component.rawText) + textBytes(component.imageData);
  richBytes(component.richParagraphs, scan);
  for (const line of component.lines ?? []) { if (!visit(scan)) return; scan.bytes += textBytes(line); }
  for (const row of component.grid?.cells ?? []) {
    if (!visit(scan)) return;
    for (const cell of row) {
      if (!visit(scan)) return;
      if (!cell) continue;
      scan.cells++; scan.bytes += textBytes(cell.text) + textBytes(cell.rawText) + textBytes(cell.value);
      richBytes(cell.richParagraphs, scan);
      for (const child of cell.children ?? []) { if (exceeded(scan)) return; scanComponent(child, scan, depth + 1); }
    }
  }
}
function thresholds(options: ReportExportExecutionOptions): Required<ReportExportThresholds> {
  const limits = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
  for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError("导出隔离阈值应为正安全整数");
  return limits;
}
/** Bounded metadata scan: at most 100k nodes; content is measured by length, never serialized or hashed. */
export function decideReportExport(input: ReportRuntimePreparedExportInput, options: ReportExportExecutionOptions): ReportExportDecision {
  const limits = thresholds(options);
  const fonts = input.pdf?.customFontFaces ? Object.values(input.pdf.customFontFaces) : [input.pdf?.customFontBytes];
  const scan: Scan = { pages: input.prepared.plan.pages.length, cells: 0, bytes: fonts.reduce((sum, font) => sum + (font?.byteLength ?? 0), 0), visits: 0, capped: false, limits };
  for (const page of input.prepared.plan.pages) {
    if (exceeded(scan)) break;
    for (const component of page.components) { if (exceeded(scan)) break; scanComponent(component, scan, 0); }
  }
  let mode: ReportExportDecision["mode"] = exceeded(scan) ? "worker" : "local";
  let reason: ReportExportDecision["reason"] = scan.capped ? "scan-limit" : mode === "worker" ? "threshold" : "small-task";
  if (options.mode === "local") { mode = "local"; reason = "explicit-local"; }
  if (options.mode === "worker") { mode = "worker"; reason = "explicit-worker"; }
  if (Object.values(input.xlsx ?? {}).some(value => typeof value === "function")) { mode = "local"; reason = "nonserializable-options"; }
  return { mode, reason, estimate: { pages: scan.pages, cells: scan.cells, bytes: scan.bytes }, hardCancellation: mode === "worker" };
}
