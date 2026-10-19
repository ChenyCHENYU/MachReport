import { formatDecimal, parseDecimal, compareDecimal } from "./processing/decimal";
/**
 * 列值格式化（声明式、JSON 可序列化）。
 * 在 paginate 的 cellText 出口统一消费：格式化发生在进 RenderPlan 之前，
 * 三后端（DOM/Canvas/PDF）零改动。
 *
 * 语义约定（v0.9 固化）：
 * - number.digits 显式给出 → 精确保留（12.5 + digits:2 → "12.50"）
 * - number.thousands 默认 false（千分位显式开启）
 * - date 字符串按"本地时区的日历日"解析（YYYY-MM-DD / YYYY/MM/DD 直取年月日，
 *   不经 Date 字符串构造——后者按 UTC 零点，负时区环境会少一天）
 */

export type ColumnFormat =
  | { kind: "number"; thousands?: boolean; digits?: number }
  | { kind: "percent"; digits?: number }
  | { kind: "date"; pattern?: string };

/** 数值型 Excel 导出的显示格式；日期/对象仍使用显示文本，不做隐式类型转换。 */
export function toExcelNumberFormat(format?: ColumnFormat): string | undefined {
  if (!format || format.kind === "date") return undefined;
  const digits = format.digits;
  // formatValue 使用 toFixed / Intl 的 0..100 精度约束；非法运行时输入不生成元数据。
  if (digits !== undefined && (!Number.isInteger(digits) || digits < 0 || digits > 100)) return undefined;
  if (format.kind === "percent") {
    const decimalPlaces = digits ?? 2;
    return `0${decimalPlaces ? `.${"0".repeat(decimalPlaces)}` : ""}%`;
  }
  if (digits === undefined) return format.thousands ? "#,##0.###############" : undefined;
  return `${format.thousands ? "#,##0" : "0"}${digits ? `.${"0".repeat(digits)}` : ""}`;
}

/** 日历日字符串 → 本地 Date（不含时间的纯日期，杜绝 UTC 偏移） */
export function parseDateLocal(input: string): Date | null {
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(input.trim());
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function withThousands(n: number, digits?: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function formatDate(d: Date, pattern: string): string {
  const pad = (v: number) => String(v).padStart(2, "0");
  return pattern
    .replace(/YYYY/g, String(d.getFullYear()))
    .replace(/MM/g, pad(d.getMonth() + 1))
    .replace(/DD/g, pad(d.getDate()))
    .replace(/hh/g, pad(d.getHours()))
    .replace(/mm/g, pad(d.getMinutes()))
    .replace(/ss/g, pad(d.getSeconds()));
}

/** 数值格式化：digits 显式 → 精确保留；缺省 → 自然小数（可选千分位） */
function formatNumber(n: number, thousands: boolean, digits?: number): string {
  if (digits != null) {
    return thousands ? withThousands(n, digits) : n.toFixed(digits);
  }
  return thousands ? withThousands(n) : String(n);
}

export function toNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * 应用格式化。非数值/无法解析时原样返回基础文本（降级不报错）：
 * - number：digits 小数位 + 可选千分位（12,345.60；thousands 默认 false）
 * - percent：×100 + % 后缀（digits 默认 2）
 * - date：Date/日历日字符串 → pattern（默认 YYYY-MM-DD）；不可解析原样返回
 */
export function formatValue(value: unknown, format?: ColumnFormat): string {
  if (value == null || value === "" || !format) return String(value ?? "");
  switch (format.kind) {
    case "number": {
      if (typeof value === "string") {
        try { return formatDecimal(value, format.digits, format.thousands === true); } catch { return value; }
      }
      const n = toNumber(value);
      if (n == null) return String(value);
      return formatNumber(n, format.thousands === true, format.digits);
    }
    case "percent": {
      if (typeof value === "string") {
        try { return formatDecimal(value, format.digits ?? 2, true, true); } catch { return value; }
      }
      const n = toNumber(value);
      if (n == null) return String(value);
      return `${withThousands(n * 100, format.digits ?? 2)}%`;
    }
    case "date": {
      const pattern = format.pattern ?? "YYYY-MM-DD";
      const d = value instanceof Date ? value : parseDateLocal(String(value));
      if (!d) return String(value);
      return formatDate(d, pattern);
    }
    default:
      return String(value);
  }
}

/** 条件格式规则求值（声明式，见 ListColumn.rules） */
export interface StyleRule {
  when: {
    field: string;
    op: ">" | ">=" | "<" | "<=" | "==" | "!=";
    value: number | string;
    /** Explicit decimal comparisons retain decimal thresholds as text. */
    numeric?: "number" | "decimal";
  };
  /** 命中时合并进单元格样式（color/bold/backgroundColor 等） */
  style: Record<string, unknown>;
}

/**
 * 规则求值语义：
 * - 空值（null/undefined/""）永不命中（避免 Number("")===0 把空当 0 的隐式陷阱）
 * - 数值比较：两侧均可数值化才比较；否则退化为字符串比较
 */
export function evalStyleRule(
  row: Record<string, unknown>,
  when: StyleRule["when"]
): boolean {
  const raw = row[when.field];
  if (raw == null || raw === "") return false;
  if (typeof when.value === "number" || when.numeric !== undefined) {
    let n: number;
    try { n = compareDecimal(parseDecimal(raw), parseDecimal(when.value)); } catch { return false; }
    if (!Number.isFinite(n)) return false;
    switch (when.op) {
      case ">": return n > 0;
      case ">=": return n >= 0;
      case "<": return n < 0;
      case "<=": return n <= 0;
      case "==": return n === 0;
      case "!=": return n !== 0;
    }
  }
  const s = String(raw);
  const t = String(when.value);
  switch (when.op) {
    case "==": return s === t;
    case "!=": return s !== t;
    case ">": return s > t;
    case ">=": return s >= t;
    case "<": return s < t;
    case "<=": return s <= t;
  }
  return false;
}
