import { computed, shallowRef } from "vue";
import { inspectOutputCapabilities, inspectOutputCapabilitiesSummary, type DiagnosticSummary, type OutputFormat, type RenderPlan } from "@agile-team/mach-report";
import { createDiagnosticCollector, DEFAULT_DIAGNOSTIC_LIMIT } from "../../output/diagnostic-collector";
import { observeOutput } from "../../output/progress";
import type { ReportPreviewDiagnostic } from "../guards";

type Entry = Readonly<ReportPreviewDiagnostic>;
type Summary = DiagnosticSummary<Entry>;
function entryKey(entry: Entry): string {
  return JSON.stringify([entry.code, entry.format, entry.pageIndex, entry.componentIndex, entry.componentPath, entry.path, entry.message, entry.valueState, entry.target]);
}
function copyEntry(entry: Entry): Entry {
  return Object.freeze({ ...entry, ...(entry.target ? { target: Object.freeze({ ...entry.target }) } : {}), ...(entry.extension ? { extension: Object.freeze({ ...entry.extension }) } : {}), ...(entry.componentPath ? { componentPath: Object.freeze([...entry.componentPath]) } : {}) });
}
export function usePreviewDiagnostics(notify: (entry: Entry) => void) {
  const entries = shallowRef<readonly Entry[]>(Object.freeze([]));
  const summary = shallowRef<Summary>({ total: 0, counts: {}, entries: entries.value, omitted: 0 });
  const outputSummary = computed<Summary>(() => {
    const value = summary.value, explanations = value.explanations;
    const counts = Object.fromEntries(Object.entries(value.counts).map(([code, amount]) => [code, amount - (explanations?.counts[code] ?? 0)]).filter(([, amount]) => Number(amount) > 0));
    const details = value.entries.filter(entry => entry.valueState === undefined), total = value.total - (explanations?.total ?? 0);
    return Object.freeze({ total, counts: Object.freeze(counts), entries: Object.freeze(details), omitted: total - details.length });
  });
  let base = createDiagnosticCollector<Entry>(DEFAULT_DIAGNOSTIC_LIMIT);
  const outputs = new Map<OutputFormat, Summary>();
  const keys = new Set<string>();
  let generation = 0, scheduled = false;
  function publish(): void {
    scheduled = false;
    const combined = createDiagnosticCollector<Entry>(DEFAULT_DIAGNOSTIC_LIMIT);
    combined.merge(base.snapshot());
    outputs.forEach(value => combined.merge(value));
    const value = combined.snapshot();
    entries.value = Object.freeze(value.entries.slice());
    summary.value = Object.freeze({ ...value, counts: Object.freeze(value.counts), entries: entries.value, ...(value.explanations ? { explanations: Object.freeze({ ...value.explanations, counts: Object.freeze(value.explanations.counts) }) } : {}) });
  }
  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    const current = generation;
    queueMicrotask(() => { if (current === generation) publish(); });
  }
  function reset(): void {
    generation++; scheduled = false; base = createDiagnosticCollector<Entry>(DEFAULT_DIAGNOSTIC_LIMIT);
    outputs.clear(); keys.clear(); publish();
  }
  function addItems(items: readonly Entry[]): Entry[] {
    const added: Entry[] = [];
    for (const entry of items) {
      const key = entryKey(entry);
      if (keys.has(key)) continue;
      // Only the detail window is retained. Omitted occurrences are counted without retaining their payload or identity.
      if (keys.size < DEFAULT_DIAGNOSTIC_LIMIT) keys.add(key);
      const copy = copyEntry(entry);
      base.push(copy);
      if (added.length < DEFAULT_DIAGNOSTIC_LIMIT) added.push(copy);
    }
    return added;
  }
  function notifyMany(items: readonly Entry[], current: number): void {
    for (const entry of items) {
      if (current !== generation) break;
      observeOutput(() => notify(entry));
    }
  }
  function addMany(items: readonly Entry[]): void {
    const current = generation, previousKeys = new Set(keys);
    addItems(items); publish();
    for (const entry of items) {
      if (current !== generation) break;
      const key = entryKey(entry);
      if (previousKeys.has(key)) continue;
      if (previousKeys.size < DEFAULT_DIAGNOSTIC_LIMIT) previousKeys.add(key);
      observeOutput(() => notify(copyEntry(entry)));
    }
  }
  function add(entry: Entry): void {
    const current = generation, added = addItems([entry]);
    schedule(); notifyMany(added, current);
  }
  function addSummary(value: DiagnosticSummary<ReportPreviewDiagnostic>, format: OutputFormat): void {
    const current = generation, previous = outputs.get(format);
    const oldKeys = new Set(previous?.entries.map(entryKey));
    const bounded = createDiagnosticCollector<ReportPreviewDiagnostic>(DEFAULT_DIAGNOSTIC_LIMIT);
    bounded.merge(value);
    const limited = bounded.snapshot();
    const copied = { ...limited, entries: limited.entries.map(copyEntry) };
    outputs.set(format, copied); publish();
    notifyMany(copied.entries.filter(entry => !oldKeys.has(entryKey(entry))), current);
  }
  function inspectSummary(plan: RenderPlan, format: OutputFormat): DiagnosticSummary<ReportPreviewDiagnostic> {
    const result = inspectOutputCapabilitiesSummary(plan, format);
    addSummary(result, format);
    return result;
  }
  function inspect(plan: RenderPlan, format: OutputFormat): ReportPreviewDiagnostic[] {
    const result = inspectOutputCapabilities(plan, format);
    const collector = createDiagnosticCollector<ReportPreviewDiagnostic>(DEFAULT_DIAGNOSTIC_LIMIT);
    result.forEach(entry => collector.push(entry));
    addSummary(collector.snapshot(), format);
    return result;
  }
  function capture() { return { base: base.snapshot(), outputs: [...outputs.entries()] }; }
  function restore(value: ReturnType<typeof capture>, notifySamples = false): void {
    reset(); base.merge(value.base);
    value.base.entries.forEach(entry => keys.add(entryKey(entry)));
    value.outputs.forEach(([format, group]) => outputs.set(format, group)); publish();
    if (notifySamples) notifyMany(entries.value, generation);
  }
  return { entries, summary, outputSummary, reset, add, addMany, addSummary, inspect, inspectSummary, capture, restore };
}
