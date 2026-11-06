import { reportCellEditKey, type ReportCellEdit } from "@agile-team/mach-report";
import type { ReportEditHistoryOptions } from "../editing";

export function editHistoryLimits(input?: ReportEditHistoryOptions): Required<ReportEditHistoryOptions> {
  const limits = { maxSteps: input?.maxSteps ?? 100, maxBytes: input?.maxBytes ?? 8 * 1024 * 1024 };
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("Edit history limits must be non-negative safe integers");
  }
  return limits;
}

/** Incremental net differences retain the first source value and the latest identity/revision. */
export function mergeEditDifferences(target: Map<string, ReportCellEdit>, edits: readonly ReportCellEdit[]): void {
  for (const edit of edits) {
    const key = reportCellEditKey(edit);
    const first = target.get(key);
    const next = first ? { ...edit, previousValue: first.previousValue, previousText: first.previousText } : { ...edit };
    if (Object.is(next.previousValue, next.value)) target.delete(key);
    else target.set(key, next);
  }
}

interface HistoryEntry { edits: readonly ReportCellEdit[]; bytes: number }

function editBytes(edit: ReportCellEdit): number {
  // Include both source/current strings, stable identities and fixed object/coordinate overhead.
  // This bounds retained payloads conservatively without encoding another full JSON document.
  const values = [edit.value, edit.previousValue, edit.text, edit.previousText,
    ...Object.values(edit.source ?? {}), ...Object.values(edit.table ?? {})];
  return 512 + values.reduce<number>((total, value) => total + (typeof value === "string" ? value.length * 2 : 16), 0);
}

/** Undo storage is independent of complete event and net-difference records. */
export function createBoundedEditHistory() {
  const past: HistoryEntry[] = [], future: HistoryEntry[] = [];
  let bytes = 0;
  let limited = false;
  function clear(): void { past.length = 0; future.length = 0; bytes = 0; limited = false; }
  function resize(limits: Required<ReportEditHistoryOptions>): void {
    while (past.length + future.length > limits.maxSteps || bytes > limits.maxBytes) {
      const entry = past.shift() ?? future.shift();
      if (!entry) break;
      bytes -= entry.bytes;
      limited = true;
    }
  }
  function append(edits: readonly ReportCellEdit[], limits: Required<ReportEditHistoryOptions>): void {
    bytes -= future.reduce((total, entry) => total + entry.bytes, 0);
    future.length = 0;
    const entry = { edits, bytes: edits.reduce((total, edit) => total + editBytes(edit), 0) };
    past.push(entry); bytes += entry.bytes;
    resize(limits);
  }
  function completeUndo(): void { const entry = past.pop(); if (entry) future.push(entry); }
  function completeRedo(): void { const entry = future.pop(); if (entry) past.push(entry); }
  return {
    append, clear, resize, completeUndo, completeRedo,
    get undo() { return past[past.length - 1]?.edits; },
    get redo() { return future[future.length - 1]?.edits; },
    get limited() { return limited; }
  };
}
