import type { ListColumn } from "./list-model";
import type { ComponentStyle, GridCell } from "../schema/render-plan";

export type ColumnVisual = {
  /** Defaults to the column field; never changes the cell's raw value or business identity. */
  field?: string;
  /** Numeric text requires explicit opt-in; formatting an identifier does not turn it into a measure. */
  numeric?: "number" | "decimal";
  min?: number;
  max?: number;
} & ({ kind: "colorScale"; lowColor?: string; highColor?: string } | { kind: "dataBar"; color?: string; negativeColor?: string });
export interface ColumnVisualResolver { apply(cell: GridCell, row: Record<string, unknown>): void }
const COLOR = /^#[0-9a-f]{6}$/i;
export function validColumnVisual(value: unknown): value is ColumnVisual {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const visual = value as ColumnVisual;
  if (visual.kind !== "colorScale" && visual.kind !== "dataBar") return false;
  if (visual.field !== undefined && (typeof visual.field !== "string" || !visual.field.trim())) return false;
  if (visual.numeric !== undefined && !["number", "decimal"].includes(visual.numeric)) return false;
  if ([visual.min, visual.max].some(bound => bound !== undefined && (typeof bound !== "number" || !Number.isFinite(bound)))) return false;
  if (visual.min !== undefined && visual.max !== undefined && visual.min > visual.max) return false;
  return Object.entries(visual).every(([key, item]) => !["color", "negativeColor", "lowColor", "highColor"].includes(key) || typeof item === "string" && COLOR.test(item));
}
function numericValue(value: unknown, mode: ColumnVisual["numeric"]): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (mode !== "decimal" || typeof value !== "string" || value.length > 1024 || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return undefined;
  const number = Number(value); return Number.isFinite(number) ? number : undefined;
}
function interpolate(low: string, high: string, ratio: number): string {
  let color = "#";
  for (const offset of [1, 3, 5]) {
    const left = parseInt(low.slice(offset, offset + 2), 16), right = parseInt(high.slice(offset, offset + 2), 16);
    color += Math.round(left + (right - left) * ratio).toString(16).padStart(2, "0");
  }
  return color;
}
function ratio(value: number, min: number, max: number): number {
  if (min === max) return value < min ? 0 : value > max ? 1 : .5;
  if (value <= min) return 0;
  if (value >= max) return 1;
  const span = max - min;
  // Preserve finite subnormal spans. Only overflowing opposite-sign domains need scaling.
  return Number.isFinite(span) ? (value - min) / span : (value / 2 - min / 2) / (max / 2 - min / 2);
}
function resolver(visual: ColumnVisual, field: string, min: number, max: number): ColumnVisualResolver {
  const styles = new WeakMap<ComponentStyle, Map<string, ComponentStyle>>();
  return { apply(cell, row) {
    const value = numericValue(row[field], visual.numeric); if (value === undefined) return;
    if (visual.kind === "dataBar") {
      const low = Math.min(min, 0), high = Math.max(max, 0), start = ratio(0, low, high), end = low === high ? start : ratio(value, low, high);
      cell.dataBar = { start: Math.min(start, end), end: Math.max(start, end), color: value < 0 ? visual.negativeColor ?? "#f3bcc3" : visual.color ?? "#bad8fa" };
      return;
    }
    const backgroundColor = interpolate(visual.lowColor ?? "#f0f7ff", visual.highColor ?? "#8bbcf1", ratio(value, min, max));
    const base = cell.style ?? {}, colors = styles.get(base) ?? new Map<string, ComponentStyle>();
    styles.set(base, colors);
    let style = colors.get(backgroundColor);
    if (!style) { style = { ...base, backgroundColor }; colors.set(backgroundColor, style); }
    cell.style = style;
  } };
}
/** One domain scan per configured column, reused by all row/page rendering. */
export function createColumnVisualResolvers(columns: readonly ListColumn[], rows: readonly Record<string, unknown>[], signal?: AbortSignal): Array<ColumnVisualResolver | undefined> {
  return columns.map(column => {
    checkVisualAbort(signal);
    const visual = column.visual; if (!visual) return undefined;
    if (!validColumnVisual(visual)) throw new TypeError("Invalid column visual rule");
    const field = visual.field ?? column.field;
    let minimum = Infinity, maximum = -Infinity;
    let visited = 0;
    if (visual.min === undefined || visual.max === undefined) for (const row of rows) {
      if ((visited++ & 1023) === 0) checkVisualAbort(signal);
      const value = numericValue(row[field], visual.numeric); if (value === undefined) continue;
      minimum = Math.min(minimum, value); maximum = Math.max(maximum, value);
    }
    let min = visual.min ?? minimum, max = visual.max ?? maximum;
    if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined;
    if (min > max) { if (visual.min !== undefined) max = min; else min = max; }
    return resolver(visual, field, min, max);
  });
}

function checkVisualAbort(signal?: AbortSignal): void { if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError"); }
