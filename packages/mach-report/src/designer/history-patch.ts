export type HistoryFrame = { kind: "snapshot"; value: string } | { kind: "patch"; start: number; removed: string; inserted: string };

export function historyFrameBytes(frame: HistoryFrame): number {
  return frame.kind === "snapshot" ? frame.value.length * 2 : (frame.removed.length + frame.inserted.length) * 2 + 16;
}

/** A contiguous UTF-16 splice is lossless even for invalid JSON and IME draft text. */
export function createHistoryFrame(before: string, after: string, checkpoint = false): HistoryFrame {
  const snapshot: HistoryFrame = { kind: "snapshot", value: after };
  if (checkpoint) return snapshot;
  let start = 0;
  const common = Math.min(before.length, after.length);
  while (start < common && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let endBefore = before.length, endAfter = after.length;
  while (endBefore > start && endAfter > start && before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)) { endBefore--; endAfter--; }
  const patch: HistoryFrame = { kind: "patch", start, removed: before.slice(start, endBefore), inserted: after.slice(start, endAfter) };
  return historyFrameBytes(patch) < historyFrameBytes(snapshot) ? patch : snapshot;
}

export function applyHistoryFrame(value: string, frame: HistoryFrame, reverse = false): string {
  if (frame.kind === "snapshot") return frame.value;
  const removed = reverse ? frame.inserted : frame.removed, inserted = reverse ? frame.removed : frame.inserted;
  return value.slice(0, frame.start) + inserted + value.slice(frame.start + removed.length);
}
