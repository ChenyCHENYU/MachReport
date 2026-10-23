import { reviewReportTemplate, type ReportTemplateReview, type ReportTemplateReviewOptions } from "../source/template-review";
import { parseReportTemplate } from "../source/template-registry";
import { createReportRuntime } from "./runtime";
import type { ReportRuntimeExportInput, ReportRuntimeExportResult } from "./types";
import { controlled, throwIfAborted } from "./control";
import type { AssetRenderOptions, ImageComponentKind } from "../output/assets";
import type { OutputDiagnostic } from "../output/capabilities";

type PublicationAssets = Omit<AssetRenderOptions, "signal">;

export interface ReportPublicationArtifact {
  fixture: string;
  format: "pdf" | "xlsx";
  bytes: number;
  pages: number;
  /** Optional host digest. No Node or crypto dependency is pulled into /server. */
  digest?: string;
}
export interface ReportPublicationReview extends ReportTemplateReview { artifacts: ReportPublicationArtifact[] }
export interface ReportPublicationOptions extends ReportTemplateReviewOptions {
  formats?: readonly ("pdf" | "xlsx")[];
  signal?: AbortSignal;
  /** Trusted resource renderers shared by all requested file formats. */
  assets?: PublicationAssets;
  pdf?: ReportRuntimeExportInput["pdf"] & PublicationAssets;
  xlsx?: ReportRuntimeExportInput["xlsx"] & PublicationAssets;
  maxOutputBytes?: number;
  maxDurationMs?: number;
  /** Explicit fixtures only. Host may archive these bytes; the result retains metadata only. */
  onArtifact?: (fixture: string, result: ReportRuntimeExportResult) => void | Promise<void>;
  digest?: (bytes: Uint8Array) => string | Promise<string>;
}

function publicationAssets(options: ReportPublicationOptions, format: "pdf" | "xlsx"): PublicationAssets | undefined {
  const common = options.assets, local = options[format];
  if (!common && !local?.assetRenderers) return;
  return {
    ...common,
    ...(local?.assetFailure === undefined ? {} : { assetFailure: local.assetFailure }),
    ...(local?.onDiagnostic === undefined ? {} : { onDiagnostic: local.onDiagnostic }),
    assetRenderers: { ...common?.assetRenderers, ...local?.assetRenderers },
    assetBudget: { ...common?.assetBudget, ...local?.assetBudget }
  };
}
function deferredAsset(diagnostic: OutputDiagnostic | undefined, options: ReportPublicationOptions): boolean {
  if (!diagnostic || diagnostic.code !== "missing-image" || diagnostic.format !== "pdf" && diagnostic.format !== "xlsx") return false;
  return typeof publicationAssets(options, diagnostic.format)?.assetRenderers?.[diagnostic.kind as ImageComponentKind] === "function";
}
function publicationPreflight(input: unknown, options: ReportPublicationOptions): ReportPublicationReview {
  const checked = reviewReportTemplate(input, options);
  // Only a known matching renderer may defer a missing image. Real strict encoding remains mandatory.
  const issues = checked.issues.filter(issue => !deferredAsset(issue.diagnostic, options));
  const samples = checked.samples.map(sample => ({ ...sample, diagnostics: sample.diagnostics.filter(diagnostic => !deferredAsset(diagnostic, options)) }));
  return { ...checked, issues, samples, ok: issues.every(issue => issue.severity !== "error"), artifacts: [] };
}

async function encodeSample(fixture: NonNullable<ReportPublicationOptions["fixtures"]>[number], format: "pdf" | "xlsx", template: ReturnType<typeof parseReportTemplate>["template"], options: ReportPublicationOptions, review: ReportPublicationReview): Promise<void> {
  const runtime = createReportRuntime({ reports: { sample: { template, datasets: fixture.datasets } }, assets: publicationAssets(options, format), budget: {
    maxRows: options.maxSampleRows ?? 1000, maxPages: options.maxPages ?? 100, maxCells: options.maxCells ?? 250_000,
    maxOutputBytes: options.maxOutputBytes ?? 20_000_000, maxDurationMs: options.maxDurationMs ?? 30_000
  } });
  try {
    const { result, digest } = await controlled(options.signal, options.maxDurationMs ?? 30_000, async (signal) => {
      const result = await runtime.export({ reportIds: ["sample"], params: fixture.params, format, signal, fidelity: options.strictOutputs ? "strict" : "warn", pdf: options.pdf, xlsx: options.xlsx });
      const findings = result.diagnostics.filter(issue => issue.severity !== "info");
      if (options.strictOutputs && findings.length) throw new Error(`Strict ${format} encoding found fidelity issues: ${findings.slice(0, 3).map(issue => issue.message).join("; ")}`);
      const digest = await options.digest?.(result.bytes);
      throwIfAborted(signal);
      await options.onArtifact?.(fixture.name, result);
      throwIfAborted(signal);
      return { result, digest };
    });
    review.artifacts.push({ fixture: fixture.name, format, bytes: result.bytes.byteLength, pages: result.stats.pages, ...(digest ? { digest } : {}) });
    review.issues.push(...result.diagnostics.map((issue) => ({ code: "output" as const, severity: options.strictOutputs ? "error" as const : issue.severity === "error" ? "error" as const : "warning" as const, path: "$.template", fixture: fixture.name, message: `${format}: ${issue.message}` })));
  } catch (error) {
    throwIfAborted(options.signal);
    review.issues.push({ code: "output", severity: "error", path: "$.template", fixture: fixture.name, message: `${format}: ${error instanceof Error ? error.message : String(error)}` });
  }
}

/** Publication gate with actual sequential PDF/XLSX encoding, no business query or implicit save. */
export async function reviewReportPublication(input: unknown, options: ReportPublicationOptions = {}): Promise<ReportPublicationReview> {
  throwIfAborted(options.signal);
  const review = publicationPreflight(input, options);
  if (!review.ok) return review;
  const template = parseReportTemplate(input).template;
  const formats = [...new Set(options.formats ?? ["pdf", "xlsx"])];
  if (!formats.length || formats.some((format) => format !== "pdf" && format !== "xlsx")) {
    review.issues.push({ code: "output", severity: "error", path: "$.formats", message: "真实文件验收应至少选择PDF/XLSX之一" });
    review.ok = false; return review;
  }
  for (const fixture of options.fixtures ?? []) {
    for (const format of formats) {
      throwIfAborted(options.signal);
      if (format !== "pdf" && format !== "xlsx") continue;
      await encodeSample(fixture, format, template, options, review);
    }
  }
  review.ok = review.issues.every((issue) => issue.severity !== "error");
  return review;
}
