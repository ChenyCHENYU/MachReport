import { hasValidDataExplanation } from "../source/data-explanation";
import { snapshotReportJson } from "../schema/json-snapshot";
import type { PreparedReport, ReportPdfFontOptions, ReportRuntimeExportInput, ReportRuntimePreparedExportInput } from "./types";
import { ReportSourceError } from "../source/report-source";
import { portableSha256Hex } from "./sha256";
import { ReportRuntimeError, throwIfAborted } from "./control";

/** Encoding settings are scalar declarations; capture them before any async boundary. */
export function snapshotXlsxOptions(options: ReportRuntimeExportInput["xlsx"]): ReportRuntimeExportInput["xlsx"] {
  return options && { ...options };
}

export function snapshotPdfFonts(pdf?: ReportPdfFontOptions): ReportPdfFontOptions | undefined {
  if (!pdf) return;
  const copy = (source: Uint8Array | ArrayBuffer): Uint8Array => {
    if (!(source instanceof Uint8Array) && !(source instanceof ArrayBuffer)) throw new ReportSourceError("validate", "字体应为 Uint8Array 或 ArrayBuffer");
    if (source.byteLength > 32_000_000) throw new ReportRuntimeError("budget", "单份字体超过 32 MB", "$.pdf");
    return new Uint8Array(source instanceof Uint8Array ? source : new Uint8Array(source));
  };
  if (pdf.customFontFaces) {
    const faces = pdf.customFontFaces;
    return { customFontName: pdf.customFontName, customFontFaces: { regular: copy(faces.regular), ...(faces.bold ? { bold: copy(faces.bold) } : {}), ...(faces.italic ? { italic: copy(faces.italic) } : {}), ...(faces.boldItalic ? { boldItalic: copy(faces.boldItalic) } : {}) } };
  }
  return { customFontName: pdf.customFontName, ...(pdf.customFontBytes ? { customFontBytes: copy(pdf.customFontBytes) } : {}) };
}

export function reportFontFingerprint(pdf?: ReportPdfFontOptions): string | undefined {
  const faces = pdf?.customFontFaces ?? (pdf?.customFontBytes ? { regular: pdf.customFontBytes } : undefined);
  if (!faces) return;
  const entries = (["regular", "bold", "italic", "boldItalic"] as const).map(name => {
    const source = faces[name];
    if (!source) return [name, null];
    const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
    if (bytes.byteLength > 32_000_000) throw new ReportRuntimeError("budget", "单份字体超过 32 MB", "$.pdf");
    return [name, portableSha256Hex(bytes)];
  });
  return portableSha256Hex(new TextEncoder().encode(JSON.stringify(entries)));
}

/** No accessors, host prototypes, sparse arrays or cycles enter an immutable output snapshot. */
export function snapshotPreparedReport(input: PreparedReport, maxBytes: number, signal?: AbortSignal): PreparedReport {
  const snapshot = snapshotReportJson(input, { maxBytes, check: () => throwIfAborted(signal),
    error: (code, message) => code === "budget" ? new ReportRuntimeError("budget", message, "$.budget.maxPreparedBytes") : new ReportSourceError("validate", message)
  });
  validatePreparedMetadata(snapshot);
  return snapshot;
}

export function validatePreparedMetadata(snapshot: PreparedReport): void {
  if (!snapshot?.stats || ["rows", "pages", "cells"].some(key => !Number.isSafeInteger(snapshot.stats[key as "rows"]) || snapshot.stats[key as "rows"] < 0) || !Number.isFinite(snapshot.stats.durationMs) || snapshot.stats.durationMs < 0) throw new ReportSourceError("validate", "准备结果统计无效");
  if (!Array.isArray(snapshot.diagnostics) || snapshot.diagnostics.some(entry => !entry || typeof entry.code !== "string" || typeof entry.message !== "string" || !["info", "warning", "error"].includes(entry.severity) || !hasValidDataExplanation(entry))) throw new ReportSourceError("validate", "准备结果诊断无效");
  if (!snapshot.revisions || typeof snapshot.revisions !== "object" || Array.isArray(snapshot.revisions) || Object.values(snapshot.revisions).some(value => !value || typeof value !== "object" || value.revision !== undefined && typeof value.revision !== "string" || value.sourceToken !== undefined && typeof value.sourceToken !== "string")) throw new ReportSourceError("validate", "准备结果修订无效");
  if (snapshot.layout && (!["heuristic", "provided", "font-bytes"].includes(snapshot.layout.textMetrics) || snapshot.layout.fontFingerprint !== undefined && !/^[a-f0-9]{64}$/.test(snapshot.layout.fontFingerprint))) throw new ReportSourceError("validate", "准备结果字体度量标识无效");
}

export function checkPreparedFont(input: ReportRuntimePreparedExportInput): void {
  if (input.format !== "pdf") return;
  const expected = input.prepared.layout?.fontFingerprint, actual = reportFontFingerprint(input.pdf);
  if (expected === actual && (expected !== undefined || input.prepared.layout?.textMetrics === "heuristic" && !actual)) return;
  const message = "已准备计划的字体度量无法与本次 PDF 字体确认一致；保持现有分页，未重新查询或排版。请在 prepare 和 exportPrepared 提供相同字体字节。";
  if (input.fidelity === "strict") throw new ReportSourceError("validate", message);
  input.prepared.diagnostics.push({ code: "prepared-font-metrics", severity: "warning", message });
}
