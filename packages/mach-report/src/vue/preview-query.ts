import type { AssetRenderOptions, ReportFetchInput, ReportQueryContext, ReportQuerySource, RenderPlan } from "@agile-team/mach-report";
import type { PlanFetcher } from "./adapters";
import { loadPreviewPlan } from "./preview-plan";
import { captureQueryContext, captureQuerySource } from "./query-context";
import { reportTaskId } from "../source/task-events";

export interface PreviewQueryResult {
  plan: RenderPlan;
  context: Readonly<ReportQueryContext>;
}

/** Query metadata is captured alongside the exact plan that owns it. */
export async function queryPreviewPlan(fetcher: PlanFetcher, input: ReportFetchInput, assets?: AssetRenderOptions, progress: Parameters<typeof loadPreviewPlan>[3] = () => {}): Promise<PreviewQueryResult> {
  const ids = [...input.reportIds];
  const queryId = input.taskId ?? reportTaskId();
  const params = Object.freeze({ ...input.params });
  const sources = new Map<number, Readonly<ReportQuerySource>>();
  const plan = await loadPreviewPlan(fetcher, { ...input, taskId: queryId, reportIds: [...ids], params: { ...params },
    onQueryResult(id, result, index) {
      if (input.signal?.aborted) return;
      const source = captureQuerySource(ids, id, result, index);
      if (source) sources.set(source.reportIndex, source);
      input.onQueryResult?.(id, result, index);
    },
  }, assets, progress);
  return { plan, context: captureQueryContext(ids, params, sources.values(), queryId) };
}
