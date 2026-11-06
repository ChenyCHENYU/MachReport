import type { ReportQueryContext, ReportQueryResult, ReportQuerySource } from "../source/provider";
import { reportOccurrenceScope } from "../source/report-identity";
import { MachReportError } from "./errors";

export function queryReportIndex(ids: readonly string[], id: string, reportIndex?: number): number {
  const candidate = reportIndex ?? (ids.indexOf(id) === ids.lastIndexOf(id) ? ids.indexOf(id) : -1);
  return Number.isSafeInteger(candidate) && candidate >= 0 && ids[candidate] === id ? candidate : -1;
}

export function captureQuerySource(ids: readonly string[], id: string, result: ReportQueryResult, reportIndex?: number): Readonly<ReportQuerySource> | null {
  const index = queryReportIndex(ids, id, reportIndex);
  if (index < 0) return null;
  if (result.revision !== undefined && typeof result.revision !== "string"
    || result.sourceToken !== undefined && typeof result.sourceToken !== "string") {
    throw new MachReportError("validate", "ReportProvider.query 的 revision 与 sourceToken 必须为字符串");
  }
  return Object.freeze({ reportId: id, reportIndex: index, reportScope: reportOccurrenceScope(index, id),
    ...(result.revision === undefined ? {} : { revision: result.revision }),
    ...(result.sourceToken === undefined ? {} : { sourceToken: result.sourceToken }) });
}

export function captureQueryContext(ids: readonly string[], params: Readonly<Record<string, string>>, sources: Iterable<Readonly<ReportQuerySource>>, queryId?: string): Readonly<ReportQueryContext> {
  return Object.freeze({ queryId, reportIds: Object.freeze([...ids]), params: Object.freeze({ ...params }),
    sources: Object.freeze([...sources].sort((a, b) => a.reportIndex - b.reportIndex).map(source => Object.freeze({ ...source }))) });
}
