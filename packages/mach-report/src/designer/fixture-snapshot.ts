import { toRaw } from "vue";
import type { DatasetRows } from "@agile-team/mach-report";

function assertContainer(value: object): void {
  const prototype = Object.getPrototypeOf(value);
  if (
    prototype !== Object.prototype &&
    prototype !== Array.prototype &&
    prototype !== null
  )
    throw new Error("Sample data must contain plain JSON objects");
  if (Object.getOwnPropertySymbols(value).length)
    throw new Error("Sample data must not contain symbols");
  if (Array.isArray(value) && Object.keys(value).length !== value.length)
    throw new Error("Sample arrays must not contain holes or extra properties");
}
/** Reject non-JSON values and getters before cloning; no business callback runs while capturing. */
export function snapshotFixtureData(input: DatasetRows): DatasetRows {
  let nodes = 0,
    characters = 0;
  const ancestors = new Set<object>();
  function copy(value: unknown, depth: number): unknown {
    if (++nodes > 100000 || depth > 32)
      throw new RangeError("Sample data exceeds the capture budget");
    if (typeof value === "string") {
      characters += value.length;
      if (characters > 2000000)
        throw new RangeError("Sample text exceeds the capture budget");
      return value;
    }
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (!value || typeof value !== "object")
      throw new Error("Sample data must contain plain JSON values");
    const raw = toRaw(value);
    if (ancestors.has(raw))
      throw new Error("Sample data must not contain cycles");
    assertContainer(raw);
    ancestors.add(raw);
    const result: Record<string, unknown> | unknown[] = Array.isArray(raw)
      ? []
      : (Object.create(null) as Record<string, unknown>);
    for (const key of Object.keys(raw)) {
      const descriptor = Object.getOwnPropertyDescriptor(raw, key)!;
      if (
        descriptor.get ||
        descriptor.set ||
        ["__proto__", "constructor", "prototype"].includes(key)
      )
        throw new Error("Sample data must not contain getters or unsafe keys");
      (result as Record<string, unknown>)[key] = copy(
        descriptor.value,
        depth + 1,
      );
    }
    ancestors.delete(raw);
    return result;
  }
  return copy(input, 0) as DatasetRows;
}
