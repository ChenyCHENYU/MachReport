import type { ReportDiagnostic } from "../source/provider";
import type { ReportPreviewDiagnostic } from "./guards";
import { queryReportIndex } from "./query-context";

/** Match createReportSource's page/table namespace without asking each provider to build it. */
export function scopeQueryDiagnostics(
  ids: readonly string[],
  id: string,
  entries: readonly ReportDiagnostic[],
  reportIndex?: number,
): ReportPreviewDiagnostic[] {
  // Legacy fetchers may omit the additive index when each ID occurs only once.
  // An ambiguous legacy callback must fail to locate rather than select another report's value.
  const index = queryReportIndex(ids, id, reportIndex);
  const reportScope = JSON.stringify([index, id]);
  return entries.map(entry => entry.target?.reportScope ? { ...entry, target: { ...entry.target } } : ({
    ...entry,
    ...(entry.target ? {
      target: {
        ...entry.target, reportScope,
        ...(entry.target.tableId ? { tableId: JSON.stringify([index, id, entry.target.tableId]) } : {}),
      },
    } : {}),
  }));
}
