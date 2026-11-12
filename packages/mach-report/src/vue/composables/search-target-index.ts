import type { RenderPlan } from "../../schema/render-plan";
import { pageTexts, type PlanTextTarget } from "./plan-texts";
import { scanTextMatches } from "./text-matches";

interface IndexedTarget { pageIndex: number; target: PlanTextTarget & { occurrence: number } }
interface Interval { start: number; count: number; value: IndexedTarget }
const HALF_LIMIT = 512;
function sameTarget(left: PlanTextTarget, right: PlanTextTarget): boolean {
  return left.componentIndex === right.componentIndex && left.rowIndex === right.rowIndex && left.columnIndex === right.columnIndex;
}
function intervalTarget(entry: Interval, ordinal: number): IndexedTarget {
  return { pageIndex: entry.value.pageIndex, target: { ...entry.value.target, occurrence: entry.value.target.occurrence + ordinal - entry.start } };
}
function findInterval(length: number, at: (index: number) => Interval, ordinal: number): IndexedTarget | undefined {
  let low = 0, high = length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (at(middle).start <= ordinal) low = middle + 1;
    else high = middle;
  }
  if (!low) return;
  const entry = at(low - 1);
  return ordinal < entry.start + entry.count ? intervalTarget(entry, ordinal) : undefined;
}

/** A query keeps at most 1024 matching text intervals, never one object per hit/cell.
 * Repeated segments of one cell share its local occurrence sequence. */
export function createSearchTargetIndex() {
  const first: Interval[] = [], tail: Interval[] = [];
  let cursor = 0, previousPage = -1, previousTarget: PlanTextTarget | undefined, local = 0;
  function record(pageIndex: number, target: PlanTextTarget | undefined, count: number, start: number): void {
    if (!target) { previousTarget = undefined; return; }
    if (pageIndex !== previousPage || !previousTarget || !sameTarget(previousTarget, target)) local = 0;
    previousPage = pageIndex; previousTarget = target;
    if (!count) return;
    const value = { pageIndex, target: { ...target, occurrence: local } };
    const last = tail.length ? tail[(cursor + tail.length - 1) % tail.length] : first[first.length - 1];
    if (last && last.start + last.count === start && last.value.pageIndex === pageIndex && sameTarget(last.value.target, target) && last.value.target.occurrence + last.count === local) last.count += count;
    else if (first.length < HALF_LIMIT) first.push({ start, count, value });
    else if (tail.length < HALF_LIMIT) tail.push({ start, count, value });
    else { tail[cursor] = { start, count, value }; cursor = (cursor + 1) % HALF_LIMIT; }
    local += count;
  }
  return {
    record,
    get size() { return first.length + tail.length; },
    find(ordinal: number): IndexedTarget | undefined {
      return findInterval(first.length, index => first[index]!, ordinal)
        ?? findInterval(tail.length, index => tail[(cursor + index) % tail.length]!, ordinal);
    }
  };
}

/** Overflow retains the original exact traversal, yielding instead of blocking a
 * navigation/computed getter. There is only one active lookup per preview. */
export function locateSearchTarget(plan: RenderPlan, pageIndex: number, occurrence: number, query: string, complete: (target: IndexedTarget["target"] | undefined) => void): () => void {
  const stream = pageTexts(plan, pageIndex, pageIndex + 1);
  let timer: ReturnType<typeof setTimeout> | undefined, cancelled = false;
  let previous: PlanTextTarget | undefined, local = 0;
  function scan(): void {
    timer = undefined;
    const started = performance.now();
    let scanned = 0;
    while (!cancelled && scanned++ < 5000 && performance.now() - started < 4) {
      const next = stream.next();
      if (next.done) { complete(undefined); return; }
      const { target, text } = next.value;
      if (!target) continue;
      if (!previous || !sameTarget(previous, target)) local = 0;
      previous = target;
      const count = scanTextMatches(text, query);
      if (occurrence < count) { complete({ ...target, occurrence: local + occurrence }); return; }
      occurrence -= count; local += count;
    }
    if (!cancelled) timer = setTimeout(scan, 0);
  }
  timer = setTimeout(scan, 0);
  return () => { cancelled = true; if (timer !== undefined) clearTimeout(timer); stream.return(undefined); };
}
