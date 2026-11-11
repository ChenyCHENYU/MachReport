interface FoldedExpansion {
  foldedStart: number;
  foldedEnd: number;
  sourceStart: number;
  sourceEnd: number;
}

/** Retain only length-changing code points, rather than an offset for every character. */
function foldedExpansions(text: string): FoldedExpansion[] {
  const expansions: FoldedExpansion[] = [];
  let foldedOffset = 0, sourceOffset = 0;
  for (const character of text) {
    const foldedLength = character.toLowerCase().length;
    if (foldedLength !== character.length) expansions.push({
      foldedStart: foldedOffset, foldedEnd: foldedOffset + foldedLength,
      sourceStart: sourceOffset, sourceEnd: sourceOffset + character.length
    });
    foldedOffset += foldedLength;
    sourceOffset += character.length;
  }
  return expansions;
}

function sourceOffset(expansions: readonly FoldedExpansion[], offset: number, end: boolean): number {
  let low = 0, high = expansions.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (expansions[middle]!.foldedStart <= offset) low = middle + 1;
    else high = middle;
  }
  const expansion = expansions[low - 1];
  if (!expansion) return offset;
  if (offset === expansion.foldedStart) return expansion.sourceStart;
  if (offset < expansion.foldedEnd) return end ? expansion.sourceEnd : expansion.sourceStart;
  return offset - (expansion.foldedEnd - expansion.sourceEnd);
}

/** Count and optionally visit the same non-overlapping source ranges used by navigation and DOM marks.
 * The caller folds the query once. Ordinary equal-length text never creates a character map. */
export function scanTextMatches(text: string, foldedQuery: string, visit?: (start: number, end: number) => void): number {
  if (!foldedQuery) return 0;
  const folded = text.toLowerCase();
  let offset = folded.indexOf(foldedQuery);
  if (offset < 0) return 0;
  const expansions = folded.length === text.length ? undefined : foldedExpansions(text);
  let count = 0, previousEnd = 0;
  while (offset >= 0) {
    const start = expansions ? sourceOffset(expansions, offset, false) : offset;
    const end = expansions ? sourceOffset(expansions, offset + foldedQuery.length, true) : offset + foldedQuery.length;
    // A length-changing case mapping can expose several folded matches inside one source character.
    if (start >= previousEnd) { count++; visit?.(start, end); previousEnd = end; }
    offset = folded.indexOf(foldedQuery, offset + foldedQuery.length);
  }
  return count;
}
