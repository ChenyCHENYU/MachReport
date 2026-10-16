import { validateRenderPlan, paginateTemplate, type RenderPlan, type AssetRenderOptions, type ReportFetchInput } from "@agile-team/mach-report";
import { assertOutputActive, waitForOutput } from "../output/progress";
import type { PlanFetcher } from "./adapters";
import type { ExcelImportOptions } from "../xlsx/import-types";
import type { ReportPreviewTaskStage } from "./guards";
import { prepareReportAssets } from "./assets";
import { MachReportError } from "./errors";
import { cloneReportSnapshot } from "./snapshot";

function validatePreviewPlan(plan: RenderPlan, warning: (message: string) => void): void {
  const check = validateRenderPlan(plan);
  if (!check.ok) throw new MachReportError("validate", `渲染计划校验失败(${check.errors.length} 处): ${check.errors.slice(0, 3).map((item) => `${item.path}: ${item.message}`).join("; ")}`);
  check.warnings.forEach((item) => warning(`${item.path}: ${item.message}`));
}
export async function loadPreviewPlan(fetcher: PlanFetcher, input: ReportFetchInput, assets: AssetRenderOptions | undefined, update: (stage: ReportPreviewTaskStage) => void): Promise<RenderPlan> {
  const plan = await waitForOutput(fetcher(input), input.signal);
  assertOutputActive(input.signal);
  update("validate");
  validatePreviewPlan(plan, input.onWarning ?? (() => {}));
  assertOutputActive(input.signal);
  update("assets");
  return prepareReportAssets(plan, assets, input.signal!, input.onWarning ?? (() => {}));
}
export async function importPreviewPlan(input: ArrayBuffer | Uint8Array | Blob, options: ExcelImportOptions, assets: AssetRenderOptions | undefined, signal: AbortSignal, warning: (message: string) => void, update: (stage: ReportPreviewTaskStage) => void) {
  const { importExcelTemplate } = await import("@agile-team/mach-report/xlsx");
  assertOutputActive(signal);
  const result = await waitForOutput(importExcelTemplate(input, { ...options, signal }), signal);
  update("layout");
  const plan = paginateTemplate(cloneReportSnapshot(result.template), {}).plan;
  validatePreviewPlan(plan, warning);
  assertOutputActive(signal);
  update("assets");
  const prepared = await prepareReportAssets(plan, assets, signal, warning);
  return { result, plan: prepared };
}
