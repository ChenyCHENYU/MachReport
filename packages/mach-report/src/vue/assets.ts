import { resolvePlanAssets, type AssetRenderOptions, type RenderPlan } from "@agile-team/mach-report";
import { MachReportError } from "./errors";

/** Prepare adapters once so preview and every export consume the same image-backed plan. */
export async function prepareReportAssets(plan: RenderPlan, options: AssetRenderOptions | undefined, signal: AbortSignal, warning: (message: string) => void): Promise<RenderPlan> {
  if (!options?.assetRegistry && (!options?.assetRenderers || !Object.keys(options.assetRenderers).length)) return plan;
  try {
    const result = await resolvePlanAssets(plan, { ...options, signal, format: "dom", onDiagnostic: (diagnostic) => {
      if (signal.aborted) return;
      options.onDiagnostic?.(diagnostic);
      warning(diagnostic.message);
    } });
    return result.plan;
  } catch (cause) {
    if (signal.aborted) throw cause;
    throw new MachReportError("render", cause instanceof Error ? cause.message : "Report asset preparation failed", cause);
  }
}
