import type { OutputDiagnostic } from "./capabilities";

/** Bounded detail window with exact occurrence totals. Unknown business codes beyond 128 buckets share `other`. */
export interface DiagnosticSummary<T> {
  readonly total: number;
  readonly counts: Readonly<Record<string, number>>;
  readonly entries: readonly T[];
  readonly omitted: number;
  /** Business value explanations form a separate presentation channel, including omitted locations. */
  readonly explanations?: { readonly total: number; readonly counts: Readonly<Record<string, number>> };
}

export const DEFAULT_DIAGNOSTIC_LIMIT = 200;
const MAX_DIAGNOSTIC_LIMIT = 1000;
const MAX_CODE_BUCKETS = 128;
const OTHER_CODE = "other";
const RESERVED_CODES = new Set(["__proto__", "prototype", "constructor"]);
const OUTPUT_CODES: Record<OutputDiagnostic["code"], true> = {
  "invalid-image-data": true, "image-budget-exceeded": true, "component-render-failed": true,
  "unsupported-text": true, "output-degraded": true, "missing-image": true, "unsupported-component": true,
  "unsupported-image-format": true, "unsupported-style": true, "rich-text-flattened": true,
  "nested-components-omitted": true, "async-image-required": true, "image-decode-failed": true,
  "asset-render-failed": true, "asset-budget-exceeded": true
};
const PRESERVED_CODES = new Set([...Object.keys(OUTPUT_CODES), "pdf-page", "pdf-font", "pdf-fidelity", "xlsx-fidelity", "xlsx-snapshot", "prepared-layout-preserved", "prepared-font-metrics", "layout"]);

export function diagnosticLimit(value: number | undefined): number {
  if (value === undefined) return Infinity;
  if (!Number.isInteger(value) || value < 0 || value > MAX_DIAGNOSTIC_LIMIT) throw new RangeError("diagnosticLimit must be an integer between 0 and 1000");
  return value;
}

/** Internal sink. Undefined limit retains every entry for the existing full-detail APIs. */
export function createDiagnosticCollector<T extends { code: string }>(limit?: number) {
  const maximum = diagnosticLimit(limit);
  const entries: T[] = [];
  const entryBuckets: string[] = [];
  const counts: Record<string, number> = Object.create(null) as Record<string, number>;
  const retained = new Map<string, number>();
  const explanationCounts: Record<string, number> = Object.create(null) as Record<string, number>;
  let explanationTotal = 0;
  let total = 0;
  let buckets = 0;
  function count(code: string, amount: number): string {
    const bucket = code.length <= 128 && !RESERVED_CODES.has(code) && (counts[code] !== undefined || buckets < MAX_CODE_BUCKETS || PRESERVED_CODES.has(code)) ? code : OTHER_CODE;
    if (counts[bucket] === undefined) buckets++;
    counts[bucket] = (counts[bucket] ?? 0) + amount;
    return bucket;
  }
  function retain(entry: T, codeBucket: string): void {
    if (maximum === Infinity) { entries.push(entry); return; }
    const bucket = `${explained(entry) ? "e" : "o"}:${codeBucket}`;
    if (entries.length < maximum) { entries.push(entry); entryBuckets.push(bucket); retained.set(bucket, (retained.get(bucket) ?? 0) + 1); return; }
    if (!maximum || retained.has(bucket)) return;
    // Preserve a representative for later categories by replacing a redundant detail, never growing the window.
    for (let index = entries.length - 1; index >= 0; index--) {
      const code = entryBuckets[index]!;
      const amount = retained.get(code) ?? 0;
      if (amount <= 1) continue;
      entries[index] = entry; entryBuckets[index] = bucket; retained.set(code, amount - 1); retained.set(bucket, 1); return;
    }
  }
  function push(entry: T): void {
    total++;
    const bucket = count(entry.code, 1);
    if (explained(entry)) { explanationTotal++; explanationCounts[bucket] = (explanationCounts[bucket] ?? 0) + 1; }
    retain(entry, bucket);
  }
  function merge(summary: DiagnosticSummary<T>): void {
    total += summary.total;
    const buckets = new Map<string, string>();
    for (const [code, amount] of Object.entries(summary.counts)) {
      const bucket = count(code, amount), explanations = summary.explanations?.counts[code] ?? 0;
      buckets.set(code, bucket);
      if (explanations) { explanationTotal += explanations; explanationCounts[bucket] = (explanationCounts[bucket] ?? 0) + explanations; }
    }
    if (maximum === Infinity) { for (const entry of summary.entries) entries.push(entry); return; }
    const sampled = new Map<string, number>();
    for (const entry of summary.entries) {
      const sourceBucket = sampleBucket(summary, entry, sampled);
      if (sourceBucket !== undefined) retain(entry, buckets.get(sourceBucket)!);
    }
  }
  function snapshot(): DiagnosticSummary<T> {
    return { total, counts: { ...counts }, entries: entries.slice(), omitted: total - entries.length, ...(explanationTotal ? { explanations: { total: explanationTotal, counts: { ...explanationCounts } } } : {}) };
  }
  return { entries, push, merge, snapshot, get total() { return total; } };
}

/** Summary metadata is carried across JSON/Worker boundaries and must agree with its detail window. */
export function validDiagnosticSummary(value: unknown): value is DiagnosticSummary<unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as DiagnosticSummary<unknown>;
  if (!Number.isSafeInteger(item.total) || item.total < 0 || !Number.isSafeInteger(item.omitted) || item.omitted < 0 || !Array.isArray(item.entries) || item.entries.length > MAX_DIAGNOSTIC_LIMIT) return false;
  if (item.total !== item.entries.length + item.omitted || !item.counts || typeof item.counts !== "object" || Array.isArray(item.counts)) return false;
  if (Object.keys(item.counts).some(code => code.length > 128 || RESERVED_CODES.has(code))) return false;
  const counts = Object.values(item.counts);
  if (counts.length > MAX_CODE_BUCKETS + PRESERVED_CODES.size + 1 || counts.some(count => !Number.isSafeInteger(count) || count <= 0) || counts.reduce((sum, count) => sum + count, 0) !== item.total) return false;
  return validExplanationCounts(item) && validSummarySamples(item);
}
function validSummarySamples(item: DiagnosticSummary<unknown>): boolean {
  const sampled = new Map<string, number>();
  return item.entries.every(entry => sampleBucket(item, entry, sampled) !== undefined);
}

function claimSample(item: DiagnosticSummary<unknown>, bucket: string, explanation: boolean, sampled: Map<string, number>): boolean {
  const channel = `${explanation ? "e" : "o"}:${bucket}`;
  const amount = (sampled.get(channel) ?? 0) + 1;
  const explanationCount = item.explanations?.counts[bucket] ?? 0;
  const available = explanation ? explanationCount : (item.counts[bucket] ?? 0) - explanationCount;
  if (available < amount) return false;
  sampled.set(channel, amount);
  return true;
}

/** Folded custom codes retain their original names in details. After merging independently
 * bounded summaries, a name can appear both explicitly and inside `other`. Allocate the
 * finite source quotas before folding them into the destination's own buckets. */
function sampleBucket(item: DiagnosticSummary<unknown>, entry: unknown, sampled: Map<string, number>): string | undefined {
  const code = entry && typeof entry === "object" && typeof (entry as { code?: unknown }).code === "string" ? (entry as { code: string }).code : "unknown";
  const bucket = Object.prototype.hasOwnProperty.call(item.counts, code) ? code : OTHER_CODE;
  const explanation = !!entry && typeof entry === "object" && explained(entry);
  if (claimSample(item, bucket, explanation, sampled)) return bucket;
  if (bucket !== OTHER_CODE && !PRESERVED_CODES.has(code) && claimSample(item, OTHER_CODE, explanation, sampled)) return OTHER_CODE;
}

function explained(value: object): boolean { return (value as { valueState?: unknown }).valueState !== undefined; }
function validExplanationCounts(item: DiagnosticSummary<unknown>): boolean {
  if (item.explanations === undefined) return true;
  const value = item.explanations;
  if (!value || typeof value !== "object" || Array.isArray(value) || !Number.isSafeInteger(value.total) || value.total < 0 || value.total > item.total || !value.counts || typeof value.counts !== "object" || Array.isArray(value.counts)) return false;
  const pairs = Object.entries(value.counts);
  return pairs.every(([code, amount]) => Number.isSafeInteger(amount) && amount > 0 && amount <= (item.counts[code] ?? 0)) && pairs.reduce((sum, [, amount]) => sum + amount, 0) === value.total;
}

/** Legacy string-detail outputs share the same explicit limit and retain an exact occurrence count. */
export function createDiagnosticMessages(limit?: number, onMessage?: (message: string) => void) {
  const maximum = diagnosticLimit(limit), entries: string[] = [];
  let total = 0;
  return { entries, get total() { return total; }, push(...messages: string[]): number {
    for (const message of messages) {
      total++;
      if (entries.length < maximum) entries.push(message);
      onMessage?.(message);
    }
    return total;
  } };
}
