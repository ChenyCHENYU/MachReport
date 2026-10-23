import { shallowRef } from "vue";
import { inspectOutputCapabilities, type OutputFormat, type RenderPlan } from "@agile-team/mach-report";
import type { ReportPreviewDiagnostic } from "../guards";

export function usePreviewDiagnostics(notify: (entry: Readonly<ReportPreviewDiagnostic>) => void) {
  const entries = shallowRef<readonly Readonly<ReportPreviewDiagnostic>[]>(Object.freeze([]));
  const keys = new Set<string>();
  let generation = 0;
  function reset(): void { generation++; entries.value = Object.freeze([]); keys.clear(); }
  function addMany(items: readonly ReportPreviewDiagnostic[]): void {
    const current = generation;
    const added: Readonly<ReportPreviewDiagnostic>[] = [];
    for (const entry of items) {
      const key = JSON.stringify([entry.code, entry.format, entry.pageIndex, entry.componentIndex, entry.componentPath, entry.path, entry.message, entry.valueState, entry.target]);
      if (keys.has(key)) continue;
      keys.add(key);
      const copy = Object.freeze({ ...entry, ...(entry.target ? { target: Object.freeze({ ...entry.target }) } : {}), ...(entry.componentPath ? { componentPath: Object.freeze([...entry.componentPath]) } : {}) });
      added.push(copy);
    }
    if (added.length) entries.value = Object.freeze([...entries.value, ...added]);
    for (const copy of added) {
      if (current !== generation) break;
      try { notify(copy); } catch { /* Diagnostics cannot fail the report. */ }
    }
  }
  function add(entry: ReportPreviewDiagnostic): void { addMany([entry]); }
  function inspect(plan: RenderPlan, format: OutputFormat): ReportPreviewDiagnostic[] {
    const result = inspectOutputCapabilities(plan, format);
    addMany(result);
    return result;
  }
  return { entries, reset, add, addMany, inspect };
}
