/** Wire values deliberately remain strings in browsers, Workers and backend runtimes. */
export interface ReportDateRange { start: string; end: string }

export function isReportDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isReportYear(value: string): boolean {
  return value.length === 4 && /^\d{4}$/.test(value) && value !== "0000";
}

export function isReportMonth(value: string): boolean {
  return value.length === 7 && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value) && isReportYear(value.slice(0, 4));
}

/** Only complete, ordered, real calendar dates are accepted; there is no timezone conversion. */
export function parseReportDateRange(value: string): ReportDateRange | undefined {
  const [start, end, extra] = value.split("/");
  if (extra !== undefined || !start || !end || !isReportDate(start) || !isReportDate(end) || start > end) return undefined;
  return { start, end };
}

export function formatReportDateRange(range: ReportDateRange): string {
  const value = `${range.start}/${range.end}`;
  if (!parseReportDateRange(value)) throw new RangeError("日期范围必须为完整且有序的 YYYY-MM-DD/YYYY-MM-DD");
  return value;
}

export function isReportTemporalBound(type: string | undefined, value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (type === "month") return isReportMonth(value);
  if (type === "year") return isReportYear(value);
  return (type === "date" || type === "dateRange") && isReportDate(value);
}

export function reportTemporalIssue(type: string | undefined, value: string): string | undefined {
  if (type === "date" && !isReportDate(value)) return "应为有效的 YYYY-MM-DD 日期";
  if (type === "month" && !isReportMonth(value)) return "应为有效的 YYYY-MM 月份";
  if (type === "year" && !isReportYear(value)) return "应为 0001 至 9999 的四位年份";
  if (type === "dateRange" && !parseReportDateRange(value)) return "应为完整且有序的 YYYY-MM-DD/YYYY-MM-DD 日期范围";
  return undefined;
}
