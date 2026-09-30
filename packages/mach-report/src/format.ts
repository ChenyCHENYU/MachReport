/**
 * 列值格式化（声明式、JSON 可序列化——不破坏 gridPlan 契约）。
 * 在 paginate 的 cellText 出口统一消费：格式化发生在进 RenderPlan 之前，
 * 三后端（DOM/Canvas/PDF）零改动。
 */

export type ColumnFormat =
  | { kind: "number"; thousands?: boolean; digits?: number }
  | { kind: "percent"; digits?: number }
  | { kind: "date"; pattern?: string };

function withThousands(n: number, digits?: number): string {
  if (digits != null) return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
  return n.toLocaleString("en-US");
}

function formatDate(d: Date, pattern: string): string {
  const pad = (v: number, len = 2) => String(v).padStart(len, "0");
  return pattern
    .replace(/YYYY/g, String(d.getFullYear()))
    .replace(/MM/g, pad(d.getMonth() + 1))
    .replace(/DD/g, pad(d.getDate()))
    .replace(/hh/g, pad(d.getHours()))
    .replace(/mm/g, pad(d.getMinutes()))
    .replace(/ss/g, pad(d.getSeconds()));
}

/**
 * 应用格式化。非数值/无法解析时原样返回基础文本（降级不报错）：
 * - number：digits 小数位 + 可选千分位（12,345.60）
 * - percent：×100 + % 后缀（digits 默认 2）
 * - date：Date/时间戳/可解析字符串 → pattern（默认 YYYY-MM-DD）；
 *   字符串不可解析时原样返回（上游已格式化过的场景）
 */
export function formatValue(value: unknown, format?: ColumnFormat): string {
  if (value == null || value === "" || !format) return String(value ?? "");
  switch (format.kind) {
    case "number": {
      const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
      if (!Number.isFinite(n)) return String(value);
      return format.thousands === false ? n.toFixed(format.digits ?? 0).replace(/\.?0+$/, "") || String(n)
        : withThousands(n, format.digits);
    }
    case "percent": {
      const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
      if (!Number.isFinite(n)) return String(value);
      const digits = format.digits ?? 2;
      return `${withThousands(n * 100, digits)}%`;
    }
    case "date": {
      const pattern = format.pattern ?? "YYYY-MM-DD";
      const d = value instanceof Date ? value : new Date(value as string | number);
      if (Number.isNaN(d.getTime())) return String(value);
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
  };
  /** 命中时合并进单元格样式（color/bold/backgroundColor 等） */
  style: Record<string, unknown>;
}

export function evalStyleRule(
  row: Record<string, unknown>,
  when: StyleRule["when"]
): boolean {
  const raw = row[when.field];
  if (typeof when.value === "number") {
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n)) return false;
    switch (when.op) {
      case ">": return n > when.value;
      case ">=": return n >= when.value;
      case "<": return n < when.value;
      case "<=": return n <= when.value;
      case "==": return n === when.value;
      case "!=": return n !== when.value;
    }
  }
  const s = String(raw ?? "");
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
