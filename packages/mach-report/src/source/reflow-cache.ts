import type { PaginateOptions, PaginateResult } from "../layout/paginate";
import type { ReportEditSessionPart } from "../editing/session-data";
import { capturePlanGuard } from "../editing/session-snapshot";

type Result = Pick<PaginateResult, "plan" | "chartComponents">;
interface Entry { part: ReportEditSessionPart; result: Result; unchanged(): boolean }
function samePart(left: ReportEditSessionPart, right: ReportEditSessionPart): boolean {
  const keys = Object.keys(left.datasets), other = Object.keys(right.datasets);
  return left.template === right.template && left.sourceScope === right.sourceScope && keys.length === other.length
    && keys.every((key, index) => key === other[index] && left.datasets[key] === right.datasets[key]);
}
/** One completed source query owns at most one result per report part. Candidate
 * caches never advance session state, and published mutable plans are fenced. */
export function createReflowPartCache() {
  const entries: Array<Entry | undefined> = [];
  return async (index: number, part: ReportEditSessionPart, options: PaginateOptions, build: () => Promise<Result>): Promise<Result> => {
    if (options.formula || options.measurer || options.onWarning) return build();
    const entry = entries[index];
    if (entry && samePart(entry.part, part) && entry.unchanged()) return entry.result;
    const result = await build();
    if (options.signal?.aborted) return result;
    try { entries[index] = { part, result, unchanged: capturePlanGuard(result.plan) }; }
    catch { entries[index] = undefined; }
    return result;
  };
}
