export interface ReportDateDefaultOptions {
  preset: "today" | "yesterday" | "month-start" | "month-end";
  /** Explicit business clock in milliseconds or Date; no hidden browser/server clock. */
  now: number | Date;
  timeZone: string;
  offsetDays?: number;
}
/** Resolve a business calendar default once per request; returns only a portable date value. */
export function reportDateDefault(options: ReportDateDefaultOptions): string {
  if (!options || !["today", "yesterday", "month-start", "month-end"].includes(options.preset)) throw new TypeError("未知日期默认值");
  const instant = options.now instanceof Date ? options.now.getTime() : options.now;
  if (typeof instant !== "number" || !Number.isFinite(instant) || !Number.isFinite(new Date(instant).getTime())) throw new TypeError("日期默认值需要有效的业务时钟");
  if (typeof options.timeZone !== "string" || !options.timeZone.trim()) throw new TypeError("日期默认值需要显式业务时区");
  if (options.offsetDays !== undefined && (!Number.isSafeInteger(options.offsetDays) || Math.abs(options.offsetDays) > 3660)) throw new RangeError("日期偏移应为 -3660 到 3660 的整数");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: options.timeZone, year: "numeric", month: "2-digit", day: "2-digit", calendar: "iso8601", numberingSystem: "latn" }).formatToParts(instant);
  const value = (name: string) => Number(parts.find(part => part.type === name)?.value);
  const date = new Date(0); date.setUTCFullYear(value("year"), value("month") - 1, value("day")); date.setUTCHours(0, 0, 0, 0);
  if (options.preset === "yesterday") date.setUTCDate(date.getUTCDate() - 1);
  if (options.preset === "month-start") date.setUTCDate(1);
  if (options.preset === "month-end") date.setUTCMonth(date.getUTCMonth() + 1, 0);
  date.setUTCDate(date.getUTCDate() + (options.offsetDays ?? 0));
  if (date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) throw new RangeError("业务日期超出 0001–9999 范围");
  return date.toISOString().slice(0, 10);
}
