import { wrapText, type TextMeasureOptions, type TextMeasurer } from "./textwrap";

const MAX_ENTRIES = 512;
// Bound retained UTF-16 text as well as entry count; unique long fields must not grow with a batch.
const MAX_TEXT_UNITS = 256 * 1024;
interface WrappedEntry { lines: string[]; units: number }
export type RecordTextWrapper = (text: string, widthMm: number, options: TextMeasureOptions, measurer: TextMeasurer) => string[];

/** One pagination generator owns its cache; fonts and results never leak into another request. */
export function createRecordTextWrapper(): RecordTextWrapper {
  const entries = new Map<string, WrappedEntry>();
  let textUnits = 0, lastMeasurer: TextMeasurer | undefined;
  return (text, widthMm, options, measurer) => {
    if (measurer !== lastMeasurer) { entries.clear(); textUnits = 0; lastMeasurer = measurer; }
    // Complete measurement inputs also handle host edits while a lazy iterator is paused.
    const key = JSON.stringify([text, widthMm, options.fontSizePt, options.fontFamily, options.bold, options.italic, options.letterSpacingPt]);
    const cached = entries.get(key);
    if (cached) {
      entries.delete(key); entries.set(key, cached);
      return cached.lines.slice();
    }
    const lines = wrapText(text, widthMm, options, measurer);
    const units = key.length + lines.reduce((sum, line) => sum + line.length, 0);
    if (units <= MAX_TEXT_UNITS) {
      while (entries.size >= MAX_ENTRIES || textUnits + units > MAX_TEXT_UNITS) {
        const oldestKey = entries.keys().next().value!;
        textUnits -= entries.get(oldestKey)!.units; entries.delete(oldestKey);
      }
      entries.set(key, { lines: lines.slice(), units }); textUnits += units;
    }
    return lines;
  };
}
