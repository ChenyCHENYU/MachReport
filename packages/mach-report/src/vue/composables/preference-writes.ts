import type { ReportPreferencesOptions, ReportStoredPreferences } from "../tools";
import { observeOutput } from "../../output/progress";
interface PendingWrite { option: ReportPreferencesOptions; value: ReportStoredPreferences; generation: number }
const MAX_PENDING_SCOPES = 32;

/** One in-flight write preserves adapter/key order, including A→B→A navigation.
 * Preferences are best effort: at most 32 latest not-yet-started scopes are retained. */
export function createPreferenceWrites(onError?: (cause: unknown) => void) {
  const pending: PendingWrite[] = [];
  let running = false, closed = false, activeGeneration = 0;
  let observer = onError;
  function report(cause: unknown, generation: number): void {
    if (!closed && generation === activeGeneration) observeOutput(() => observer?.(cause));
  }
  async function drain(): Promise<void> {
    if (running) return;
    running = true;
    try {
      while (pending.length) {
        const entry = pending.shift()!;
        try { await entry.option.adapter.save(entry.option.key, entry.value); }
        catch (cause) { report(cause, entry.generation); }
      }
    } finally { running = false; }
  }
  return {
    scope(generation: number) { activeGeneration = generation; },
    report,
    save(option: ReportPreferencesOptions, value: ReportStoredPreferences, generation: number): void {
      if (closed) return;
      const index = pending.findIndex(entry => entry.option.key === option.key && entry.option.adapter === option.adapter);
      if (index >= 0) pending.splice(index, 1);
      if (pending.length === MAX_PENDING_SCOPES) pending.shift();
      pending.push({ option: { key: option.key, adapter: option.adapter }, value, generation });
      void drain();
    },
    dispose() { closed = true; observer = undefined; }
  };
}
