/** A report occurrence remains unique even when two views explicitly share editable data. */
export function reportOccurrenceScope(index: number, reportId: string): string {
  return JSON.stringify([index, reportId]);
}

/** Hosts may explicitly share editable sources; independent report occurrences are isolated by default. */
export function reportSourceScope(index: number, reportId: string, shared?: string): string {
  return shared === undefined ? reportOccurrenceScope(index, reportId) : JSON.stringify(["shared", shared]);
}
