import type { TextMeasurer } from "./textwrap";

const MAX_ENTRIES = 4096, MAX_UNITS = 128 * 1024;

/** A single pagination owns this LRU. Host font/measurer changes between requests cannot become stale. */
export function createTextMeasurementCache(measurer: TextMeasurer): TextMeasurer {
  const entries = new Map<string, number>();
  let units = 0;
  return { measureMm(text, options) {
    const key = JSON.stringify([text, options.fontSizePt, options.fontFamily, options.bold, options.italic, options.letterSpacingPt]);
    const cached = entries.get(key);
    if (cached !== undefined) {
      entries.delete(key); entries.set(key, cached);
      return cached;
    }
    const value = measurer.measureMm(text, options);
    if (Number.isFinite(value) && key.length <= MAX_UNITS) {
      while (entries.size >= MAX_ENTRIES || units + key.length > MAX_UNITS) {
        const oldest = entries.keys().next().value!;
        units -= oldest.length; entries.delete(oldest);
      }
      entries.set(key, value); units += key.length;
    }
    return value;
  } };
}
