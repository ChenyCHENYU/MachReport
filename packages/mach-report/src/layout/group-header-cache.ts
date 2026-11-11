import type { ComponentStyle } from "../schema/render-plan";

interface HeaderEntry<T> {
  firstRow: object;
  label: string;
  style: Readonly<Record<string, unknown>>;
  row: T;
}
const EMPTY_STYLE: Readonly<Record<string, unknown>> = Object.freeze({});
const MAX_HEADER_DEPTH = 16;

/** Styles contain scalars. Accessors/exotic input keep the uncached layout path. */
function styleSnapshot(style: ComponentStyle | undefined): Readonly<Record<string, unknown>> | undefined {
  if (style === undefined) return EMPTY_STYLE;
  try {
    const prototype: unknown = Object.getPrototypeOf(style);
    if (prototype !== Object.prototype && prototype !== null || Object.getOwnPropertySymbols(style).length) return;
    const snapshot: Record<string, unknown> = Object.create(null);
    for (const key of Object.getOwnPropertyNames(style)) {
      const descriptor = Object.getOwnPropertyDescriptor(style, key);
      if (!descriptor?.enumerable || descriptor.get || descriptor.set) return;
      const value: unknown = descriptor.value;
      if (value !== null && (typeof value === "object" || typeof value === "function")) return;
      snapshot[key] = value;
    }
    return snapshot;
  } catch { return; }
}
function sameStyle(left: Readonly<Record<string, unknown>>, right: Readonly<Record<string, unknown>>): boolean {
  const keys = Object.keys(right);
  return keys.length === Object.keys(left).length && keys.every(key => Object.prototype.hasOwnProperty.call(left, key) && Object.is(left[key], right[key]));
}

/** One pagination list owns at most one predicted header per supported depth.
 * No row-sized cache or cross-request geometry is retained. */
export function createGroupHeaderRows<T>(build: (label: string, style: ComponentStyle | undefined) => T) {
  const entries: Array<HeaderEntry<T> | undefined> = [];
  return (depth: number, firstRow: object, label: string, style?: ComponentStyle): T => {
    if (!Number.isInteger(depth) || depth < 0 || depth >= MAX_HEADER_DEPTH) return build(label, style);
    const snapshot = styleSnapshot(style);
    if (!snapshot) return build(label, style);
    const existing = entries[depth];
    if (existing?.firstRow === firstRow && existing.label === label && sameStyle(existing.style, snapshot)) return existing.row;
    const row = build(label, style);
    entries[depth] = { firstRow, label, style: snapshot, row };
    return row;
  };
}
